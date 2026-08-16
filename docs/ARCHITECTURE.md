# Architecture

How Auftakt is put together, and the invariants that are easy to break by accident. Decisions
already taken — and deliberately not revisited — are in [DECISIONS.md](DECISIONS.md).

## Three tiers, one hard REST boundary

**React never imports Electron APIs.** The only exception is the narrow `window.auftakt` preload
bridge (`client/src/lib/external.ts`), which degrades to plain browser behaviour when the bridge
is absent — that is what lets the whole app run in a browser during development.

One entry on that bridge is not called by React at all: `bootSettled` is called by the boot
overlay's inline script in `client/index.html`, which lives outside the bundle because it has to
paint before any of it exists. It reports that the boot screen is gone, and the main process holds
its startup backup and update check until it hears so — those run synchronously on the main
process's own event loop, so left where they were they stalled the very frames the gesture needed.
See `docs/DECISIONS.md` for why the gesture is sequenced the way it is.

- `server/` — Express 5 + better-sqlite3, ESM, run via `tsx`. Owns all business logic.
- `client/` — React 19 + Vite + Tailwind v4 + TanStack Query. Dev server proxies
  `/api` → `:4317`; in the packaged app the same Express process serves `client/dist`, so the
  client's relative `/api` calls work unchanged.
- `electron/` — window, menu, backups, file dialogs. In production it sets
  `AUFTAKT_DATA_DIR`/`AUFTAKT_PORT`/`AUFTAKT_CLIENT_DIST` and then `import()`s the bundled server
  in-process; in dev (`electron:dev`) it just loads the Vite URL.
- `shared/` — the one thing server and Electron genuinely share: `time.ts`, the timestamp format.
  Dependency-free by design, so esbuild inlines it into both bundles. It is not a fourth tier and
  nothing else belongs in it; the REST boundary is still the boundary.

## Dates and timestamps: naive local, one format

**Everything stored is naive local time** — no UTC anywhere, no `Z` suffix, no offsets:

| shape | used for |
|---|---|
| `YYYY-MM-DD` | all-day dates the user types (`due_date`, all-day `start_at`) |
| `YYYY-MM-DDTHH:mm` | timed events the user types |
| `YYYY-MM-DD HH:MM:SS` | machine stamps (`created_at`, `updated_at`, `deleted_at`, `erledigt_am`, `seasons.json` `createdAt`) |

The point of the single convention is that a machine stamp and a hand-typed date are the same kind
of string, so `client/src/lib/dates.ts` needs exactly one parser and any consumer may slice the
first ten characters to get the calendar day.

Two rules keep it true, and both are easy to break by accident:

- **Never build a stamp from `toISOString()`** — it is UTC, so between local midnight and the
  offset it names the *previous* day, and everything downstream (archive, „Erledigt am" in the
  .xlsx export, backup filenames, demo fixtures) reports that wrong day. Use `localStamp()`,
  `localDay()` or `fileStamp()` from `shared/time.ts`.
- **Every SQL `now` takes the `'localtime'` modifier**, before any offset:
  `datetime('now', 'localtime', '-30 days')`, `date('now', 'localtime', ?)`. A bare `date('now')`
  compares a UTC day against local columns and is off by one at both window edges.

`npm run check:dates` is the guard. It re-runs the whole API under `TZ=Pacific/Kiritimati` and
`TZ=Pacific/Midway` — 25 hours apart, so at least one always sits on a different calendar day than
UTC — and asserts 31 properties per zone. `npm run typecheck` cannot see any of them.

One wart: SQLite cannot alter a column DEFAULT in place, so tables in a pre-existing database still
carry `DEFAULT (datetime('now'))`. Insert paths therefore write `created_at`/`updated_at`
explicitly (`lib/crud.ts`, `ensureBuiltinColumns`, the event duplicate) instead of relying on the
default. **A new insert path must do the same** — relying on the default writes UTC on an old
database and local on a new one.

## Seasons: one SQLite file per season, scoped per request

`server/src/db.ts` is the single source of truth for data location. A `seasons.json` registry in
the data dir lists seasons and the **default** one (`activeId` — what new windows and headerless
callers resolve; `activateSeason()` is a registry write only). Each window pins its own season
(`client/src/lib/season.ts`, sessionStorage) and sends it with every request as
`X-Auftakt-Season` — **every** request, downloads included, since the header is also what carries
the 410 recovery (PR50-04). The middleware still accepts `?season=` as an equivalent leg, but its
only caller is the main process's own HTTP (`seasonPath()` in `electron/main.ts`), which has no
window pin to read. The `/api` middleware (`server/src/index.ts`) validates the id, answers **410** for a
season that no longer exists (distinct from row-level 404s; `no-store`, and every `/api` response
carries `Vary: X-Auftakt-Season` — a heuristically-cached 410 replayed after recovery was an
infinite reload loop), echoes the resolved id — an unpinned window adopts the first echo — and
opens an `AsyncLocalStorage` context (`server/src/seasonContext.ts`) that `getDb()` resolves
against a per-season connection pool.

The rule that keeps this invisible: **handlers never pass season ids around.** `getDb()` is
season-aware through the request context; anything running outside a request — the boot warm,
seed/demo, the check scripts' in-process calls, the Notion importer — deliberately gets the
default. Never capture `getDb()`'s return across requests (the boot warm in `index.ts` is the
sole deliberate exception). The check scripts' `activateSeason(id)` → `getDb()` pattern is a
compatibility constraint: headerless resolution re-reads the registry per call, so do not cache
the default id. Data dir is `<repo>/.data` in dev and Electron `userData` when packaged.

`copySeasonData()` carries a `SeasonCopyOptions` selection into a fresh season with ids preserved
so FKs and `custom_values` keys stay linked. Every group is opt-in and **a row only comes over if
the parent it hangs off did too**, so the function first closes the dependency graph the schema
imposes (projects → artists, tasks → columns) rather than trusting the request body. Testing the
group *flag* instead of whether the parent row actually arrived is DBW-06, and it copies children
across dangling — invisible until a `PRAGMA foreign_key_check` or an export. Season-level rows
(no parent at all, WP-47) travel with their own group — contacts with `contacts`, events with
`events`, season-wide todos with `tasks` — except links: they have no group of their own, so a
parentless link rides `settings`, like the parentless dashboard widgets, whose placement also
lives in `dashboard_layout`, a setting.

Two groups are not plain row copies: **built-in columns** are matched by `key` and updated in
place, because the target's own come from `ensureBuiltinColumns()` and `task_sort` refers to them
by key; **settings** are upserted minus `SETTINGS_NOT_COPIED` (`saison`, `backup_dir`,
`first_run_done`). That exclusion list is an allowlist of what stays *behind*, so a new setting is
carried over by default — nothing to add there when you add one.

**Images in flowing text** (`images`, WP-37) are a third exception: they travel **unconditionally**,
whatever groups were ticked. A reference lives inside a Markdown string — `/api/images/<token>`,
where the token is `sha256(bytes)` — and the set of strings that can hold one is not closable
(eight text columns, every text-typed custom column inside the `tasks.custom_values` JSON, and the
landing notes in `seasons.json`, which is not even in the file being copied). Gating them would
surface as a broken picture at the customer. They go through the same `copyRows` as every other
table, with `ON CONFLICT(token) DO NOTHING` passed in: dedupe on the content token rather than kept
ids, so the copy is also correct into a *non-empty* target, and no stored prose ever has to be
rewritten. Only the *read* of the source table is wrapped in a `try` — a season file written before
WP-37 has none — because a failure **writing** to the new season has to surface rather than be
reported as a successful copy. The stored URL carries **no season**: an `<img>` request sends no headers, so the
window's pin is appended at render time (`Markdown.tsx`, and the editor's `resolveSrc`) and stripped
again on the way back in — see `client/src/lib/imageRef.ts`. The table is deliberately absent from
`lib/cascade.ts`, so nothing purges it; `docs/DECISIONS.md` has the reasoning.

### Migrations

`initDb(db, isFresh)` is **the single initialisation path** — `getDb()` and `createSeason()` both
go through it. Schema changes go in the `SCHEMA` constant **and** as an idempotent `migrateX(db)`
called from `initDb`; existing user databases are never recreated. Use the `ensureColumn` helper
for added columns; a changed CHECK constraint needs the full table rebuild (see
`migrateTasksAllowGeneral`). A rebuild copies its table's *current* full column set and recreates
its indexes itself (DROP TABLE takes them down; SCHEMA only re-runs on the next boot), which is
why the three season-scope rebuilds (WP-47) sit **last** in `initDb`: their column lists are only
complete once every column-adding migration has run. A future `ensureColumn` on contacts, events
or links must be registered after them — the order-dependence `migrateLinksNotes` documents.

Prefer a **self-detecting** migration — one whose WHERE clause simply matches nothing once it has
run (`migrateFlattenDeepSubtasks` is the model). Reach for a settings-row marker only when the data
genuinely cannot reveal whether the migration already ran, which for `migrateStampsToLocal` is the
case: converting twice shifts every stamp twice. `getDb()` decides whether the file is brand new
*before* opening it, since `new Database()` creates it.

A marker also has a cost worth weighing: it disables the migration permanently after the first
run. That is wrong for anything repairing a back door a later import can re-open.

**The chain stamps `PRAGMA user_version` at its end, and the refusal it enables is one-sided**
(WP-R5, #8). `SCHEMA_VERSION` is a plain counter — not the app version — bumped only when a
migration changes the stored shape in a way an older build would misread; `initDb` writes it after
every step returned, so the stamp always means „this file has been through the whole chain of
build N". Before the first step, `assertSchemaSupported` throws for a file whose stamp *exceeds*
this build's, and for nothing else: the chain repairs forward, several of its steps are lossy
(`migrateFlattenDeepSubtasks` reparents, `migrateProjectsMergeNotes` folds a column away), and an
older or unstamped file is exactly what it exists for. `>` and never `>=` or `!==` — the build that
introduced the stamp would otherwise refuse every database in existence.

The same test is spelled in three places because there are three doors into a season file, and
none of them runs the others: `initDb` (every open), `validateImportCandidate` (before the import
snapshots, copies or renames anything — so the refusal never arrives after the old database is
gone) and `copySeasonData`, which opens the *source* raw and copies a fixed column list per table.
The refusal is per season, never per app: `getDb()` closes the handle and throws, the boot warm in
`index.ts` catches so one newer season cannot keep the process from starting, and `seasonStats`
already degrades that season's card to `null` — so a window pinned to a file it cannot open can
still list the seasons and switch away. **`GET /api/backup/status` belongs to that list**: main
reads it headerless (i.e. against the *default* season) and treats a failure as „no folder
configured", so a 500 there would skip the startup backup for every season without throwing —
`hasData()` therefore answers `true` for a season it cannot open rather than propagating the
throw, and `ensureBackupDir` turns a non-OK response into a reported problem. Backups themselves
never run the chain (`VACUUM INTO` on the file), so a refused season is still backed up.

## Backups and import — never copy a live DB with the filesystem

**`copyFileSync` on an open SQLite file is a data-loss bug, not a shortcut.** Under WAL, committed
rows sit in the `-wal` until a checkpoint, so a plain copy of the `.db` can (and did) produce a
file with **zero tables**. Every snapshot goes through `snapshotDb()` (`server/src/db.ts`), which
uses `VACUUM INTO` to write a consistent image of db + WAL.

For the same reason these operations live **server-side** (`server/src/routes/backup.ts`) — it owns
the connections and is the only side that can checkpoint. Electron supplies paths from dialogs and
nothing else; `electron/backup.ts` is just an HTTP call.

Validation covers the candidate's **schema version** as well as its tables (WP-R5): a file a newer
build has already migrated is refused before anything is replaced, and `POST /backup/import/check`
answers with `schema: { file, app }` so the Electron confirmation can name both generations — an
accepted older file *is* migrated on its first open, which does not run backwards.

`importIntoCurrentSeason()` is order-sensitive and the order is the fix: validate the candidate →
snapshot the current DB → `closeSeason()` → copy → unlink `-wal`/`-shm`. Closing before the copy
is what removes the sidecars; a stale WAL left beside a freshly copied file is replayed on the
next launch, which either silently discards the import or corrupts it into `database disk image
is malformed` at startup, before the window exists. It targets the request's season; the Electron
menu path resolves the focused window's pin, the Einstellungen buttons pass theirs through IPC.
`deleteSeason()` closes the pooled handle before unlinking for the same family of reason — an
open file cannot be unlinked on Windows.

Backups cover **every season plus `seasons.json`**, written as one dated restore-point folder per
run and pruned to 30. The backup folder is split into `backups/` and `pre-import/` (WP-41), each
its own pool of 30; folders an older version left at the top level are moved down on the next run,
best-effort and self-detecting, while flat `auftakt-<stamp>.db` files from before the folders are
left alone. A German `README.txt` at the root and a `MANIFEST.txt` per restore point explain the
folder — CRLF and a UTF-8 BOM, because it is read in Notepad out of Google Drive.

**Inside** a restore point everything stays flat and keeps the `file` names from `seasons.json`:
restoring is a hand copy over the data directory, so the season *label* goes into the manifest and
never into a file name. Two things are therefore fixed: the dated folder names must keep matching
`^<prefix>-<stamp>$` (an unmatched folder is never pruned) and nothing may precede the stamp.

Guarded by `npm run check:backup`; the Electron half has a manual checklist
in [BACKUP-TESTING.md](BACKUP-TESTING.md) to run on macOS **and** Windows before a release.

## CRUD factory

Most endpoints are `crudRouter({ table, writable, ... })` from `server/src/lib/crud.ts`, which
generates list/get/create/patch/delete/restore. `writable` is the allowlist — a column not listed
there can never be set by a client. Use `transform` for server-controlled derived fields (e.g.
stamping `tasks.erledigt_am` when status flips to done) rather than trusting the client, and
`customList` when the list needs the denormalised joins in `server/src/lib/queries.ts` (which
resolve each task/event to its owning artist via `COALESCE(t.artist_id, p.artist_id)`).

Contacts, events and links may sit **directly on the season** — every parent FK NULL, like tasks
and custom sections before them (WP-47). Those rows are listed with `?scope=season`
(`seasonScopedList` in `routes/entities.ts`; the events route passes the same flag into
`listEvents`), a custom list because an equality filter cannot express „no parent at all". The
spelling is deliberate: **`?season=` is taken** — the `/api` middleware reads it as a window pin
and answers 410 for a non-integer value before any route runs, so a scope param named `?season=`
would never reach a list. Creates need nothing special: the clients send explicit `null`s and the
CHECKs read „at most one parent", with two still refused (`SQLITE_CONSTRAINT` → 400). The client
consumers are the Übersicht's three season sections (WP-48): `Dashboard.tsx` lists each table
with `scope=season` and hosts the shared list components with an empty `parent`.

Behaviour keyed off the allowlist rather than a separate flag: `/reorder` mounts when `sort_order`
is writable, and `color` is hex-validated when `color` is. A new table gets both by construction.

`parent: {table, column}` is `parentLive` for a table that reaches its owner by one foreign key
instead of the `parentJoins` pair — it filters list and get, so a row whose parent is in the trash
answers 404 rather than rendering a page the rest of the app hides (WP-34). **Reads only:**
PATCH/DELETE/restore stay reachable on a hidden row, because restoring the parent has to bring the
child back untouched and `purgeExpired` still counts it as a live reference (SDL-01). Only
`projects` carries it today — every other child is fetched through a page that is itself gated,
while a project has a URL of its own.

Each `writable`/`required` pair is mirrored on the client by a `…Create`/`…Update` type in
`client/src/api/types.ts`, which is what `resource<T, Create, Update>()` binds to. **Adding a
column means editing both**: `crudRouter` drops anything not on the list without a word, so a
client write of an unlisted column is a silent no-op — 200, no error, and the value gone (CCL-24).

**The invariant to preserve: every `…Update` *widens* its row type** — same key, same or wider
value type. That is what keeps a set of raw row values a legal patch, which `useUndoablePatch`
relies on to build an inverse. Narrowing a column there breaks undo, not the call site.

Two residual holes it does not close, worth knowing before trusting the types: excess-property
checking only fires on *fresh object literals*, so a payload built as a variable or assembled by
spread still admits unknown keys; and a `Record<string, unknown>` bag satisfies an all-optional
target **vacuously** (the weak-type check needs ≥1 declared property). That is why the four form
paths use typed payload mappers rather than casts.

## Soft delete, archive, undo

Every table has `deleted_at`; deletes are soft, lists filter `deleted_at IS NULL`, and
`purgeExpired()` hard-deletes after `PURGE_AFTER_DAYS` (30) — at server startup for the default
season, and when a request opens any season whose handle is not yet pooled (`getDb()`'s pool-miss
path, so the default sweeps again too whenever its handle was evicted). Two opens are exempt:
in-process programmatic ones (seed/demo, check scripts, the Notion importer), and the first one
after an import — a restored backup's trash is usually what the import was *for*. On the client,
deletes go through `useUndoableDelete()` so every deletion surfaces an undo toast backed by the
`/restore` endpoint — keep new delete affordances on that path.

Soft-delete marks **one row**, so a trashed parent keeps its children live. The purge therefore
takes only rows whose own `deleted_at` expired *and* that nothing still references — `NOT EXISTS`
guards generated from `CHILD_EDGES` — so it can never destroy data the user never trashed (SDL-01).
A parent with live children is simply never auto-purged; the archive page's „Endgültig löschen",
which counts and warns first, is the only path that cascades. Never rebuild that sweep as
`DELETE … WHERE id IN (?,?,…)`: one bound param per row hits SQLite's 32766-variable ceiling and
kills retention permanently (DBW-02).

Separately, tasks in the „done" status move to the archive view after `ARCHIVE_AFTER_DAYS` (30).
„Done" is not hardcoded: it is whichever Status option carries `done: true`, read via
`doneStatusValue(db)`.

### Counting before a delete

Two endpoints put a number in front of a delete, and they count **different things** — read which
one produced a `DependentCounts` before believing it:

| | walks | answers |
|---|---|---|
| `GET /api/deleted` → `dependents` | `collect()`, whole closure | what „Endgültig löschen" **destroys** |
| `GET /api/artists\|projects/:id/dependents` | `collect(…, {liveOnly: true})` | what a soft delete **hides** (WP-34) |

The second exists because a soft delete stamps one row: nothing under it is deleted, it merely
stops being listed, and „Wiederherstellen" brings the page back whole. Counting a descendant that
is *already* in the Papierkorb would overstate what the click costs, which is what `liveOnly` is
for — the same line `liveSubtreeIds` draws for task trees. Both share `dependentCounts()` in
`lib/cascade.ts` and the German formatter `cascadeText()` in `client/src/lib/deletedTypes.ts`.

### Where delete affordances live

There is a pattern here, and it is worth matching rather than re-deciding per surface:

- **row deletes** — the hover-revealed `PencilIcon`/`TrashIcon` pair (Kontakte, Termine, Dokumente
  & Links) and the task table's always-visible `TrashIcon`. Every symbol that *is* a button's face
  comes from `client/src/components/icons.tsx`; see `docs/DECISIONS.md`, WP-38
- **section deletes** — only inside „✎ Bereiche bearbeiten" (`SectionArranger`'s strip)
- **config deletes** — only inside their manager (⚙ Spalten, the option editors in Einstellungen)
- **record deletes** (artist, project) — inside „✎ Bearbeiten", behind a second confirm, never on
  the page header. See `docs/DECISIONS.md`, WP-34. The page they delete is the page you are on, so
  the redirect out **replaces** the history entry: a push leaves the deleted row one Zurück away,
  and the refetch there 404s into the `LoadError` panel (PGS-05).
- **seasons** — Einstellungen only, and the one delete with no undo at all.

### Task subtrees

Three endpoints own subtree operations and are where any future one belongs: `POST /tasks/:id/move`
(scope + `parent_id`, all three always written, so the same call is its own undo),
`DELETE /tasks/:id/tree` and `POST /tasks/:id/tree/restore`. All three go through one walk —
`liveSubtreeIds` in `routes/entities.ts`, which includes archived rows but neither includes nor
descends through soft-deleted ones — and `descendantsOf` in `client/src/lib/taskTree.ts` is its
client mirror, used for the counts the dialogs promise. **Keep the two in step.** Do not grow these
into a general batch API.

The subtask tree is at most two levels. The tasks transform enforces it on the API and
`migrateFlattenDeepSubtasks` repairs anything that arrived another way (a local one-off Notion
importer, not part of this repo, writes rows with raw SQL and bypasses the transform).

**The tree becomes rows in `client/src/lib/taskRows.ts`.** `buildTaskRows` flattens the sorted
top-level list plus the per-parent child lists depth-first into `TaskRow`s carrying `depth`,
`canExpand` and `isExpanded`; `groupRows` then chunks that by depth so a task and its subtasks
render as one `<tbody>`. Both lists arrive already sorted — ordering is `taskSort.ts`'s job and
the flatten must never reorder. Expansion is stored inverted, as a set of *collapsed* ids, so an
unknown parent is open and nothing has to seed it. This replaced `@tanstack/react-table`; see
`DECISIONS.md` for why, and note that the recursion is unbounded and cycle-guarded on purpose
even though the API caps the tree at two levels (TTU-37).

## Data-driven task columns

The task table has no fixed column list. Every column — built-in and user-added — is a row in
`custom_columns`. Built-ins (`kind: 'builtin'`) bind to real `tasks` fields through `key`; custom
ones (`kind: 'custom'`) store values in the `tasks.custom_values` JSON blob keyed by column id.
`ensureBuiltinColumns()` inserts missing built-ins idempotently, and users can disable, reorder or
(where `deletable`) remove them.

**Every page is a scope, and a scope's columns stay on its own page** (WP-51, #58). `scope` is
`global | artist | project`, each paired with exactly one parent — none, `artist_id`, `project_id` —
and the pairing is a schema CHECK as well as a route guard, because writing one half without the
other puts a row where no list looks (every list binds the scope and the parent id together). The
Übersicht is the global scope: the „Festival" todos are the season's own list, so it needs no
fourth value. Built-ins are all `global`, which is why `useGlobalColumns()` answers anything keyed
off one. Columns are managed in two places — Einstellungen for the globals, „⚙ Spalten" on an
artist or project page for that page's own. Ordering is
`compareColumns` (`client/src/api/types.ts`): globals first, then the page's own group.

**Visibility is the one property of the *pair* (column, page)** (WP-59). `custom_columns.enabled`
is the **season default**; `artists.task_columns` / `projects.task_columns` hold that page's
departures from it as a sparse `{"<colId>": boolean}` JSON map, with `NULL` — and any column the
map does not name — meaning „follow the default". Same shape as `layout` one level up, same
migration (a plain `ensureColumn`, no rebuild), same sentinel, and the same reason it is sparse: a
column added in Einstellungen afterwards still reaches a page that has been configured. The keys
are `colId` (`custom:<id>`, or a built-in's `key`), so a built-in survives a season copy, which
matches built-ins by `key`. `lib/taskColumns.ts` is the single decider — `columnVisible`,
`visibleColumns`, `withColumnVisible` (which prunes an override that agrees with the default, and
an emptied map back to `NULL`) — and every reader goes through it: the task table, the sort rules,
the print sheet, and the `.xlsx` export, which restates only the `custom:<id>` half server-side.
The rest stays season-wide on purpose: **order, name, options and scope are not per page.**
`compareColumns` renumbers each scope group from 0 (TTU-21), which a per-page order would have to
replace, and Status/Titel (`deletable === 0`) stay unhideable everywhere because `doneValueOf`
drives graying, sinking, the stats and archiving.

A scope's ripples are wider than the column list suggests, and each one is silent when missed: the
season copy carries a scoped column only if its parent arrived (`copySeasonData`), the .xlsx export
assembles its column set per scope (`routes/export.ts`), the cascade and the Papierkorb sublabel
follow the FK (`lib/cascade.ts`, `routes/deleted.ts`), and a task moved out of a scope keeps its
values in `custom_values` with no header left to show them under (`MoveTaskDialog`).

Column ids in `client/src/lib/taskSort.ts` are `key` for built-ins and `custom:<id>` for
customs — one `colId`/`customColId` pair owns both halves. The delimiter is load-bearing: the
previous `c<id>` form shared a namespace with the built-in `comment` key, which then decoded as
custom column `Number('omment')` = NaN and made that sort level compare every task equal (TTU-31).

`custom_values` PATCH semantics are **shape-dependent**: an **object** patches the named keys
(merged server-side), a **string** replaces the blob verbatim. The string arm is the undo contract —
`useUndoablePatch` picks the raw JSON string off the pre-edit row — so a new writer that sends an
object is asking for a merge whether it means to or not.

Sort order is likewise configurable: the `task_sort` setting holds a rule hierarchy that users edit
in Settings; clicking a header is a temporary override, and an override whose column is hidden while
the table stays mounted stops being one — for the ordering and for dragging alike. `TASK_ORDER`
(`server/src/lib/queries.ts`) is `ORDER BY (t.status = ?) ASC, t.sort_order ASC, t.id ASC`, and
`rankRules` (TaskTable) measures drops against it with an empty rank list; **the two are kept in
step by comment only.** The server ranks by nothing else on purpose: the client short-circuits on an
empty rule list and keeps whatever came back, so any key the server adds is a rule no user can see
in Settings or switch off. Readers that are *not* the task table — Archiv, the .xlsx export, the
print sheets — pass `order=due` (`orderParam`, `TASK_ORDER_DUE`), because a per-list ordinal is
meaningless to a reader that spans several lists.

**A rule whose column is hidden or gone does not order the table.** `activeSortRules`
(`client/src/lib/taskSort.ts`) is the one filter, used by `TaskTable` and by `TaskSortEditor`'s
label so behaviour and the „(ausgeblendet …)" suffix cannot drift. `manual` is exempt — it is
`sort_order`, not a column. The stored rule is filtered, never rewritten, so showing the column
wakes it up again; that is what makes `DEFAULT_TASK_SORT`'s change from `[status, priority, due]` to
`[status]` need **no migration** — an older season stores the long list and behaves identically,
because Priorität and Fällig ship hidden (WP-32). Since WP-59 „hidden" is per page, so the same
season-wide rule orders one project's table and not the next one's; `TaskSortEditor` resolves
against the season default and says so („sortiert nur auf Seiten, die sie zeigen").

A created task is stamped `sort_order = MIN(scope) − 1` in the tasks `transform`, so it leads its
list instead of tying at the column default and losing the `id` tiebreak. The scope is the
`(artist_id, project_id)` pair compared with `IS`, and soft-deleted and archived rows count — a
restore must not come back tied with the new row. `leadingSortOrder` says why it is not `parent_id`.

Page section order is edited by `SectionArranger` and **stored per entity**: `artists.layout` and
`projects.layout` hold that page's own array as JSON text, and `NULL` means „never arranged"
(WP-25). `dashboard_layout` stays a plain setting: there is only one dashboard.

Around that column sit **two independent settings arrays per page type** (WP-31), and the
difference between them is the thing to get right:

| store | key | who writes it | who reads it |
|---|---|---|---|
| the **standard** | `artist_layout` / `project_layout` | „Als Standard für neue Seiten speichern" | every page whose column is `NULL` |
| the **saved** layout | `artist_layout_saved` / `project_layout_saved` | „Layout speichern" | only „Gespeichertes Layout anwenden", on demand |

Both are widget-free by construction: a save filters out `cs<id>`, because a widget key names a
`custom_sections` row that exists on exactly one page and would be dead weight on every other.
Only the entity's own column may hold one. All four actions live in one `LayoutMenu` in the arrange
toolbar, whose heading names the scope through `useLabel` — **appended, never fused**
(`Layout · ${label}`), since „Künstler" is renameable and „Künstlerseiten-Layout" would become
„Ensemblesseiten-Layout".

Which store a page uses is the page's business, and all of them expose the same `LayoutStore`
shape (`value` / `current()` / `refresh()` / `write()`), so `useRemoveCustomSection` prunes a
`cs<id>` without knowing where the array lives: `useEntityLayout` for artists and projects, `useSettingsArray` for
the dashboard, `useLanding` (behind a small adapter in `LandingPage`) for the landing. Since WP-45
`SectionArranger` takes that store itself — the `store` prop, or `layoutKey` for the settings
arm — because the removal undo needs `current()`, not just a write. Settings whose values are
JSON arrays must still be listed in `ARRAY_KEYS` in `server/src/routes/settings.ts` to round-trip
parsed; the entity column is **not** parsed on read, because the CRUD factory has no read
transform — use `parseEntityLayout`.

Removing a built-in section (WP-45, issue #57) writes a **tombstone** — the entry stays, flagged
`hidden: true` — so its position and width survive for the „+ Bereich" picker, and a key *absent*
from a stored layout still means „this build added a section the layout has never seen" and is
appended visible (how a new section reaches existing pages, #59). Removal is **the one undoable
layout write**: its undo arms are built on `store.current()` (`lib/layoutEntries.ts` holds the
pure helpers). Everything else — reorder, width, the whole `LayoutMenu` — stays off the undo
stack. „+ Bereich" renders outside edit mode, because the picker is the only way back to a
removed section.

Two things that removal undo has to get right, both of them invisible when it gets them wrong.
On a page that was still **following the standard**, the removal is also what gives it a layout of
its own: the tombstone can only be persisted with the array around it. Writing that array back
would restore the picture and not the state — the page would look untouched while quietly holding
a frozen copy of the standard — so the revert calls `resetToDefault()` instead and the page keeps
inheriting. Only while nothing else was arranged in between: `sameLayout` compares the store
against what the removal wrote, and an arrangement of the user's own outranks the reset. And both
arms `await store.refresh?.()` before reading, because `current()`/`owned()` read a query cache
that react-query empties `gcTime` (five minutes) after the page unmounts — a miss is
indistinguishable from a store with nothing in it, and an undo pressed from the keyboard three
screens later is exactly the case that hits it. The same `refresh()` guards the *widget* removal
`useRemoveCustomSection`, whose arms write what they read — so a cold cache there is not a refused
undo but a wrong array persisted: the whole `dashboard_layout` replaced by the one entry being
restored.

**`refresh()` is a real request** (`refetchNow`, hooks.ts), not `ensureQueryData` — that returns
whatever is cached whenever an entry exists, which is silent about what another *window* wrote,
and every implementation of `refresh()` reads and then writes back (WP-53). It can therefore
reject, and that is the wanted end: the throw lands before any write, so a failed refresh leaves
the store untouched rather than persisting a stale array over the truth.

The landing goes further, because there the blob itself is the store and `usePatchSections` writes
back a whole array: `useLanding().update(fn)` re-reads before applying `fn` and retries if the
generation moved under it, so a late reader cannot read a cold cache as „no sections" and write
that back (SHL-01/02/03 stop being a discipline), and a document delete cannot take the other
window's Bereich with it.

Since WP-46 a page declares its built-ins as **one `SectionSpec[]`** (`lib/sectionSpecs.ts`,
re-exported through `components/SectionCatalog.tsx`): spec order is the default section order for
fresh layouts, and `arrangerConfig(specs)` derives the arranger's parallel props
(`sections`/`labelKeys`/`mandatoryKeys`/`defaultHidden`/`fullWidthKeys`/`defaultWidths`) from it.
A removable spec must name its picker group — the type forbids „removable but ungroupable", so a
key can no longer silently drop out of the „+ Bereich" picker (the PGS-28 class). `defaultWidths`
lets a key arrive half-width when first appended to a stored layout; the project page's
`kontakte`/`links` pair is its user (WP-48) — two adjacent half specs reproduce the welded
section's side-by-side look on fresh pages, and every append path including the removal-redo's
`ensureEntry` writes the spec width.

Two things that look like tidiness and are not. A layout write must **publish to its query cache
before awaiting**, because most arrange mutations fire as `void write(…)` (SHL-10) — the removal
undo arms rely on the same publish through `current()`; and pruning a widget entry stays at the
delete site, where the id is known — with the extra rule that a page still following the standard
must not be written to at all, or the standard freezes onto it as an arrangement the user never
made.

## Client contracts

Which module owns which invariant. Reach for these rather than rebuilding the behaviour.

| module | owns |
|---|---|
| `useAllTasks()` (hooks.ts) | the one `['tasks','scope-all']` query — live **and** archived. Anything that must not stop at the archive edge takes this: the subtask tree (a subtree op derived from a `scope:'live'` list strands a child past `ARCHIVE_AFTER_DAYS`) and „Fortschritt" (`done`/`total`/`pct` were wrong on the live list; „offen" was not). A new *editable* table stays on the page's live list. |
| `useGlobalColumns()` (hooks.ts) | the single `['customColumns','global']` reader. `useDoneValue()` sits on it, and so does `TaskSortEditor` — a `task_sort` rule is a season-wide setting, so only global columns can carry one. |
| `useScopedColumns(owner, enabled)` (hooks.ts) | one entity page's column set: the globals plus that page's own, already merged. Both entity pages take it rather than writing the query out, because three things have to agree at once — the scope sent, the parent id sent with it (a scoped list without one is a 400) and the globals leading the merged list. **Unfiltered** — the manager has to list a hidden column to offer it back, so visibility is applied where the table is drawn, never here. |
| `useEntityColumns(kind, row)` (hooks.ts) | that page's *visibility* half (WP-59): the parsed `task_columns` map, `setVisible(col, visible)` and `reset()`. Publishes into the `[kind, id]` cache before awaiting and latches the last intent in a ref, because the natural gesture is toggling three columns in a row and every write persists the whole map — a second toggle computed from the pre-first-toggle value undoes it (SHL-10), and so does a refetch from write *n* landing while *n+1* is out. |
| `useSettingsArray(key, parse)` (hooks.ts) | immediate-save array settings. Publishes into the `['settings']` cache **before** awaiting, so a second edit inside the round trip composes. `current()` reads the array as it is *now* — use it in any closure that runs later (an undo six seconds on). `parse` must be module-level (it is a memo dep) and must read defensively; a throw there blanks the page. **Two writes, and the choice is the cross-window story** (WP-R5): `update(fn)` is `useLanding`'s contract on this table — re-reads, applies `fn`, sends the generation it read, retries the *intent* on a 409 — while `write(next)` posts a snapshot unconditionally and stays last-writer-wins. Take `update` wherever the change is a function of the stored array; `write` only where the next array is assembled somewhere this hook cannot re-run (a controlled editor's `onChange`), which is why the arranger and `TaskSortEditor` are still on it. |
| `useLanding()` (hooks.ts) | the same contract for every `seasons.json` write, plus the one that has no Papierkorb behind it. **`update(fn)` takes a function and is the only way to write**: it re-reads the blob, applies `fn`, and sends the generation it read; the server refuses a superseded one (409) and the whole thing re-runs against what is actually stored, so a concurrent write is merged rather than destroyed and an exhausted budget is *reported* rather than lost (`lib/conflict.ts`). An array argument would defeat that — a retry can only re-apply an intent. `fn` returning `null` writes nothing (a refused drag). Two further differences from `useSettingsArray`: it **throws** rather than guarding (callers already own a catch → German toast), and the pre-await publish is skipped when the patch adds an id-less row — that publish is now cosmetic, since every write reads for itself. |
| `refetchNow(qc, key, fn)` (hooks.ts) | the one honest refresh. `ensureQueryData` hands back the cache whenever an entry exists, which says nothing about what another window wrote; this passes `staleTime: 0` and always asks. Reach for it wherever a store is read and then written back — all three `LayoutStore.refresh` implementations do. |
| `useRetention()` (hooks.ts) | „wie lange bleibt das". **No German string may state a retention threshold again.** Both constants ride on the settings response. |
| `useGuardedAction()` / `useErrorToast()` (hooks.ts) | the failure arm for any write. `guard(fallback, () => api.x(…))` returns `true` when the call resolved, so a caller can gate its success toast or dialog close on it. Wording policy lives in `client/src/lib/errors.ts`: the German sentence leads, an `ApiError`'s server text follows in parentheses; anything else goes to `console.error`. |
| `pushWithToast(entry, message)` (UndoProvider) | pairing a stack entry with its toast. Never call `push` *and* wire a toast `onAction` — doing both is TTU-13, where the toast ran `revert` behind the stack's back. `DERIVED_INVERSE_KEYS` (hooks.ts) maps a resource to the columns the server derives. |
| `useUndoableDelete()` (hooks.ts) | soft-delete + undo stack + toast, returning whether the row is actually gone. A delete endpoint that does not answer `{deleted:false}` on a no-op silently opts out of the „war bereits gelöscht" check — teach it in `nothingDeleted()`. **Deleting a row that has a page of its own passes `gone: [kind, id]`** — its keys go stale but are never refetched. Without it the blanket invalidate asks for the deleted row while its page is still mounted (the redirect is a router transition and does not commit first), the server answers 404, and the user gets an error toast next to the „gelöscht" one. |
| `lib/season.ts` | the window's season boundary: the sessionStorage pin, the response-echo adoption, the 410 recovery (`seasonGone()` → landing + relayed toast) and `switchSeason()` — **the only legal way to change seasons from the client.** Calling `api.activateSeason` directly moves the default without switching anything. `switchSeason()` yields when its own activate comes back 410: the recovery has already navigated, and a second navigation over it left the relay flag latched and the window unable to recover from any later 410 (PR50-01). `sessionStorage['auftakt-season']` has exactly one other reader, and it is in another process: `windowSeason()` in `electron/main.ts` peeks it via `executeJavaScript` to route the Datei menu's export/import. `electron/tsconfig.json` includes only `electron/*.ts`, so no typecheck spans the two spellings — **grep is the whole coupling**, and renaming the key means renaming both (PR50-10). |
| `lib/imageRef.ts` | how an image in flowing text is spelled (WP-37). The stored form is root-relative and **season-free** (`/api/images/<sha256-token>`), which is why the untouched `defaultSchema` already renders it and why a season copy rewrites nothing. `withSeasonPin`/`canonicalImageSrc` are exact inverses and the reason that holds: an `<img>` request carries no header, so the window's pin is appended when the tag is drawn and stripped when one is read back — leak it into storage and the note is wrong in every *other* season. Pure (no DOM, no `sessionStorage`, no imports) so `lib/richtext.ts` stays loadable by the headless gate and `check:unit` reaches the escaping rules. |
| `lib/broadcast.ts` | cross-window signalling. **One channel object per window, for posting AND listening — the singleton IS the self-suppression**: BroadcastChannel skips delivery only to the posting object, so a second `new BroadcastChannel('auftakt')` makes a window hear its own writes and loop every invalidate. Messages are versioned pure signals, never data. `useInvalidateAll` posts; the sole listener lives in `main.tsx`, where it shares one coalesced blanket invalidate with the `backup-config-changed` bridge event (see „Windows (plural)"). |
| `lib/sectionSpecs.ts` (via `SectionCatalog.tsx`) | the section catalog: `SectionSpec[]` → `arrangerConfig` derives the arranger props, `pickerBuiltins` the „+ Bereich" rows. Spec order **is** the fresh-layout default order; a removable spec must carry its picker group (type-enforced). The derivation is pure and lives in `lib/` so `check:unit` reaches it without React; `SectionCatalog.tsx` re-exports it and holds the shared section bodies (`StatsSection`, `AttentionSection` — both computed sections say so in a hint line under the renameable heading). |
| `SectionPickerModal` | the one „Bereich hinzufügen" presentation (type rows, restore rows, name field, Enter-to-create). Persistence stays with the wrappers — `AddSectionModal` creates `custom_sections` rows, `AddLandingSectionButton` registry sections (SHL-29's split). |
| `useAnchoredPopover()` (`lib/popover.ts`) | any new popover: anchor rect, flip-above, clamp, height cap, close on scroll/resize, Escape. Escape is a **capture-phase window listener, not a React `onKeyDown`** — a popover opened by a click has no focus inside its menu. |
| `useRovingFocus()` / `rovingItem()` (`lib/rovingFocus.ts`) | any group of equivalent buttons drawn as one control — pills, emoji presets, picker rows, colour swatches. One tab stop (the *selected* item, or the first), arrows move focus, picking stays with the button. Put the container on the group and nothing else: a text field inside it would lose its ←/→. `Modal`'s `tabbables()` drops the rest by the `tabIndex >= 0` filter it already had. A ▲▼ pair is the same reading with ↑/↓ *performing* the move (`ReorderArrows`). |
| `InlineInput` + `useCommitOnUnmount` (hooks.ts) | click-to-edit that commits on blur. React delegates focus events at the root, so a detached node never reaches `onBlur`. `useCommitOnUnmount`'s `active` argument is load-bearing: a constant `true` makes StrictMode's mount-time cleanup fire the commit while the editor is still open. Pick an `EmptyPolicy` (`ignore`/`clear`/`raw`) explicitly. **Every** inline editor in the task table goes through it, dates included (`type="date"`), which is what makes „a half-typed picker commits nothing" one rule rather than five: `validity.badInput`, not the empty string, is what says the draft is incomplete (WP-43). |
| `normalizeUrl` (`lib/url.ts`) | URL shaping at the **storage and render** boundaries, never inside `openExternal` — `normalizeUrl('/foo')` yields `https:///foo`, which the allowlist would then accept. `openExternal`'s protocol allowlist stays the one place that decides what may open. |
| `ExternalLink` / `EXTERNAL_LINK_CLASS` (ui.tsx) | the anchor contract; `linkify`, `MdLink` and `MdLinkText` all render through it. |
| `parentJoins(alias)` / `parentLive(alias)` (`server/src/lib/queries.ts`) | the soft-deleted-parent filter shared by `listTasks`, `listEvents` and global search. Any new query over a table hanging off a project/artist wants both, or it returns rows no list view shows. A single-FK child takes `crudRouter`'s `parent` option instead; a count that is *not* a row list (`seasonStats`) spells the same `EXISTS` out by hand. |
| `Settings` vs `WritableSettings` (`api/types.ts`) | the read-only seam. A server constant spliced into the response and *not* added to `WritableSettings` is unwritable by construction — that is how `archive_after_days`/`purge_after_days` reach the client. |
| `PrintContacts` / `PrintEvents` / `Empty` / `PrintHeader` / `Section` (PrintSheet.tsx) | the print primitives. A new contact column or changed date fallback belongs there, not in a sheet. **`print-color-adjust: exact` is scoped to `.print-page`**, not to the print block — a new printable surface outside the two sheets does not inherit it and will print `contrastText` foregrounds onto dropped backgrounds. |

### Other client conventions

- One `api` object (`client/src/api/client.ts`) wraps all fetches; components never call `fetch`
  directly. `client/src/api/types.ts` mirrors the server row shapes.
- Writes call `useInvalidateAll()` — the dataset is small and local, so blanket invalidation is
  intentional, not an oversight. It also broadcasts the invalidate to every other window; a write
  path that bypasses the hook opts out of cross-window freshness, which is the second reason to
  stay on it. `refetchOnWindowFocus` is the backstop, wired to real `focus` events because
  `visibilitychange` never fires between two visible Electron windows.
- The error boundary is **app-wide, not per-section**: a throw in one widget takes the whole page
  to the German fallback panel.
- **UI strings are German.** Match the surrounding language in labels, toasts, dialogs and menu
  items; code identifiers and comments are English, except domain fields that are German in the
  schema (`saison`, `erledigt_am`, `priority` values `hoch`/`mittel`/`niedrig`).

## Windows (plural)

N `BrowserWindow`s over the one in-process server, each pinned to its own season.
`createWindow()` (`electron/main.ts`) is the only constructor — the `setWindowOpenHandler` deny
stays, since a child window would not inherit the preload. Secondary windows cascade off the
focused one and load with `?noboot` (they skip the boot gesture; the flag lives in the search
component, where HashRouter never looks). Placement is `electron/cascade.ts`, kept pure so
`check:unit` can drive it: the window size is **fitted to the work area** first — 1440×900 on a
1440×875 laptop panel leaves zero pixels to offset into — and the wrap **advances** through the
anchors that fit instead of resetting to one, which is what made every Cmd+N past the second
land on the same pixel (PR50-06). New windows open unpinned and adopt the registry
default from the first response echo — `switchSeason()` moves that default, so Cmd+N opens the
last-switched season, not necessarily the opener's.

`WINDOW_PREFERRED` (1440×900) and `WINDOW_MINIMUM` (624×560) live in `cascade.ts` rather than
`main.ts`, because the only thing that ever checks them is `cascade.test.ts`, which cannot import
`main.ts` — `electron/tsconfig.json` is `include: ["*.ts"]` and `main.ts` imports `electron`. The
minimum is a **window** size, not a viewport: `useContentSize` is false, so the frame comes off
before the renderer sees anything (a customer's boot log shows a 1440-wide window reporting
`innerWidth: 1426` on Windows 11, and macOS takes nothing off the sides). That difference is why
it is 624 and not 640 — 640 is exactly Tailwind's `sm:` breakpoint, and a floor that lands on it
would give the *same* window a two-column layout on one platform and one column on the other.

**The first window of a launch may come from disk** (`electron/windowBounds.ts`, WP-55): the
first window of a launch — and only it — writes `getNormalBounds()` plus its maximized flag to
`window-bounds.json` in `userData` on `close`, and the first window of the next launch reopens
there. Secondary windows never write, because their position is a cascade offset off whatever was
focused: letting them save it walked the remembered rectangle +28/+28 down the screen on every
launch that quit with two windows open. Secondary windows always cascade on the way in too —
restoring more than one would have to decide which season goes where, which is not something
bounds know. `usableBounds()` is the pure half and the one that is
tested: it refuses a rectangle that no longer overlaps any attached work area, because bounds
saved on an external monitor otherwise restore a window onto coordinates that no longer exist,
and the symptom the user reports is that the app does not start. The file sits beside
`boot-log.jsonl` and deliberately **not** in `seasons.json` — the registry is exported, imported
and backed up, and one machine's monitor layout has no business travelling inside another's data.

**Main never reloads a window to refresh it.** The one thing main knows and the renderers do not
— the registry-wide backup folder changed, from any window's picker, the Datei menu or the
first-launch prompt — travels as `backup-config-changed`, the app's only `webContents.send` and
only `ipcRenderer.on` (`electron/preload.ts` → `onBackupConfigChanged`). WP-54's diagnostics pair
(`get-diagnostics`, `save-diagnostics`) is `invoke`/`handle` like everything else, so that remains
true. `get-diagnostics` takes **no argument**: main derives `boot-log.jsonl`'s path from
`app.getPath('userData')` and hands the renderer finished summary text plus a path it may only
display. A path *from* the renderer would be a `shell.showItemInFolder` pointed anywhere on the
machine — the same hole the scheme allowlist closes for `openExternal` (X-02).

`save-diagnostics` is the exception, and it exists because a `mailto:` cannot carry an attachment
(see `docs/DECISIONS.md`): it writes the full log plus the machine's details to the desktop so the
customer has one named file to drag into their mail. It takes two arguments and trusts neither. The
report body is capped like the boot payload is, and the file name comes from the mail's own
reference — validated by `isBundleRef` in `electron/diagnostics.ts` against `AF-` plus ten digits,
an alphabet in which no separator, no `..` and no drive letter can be spelt. The renderer picks a
*name*; main still picks the directory — and the suffix, when a bundle of that name is already
lying on the desktop, returning the name it actually wrote so the mail can carry that one. So the
rule above is narrowed rather than dropped. That
validator is deliberately **not** imported from the client module that generates refs — main
checking with the renderer's own checker is not checking. Renderers answer the broadcast with
the same coalesced blanket invalidate the BroadcastChannel listener runs. A reload would be the
one path in the app that destroys another window's unsaved editor drafts, which have no
`beforeunload` behind them (PR50-05).

The startup chores are memoized, so N
`boot-settled` calls are one run; `window-all-closed` only fires when the last window closes, so
the quit grace is window-count-agnostic; a second app launch opens a new window
(`second-instance`). The single-instance lock stays — two *processes* would race the port and
corrupt WAL sidecars on import.

## Packaging

`scripts/build.mjs` esbuilds the server to one ESM file (with `better-sqlite3` external — it is
native and electron-builder rebuilds it for Electron's ABI) and main/preload to CJS. Installers are
built in CI, not locally: pushing a `v*` tag runs `.github/workflows/build.yml`, which builds the
macOS `.dmg` and Windows NSIS installer, attaches build provenance (public repos only — the step
is gated on `!github.event.repository.private`), and publishes a release.
Shipping = bump the root `package.json` version, commit, then tag.

The app is not Apple-signed (only ad-hoc signed via `scripts/afterSign.cjs`), which is why the
README documents the `xattr -dr com.apple.quarantine` step.

Icons are generated from `logo.svg` by `npm run icons` (`scripts/icons.mjs`, needs `rsvg-convert`;
the `.icns` step additionally needs macOS `iconutil` and is skipped elsewhere). It writes
`build/icon.icns`, `build/icon.ico`, `build/icon.png` and copies the master to
`client/public/favicon.svg` — all four are committed, and `.gitignore` whitelists the three under
`build/`. `electron-builder.yml` names `mac.icon` and `win.icon` explicitly rather than relying on
the `buildResources` convention.

The two raster targets are **not** the same artwork scaled. macOS gets an 824×824 squircle centred
in 1024, which is Apple's grid — a full-bleed tile renders visibly larger and squarer than every
neighbour in the dock. Windows masks nothing, so there the plate is the icon: full bleed, carrying
the master's own corner radius. Both containers hold one bitmap per size and each is drawn for its
own pixel count: below ~48 px the silhouette's hairline detail (locks of hair, the collar, the
lapel) falls under a pixel and averages into grey, so `dilationFor` grows the outline by a fraction
of a pixel to keep it as ink. That does not make 16 px legible — the artwork is far too detailed —
it makes it clean rather than muddy. Before this script Windows had no `.ico` at all and
electron-builder derived every entry, 16 px included, by downsampling the single 1024 PNG.

Do not ship `logo-cutout.svg` as the app icon — its silhouette is a transparent knockout, so the
dock wallpaper shows through the figure.
