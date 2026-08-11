# Decisions

Things that were considered and **deliberately not done**, with the reasoning that made them
decisions rather than oversights. Most came out of the 2026-07 full-codebase review, where several
were raised more than once by different passes — which is exactly why they are written down.

If you are about to re-raise one of these, the bar is new information, not a fresh opinion.

---

## Windows Authenticode signing — deferred (2026-07-31)

The NSIS installer is unsigned, so SmartScreen warns about an unknown publisher and the in-app
updater cannot verify a signature on the package it downloads. A real fix needs a paid
code-signing certificate.

What stands in for it: the sha512 published in `latest.yml`, fetched over HTTPS, plus the build
provenance attestation carried by the installers from v0.5.0 onward and by *every* published file
— blockmaps and `latest.yml` included — from v0.6.0 onward (attestation needs a public repository,
so it was skipped while this repo was private). Documented as a known limitation in `SECURITY.md`
rather than hidden. Revisit if a certificate is bought.

**`win.publisherName` stays unset (2026-08-04, WP-27).** It is the obvious-looking follow-up when
naming the publisher, and it is the wrong knob. Nothing user-visible reads it while the installer
is unsigned — the name in the file properties and in „Apps & Features" comes from `author` in
`package.json` — but `verifyUpdateCodeSignature` defaults to true, so electron-builder copies it
into `app-update.yml`, and `NsisUpdater.verifySignature` skips its check *only* while that key is
absent. Setting it would turn every in-app update into `ERR_UPDATER_INVALID_SIGNATURE`. It becomes
correct on the same day a certificate is bought, and not before.

## Pre-seed snapshot — declined (2026-07-31)

`npm run seed` is unconditionally destructive: `clearTables()` runs before the CSV/sample branch,
so seeding with an empty import dir replaces a real database. Snapshotting via `VACUUM INTO` before
the wipe was offered and declined — it would leave an unpruned `pre-seed-*.db` in the data dir on
every run.

The single transaction already makes every *failed* seed harmless. A *successful* one is meant to
be destructive; that is what the command is for, and it is documented.

## UNC / network shares as a backup target — unsupported (2026-08-01)

They are refused in the folder picker with a German message rather than silently failing at
startup. The LEG-01 rationale stands: on Windows an outbound SMB write to an attacker-supplied
share leaks the NTLMv2 hash, and `backup_dir` reaches the privileged Electron main process.

Revisit only if a real Windows/NAS user asks.

## Dragging is off while a header-click sort is active (2026-08-02, TTU-04)

Renumbering `sort_order` against a temporary view is what destroyed hand-curated orders. The
alternative — single-row insert semantics on the server — was rejected because „put X where Y is"
has no meaning when the display is not the manual order.

`DragHandle` has a `disabled` variant (dimmed, `cursor-not-allowed`, reason in the `title`) for
this state. Use it rather than hiding a handle.

## Category reassignment stays off the undo stack (2026-08-02, reaffirmed 2026-08-04)

Moving N tasks or events onto a replacement category is a bulk write carrying **one distinct old
value per row**, which `useUndoableDelete`'s single inverse does not express. It would need its own
entry shape on the stack.

Raised by FIX-03, deferred by FIX-08, and confirmed again at the review closeout. The counted
confirmation dialog remains the safety net, as it is for „Endgültig löschen". `POST /api/usage/reassign`
also rewrites trashed rows, which no other route does.

## Cascading the soft-delete — deferred (2026-08-02)

Stamping `deleted_at` on the whole descendant closure at delete time — and un-stamping it on
`/restore` — would make the trash internally consistent and let the guarded purge drain completely,
instead of parking every parent that still has live children.

It is the real cure, but it rewrites delete/restore/undo semantics across both tiers. Deferred
twice: FIX-01 handed it to FIX-08, which handed it on again once `DELETE /tasks/:id/tree` covered
the case that actually hurt. Until then the guarded purge parks such parents, which is safe — it
can never destroy data the user never trashed — merely untidy.

## ~~Foreign layout entries are retained, not position-stable~~ — SUPERSEDED (2026-08-04, landed 2026-08-05)

**The decision below was taken on 2026-08-03, reversed on 2026-08-04 and replaced on 2026-08-05.**
Layouts are now **per-artist and per-project** — `artists.layout` / `projects.layout`, with the
settings array demoted to the *template* a page inherits while its column is `NULL` (`WP-25`, see
[ARCHITECTURE.md](ARCHITECTURE.md)). The shared array this rested on is gone, so the trade-off
below no longer arises: no entry in a layout belongs to another page. Leave the entry here rather
than deleting it — it records why the sharing existed, which the `NULL` fallback preserves for
every page that never gets arranged.

> `artist_layout` and `project_layout` are single settings arrays shared by every artist and every
> project. Moving a section steps over invisible `cs<id>` entries belonging to other entities, so
> their position *relative to* the moved section changes on a page nobody touched.
>
> Accepted: built-in order is global by design, so the other page is rearranged either way, and
> pinning would add a second ordering rule for a case that is not wrong.
>
> The alternative — putting widget placement on the `custom_sections` row, which already carries a
> `sort_order`, leaving the settings array to the built-ins — was rejected here as a schema +
> migration change, **not as a bad idea**. Do not re-raise without that decision.

The reversal came from the other end: a user request to „save a layout as a draft and apply it to
a new artist", which turned out to describe behaviour that already existed — and surfaced that the
*global* arrangement was the actual complaint, not the missing draft feature.

## The saved layout is a second store, not the standard (2026-08-05)

WP-25 folded „save a draft" and „what new pages inherit" into one settings array, on the grounds
that a second storage location was not worth it. **That was wrong in use, and WP-31 split them.**
With one array, saving a layout to apply later also silently changed what every not-yet-arranged
page showed — two different intentions writing the same slot. The keys are now
`artist_layout` / `project_layout` (the standard) and `artist_layout_saved` /
`project_layout_saved` (the one applied by hand).

The trigger was not a defect report but a question — „where can I apply this now?" — asked after
WP-25 shipped. The mechanism had been right and the *vocabulary* had hidden it: the apply action
was labelled „↺ Vorlage" and worded as a reset, so nothing on screen said the feature existed.
A rename alone would have fixed the reading; splitting the store is what made the two actions
independently useful. Both now live in one named `LayoutMenu` that states which page type it acts
on and whether this page follows the standard or has its own arrangement.

## `linkify` is e-mail-only; no `tel:` (2026-08-03)

Phone numbers render as plain text — which is what they always rendered, since the pattern never
matched one. A `tel:` branch would mean widening `openExternal`'s allowlist, which stays
http/https/mailto and remains the single place that decides what may open.

## No test framework — REVERSED (decided ~2026-07-31, reversed 2026-08-06)

This entry was cited by `CLAUDE.md`, `CONTRIBUTING.md` and `.github/workflows/build.yml` for a
week before it existed. Three files said "there is no test framework and no linter — that is a
decision, see `docs/DECISIONS.md`", and the reasoning was never written down here. It is
reconstructed below, then reversed, because a decision nobody recorded is not one anybody can
weigh.

**The original reasoning, as the code shows it.** A framework was never the point; the four
`check:*` scripts are. Each boots the real server and drives the real API, and nearly every one
of their ~153 assertions names a finding ID from the 2026-07 review — they are regression guards
for defects that actually happened, not coverage for its own sake. A framework would have added a
dependency, a config file and a watch mode without adding an assertion. The browser-free rule was
narrower still and had a specific cause: `docs/VERIFYING.md` lists thirteen Playwright traps, each
of which produced a *wrong* result at least once — a check that passed against a defect, or failed
against working code. Committing a suite built on that footing would have institutionalised
false confidence. Verifying by hand against `npm run demo` was the honest option.

**The new information: the product is going commercial.** `docs/DECISIONS.md` asks for new
information rather than a fresh opinion, and this clears that bar in two ways the original
reasoning could not have priced.

The first is exposure. The check scripts are 100% server and persistence layer. `client/src` is
15,002 lines across 75 files with no automated coverage at all beyond the Markdown round-trip,
and `electron/` has none. That was survivable when the only user was the developer and a wrong
render cost a re-render. It is not survivable when a stranger's festival data is behind it and
the feedback path is a support request.

The second is that hand-verification does not survive contact with a release cadence. It is a
person, on two operating systems, before every release, remembering thirteen traps. It worked
because releases were rare and the person who wrote the traps was the one running them.

**What changes.** Vitest over the pure modules — `client/src/lib/{taskSort,taskTree,taskStats,
dragReorder,sections,colors,arrays,url,routeParams,selectOptions}.ts` and `shared/time.ts` —
plus a committed Playwright suite in CI. `docs/VERIFYING.md` stops being a field guide for
throwaway scripts and becomes the specification for the committed ones: its traps are the list of
assertions that would otherwise be wrong.

**What does not change.** The four `check:*` scripts stay exactly as they are. They are the best
thing in the repository and nothing here replaces them; Vitest covers what they structurally
cannot reach, and does not re-cover what they already hold. The no-linter half of the original
decision also stands — it was always a separate question, and nothing above bears on it.

**The trap that comes with this.** `server/src/demo.ts` builds its dates relative to today, on
purpose, so the demo never goes stale. That is right for eyeballing and wrong for assertions. An
e2e suite must pin a clock or assert only relatively; absolute-date expectations will pass for
some weeks and then fail for reasons that have nothing to do with the code.

---

## react-router GHSA-qwww-vcr4-c8h2 — not applicable, not upgradable (2026-08-06)

`npm audit` reports a **high** on `react-router` in `client/`, and it will keep reporting it. It
is not being fixed, for two independent reasons.

**The vulnerability cannot occur here.** It is an RSC-mode CSRF bypass: a React Server Components
request can execute a server action before the framework returns its 400. Auftakt imports
`HashRouter`, `Routes`, `Route`, `Navigate`, `Link`, `NavLink`, `Outlet` and `useNavigate` — that
is all of it, across `client/src/main.tsx` and about ten components. There is no RSC, no data
router, no `loader` or `action`, and no server rendering; the client is a static Vite bundle that
talks to Express over REST. The vulnerable code path is not reachable, and adopting it would be a
deliberate architecture change, not an accident.

**There is no upgrade to take.** The patched `react-router` has no corresponding `react-router-dom`
release yet, so the only path npm can resolve downgrades `react-router-dom` from 7.18.2 to 0.0.0.
Dependabot tried twice on 2026-08-06 and failed both times with exactly that. Forcing it via
`npm audit fix --force` would install `react-router-dom@7.11.0` — a real, breaking downgrade of the
router in exchange for closing a hole the app does not have.

So: `react-router` is ignored for `/client` in `.github/dependabot.yml`, which stops the failing
security update from re-running. `npm audit` is unaffected and still reports it — that is
deliberate, and harmless, because the audit step in `.github/workflows/build.yml` is
`continue-on-error: true` and reports without gating the build.

**Remove the ignore when** `react-router-dom` ships a release that depends on a patched
`react-router`. At that point this becomes an ordinary bump.

## CodeQL's `js/missing-rate-limiting` is filtered out — until the server leaves loopback (2026-08-10)

CodeQL flags every route handler that touches the database as vulnerable to denial of service for
want of a rate limiter. Here that is *all* of them: 18 open alerts across `server/src/lib/crud.ts`,
`routes/entities.ts`, `deleted.ts`, `search.ts`, `export.ts`, `settings.ts`, `usage.ts` and
`dashboard.ts`. `.github/codeql/codeql-config.yml` excludes the query.

**The vector is closed one layer up.** `server/src/index.ts` binds `127.0.0.1` — not `0.0.0.0` —
and the X-01 middleware 403s any request whose `Host` is not a loopback name or whose `Origin` is
off the allowlist, before a handler runs. The threat model there is a hostile page in the user's
browser; the flood CodeQL describes has no way in, and the only caller that reaches a handler is
the user's own UI. A handler is not exposed merely because it is a handler.

**The alerts were noise with a cost.** The finding is per-handler, so any PR touching any handler
re-reports a pre-existing alert as „new in code changed by this pull request" — PR 36 hit exactly
that by editing four lines inside `POST /tasks/:id/move`, which had carried alert #14 since
2026-08-06. Left alone, the check is red on essentially every PR forever, which is how a check
stops being read. Same reasoning as the `continue-on-error` on the audit step in `build.yml`,
one step further: a signal that always fires is not a signal.

**`express-rate-limit` was declined, not deferred.** It would close the alerts legitimately and it
is cheap — the check scripts issue ~65 requests and the client does not poll, so no gate would
notice. It is still the wrong thing twice over. On the desktop app every request arrives from
`127.0.0.1`, so the default per-IP keying is one bucket for the whole application, and a limiter
that ever fires presents to the user as an app that has frozen — a self-inflicted outage
protecting against nothing. And it would not be the middleware a shared deployment needs anyway:
that wants a shared store rather than the in-memory one, plus `trust proxy` so the key is the
caller and not the reverse proxy. Rate limiting is also the *smallest* item on that list, well
behind auth, sessions, per-tenant database routing and TLS. Installing it now would buy a green
check, not a head start.

**Scoped to that one query.** `js/http-to-file-access` (alert #19, the `writeFileSync` in
`saveRegistry`, `server/src/db.ts`) stays on: untrusted data reaching a file write is live for an
app that takes season labels over HTTP and imports user-supplied `.db` and CSV files.

**Remove the filter when** the server binds anything but loopback, or serves more than one user.
That is the change that makes the finding real — and at that point it is the least of what has to
be built.

## The event dialog derives its mode; the checkboxes do not come back (2026-08-10, WP-40)

„Mit Uhrzeit" and „Datum offen (TBD)" are gone, and neither is a candidate for restoration. Both
described a state the fields already carried: an empty date field wrote `start_at = NULL` long
before the TBD box existed (`forStorage('')` returned `null`), and „ganztägig" is simply the
absence of a clock time. The boxes were a second way to say the same thing, and being able to
disagree with the fields is the only thing they added.

What replaced them is a **live summary** under the date rows, rendered from the payload
„Speichern" would send through the same `formatEventWhen` the list and the print sheets use. It
cannot describe something other than what gets stored, which is what a label above a checkbox
could never promise.

The derivation lives in `client/src/lib/eventTime.ts`, not in `EventEditor` — the component has no
test and the client has no browser-level coverage yet (issue #7), so the part that can actually be
wrong sits where `check:unit` reaches it.

**Three inputs are refused rather than interpreted**, all of them states the old single
`datetime-local` could not express. Each is input that would otherwise be discarded on save with
the boxes still showing it — the split fields make it much easier to leave one of them behind:

- *Anything next to an empty start date.* „Datum offen" stores `NULL` and nothing else, so an end
  date, an end time or a start time typed there does not survive Speichern.
- *One clock time without the other.* `end_at` is NULL or sixteen characters and nothing between,
  so an end date without an end time would mean inventing a time or silently discarding the date
  the user just typed.
- *An end before its start.* Split fields plus an end date that inherits the start's make this far
  easier to produce than the old control did, and every reader would render the nonsense
  faithfully. An end *equal* to the start stays legal — a zero-length marker is not a mistake.

An end time **earlier in the clock** than the start is not that third case: with no explicit end
date, `23:00–01:00` inherits the day *after* the start. A festival's late-night events are the
common case, and refusing them as „end before start" pointed at a date box the user had left
empty on purpose. That inherited date comes back in the Ende box on the next open, so moving the
event carries it along (`withStartDate`) — an end on the start's own day, or the one rolled past
midnight, follows „Beginn — Datum". Without that, a shape the dialog had just derived became one
it refused. A range dated by hand on **both** ends is a decision rather than a derivation and
stays where it is.

„Datum offen" survives as an *action*, not a mode: one button, next to the summary, that empties
all four boxes. The state it names is those empty boxes — nothing is stored for it and nothing
reads it back — but emptying them one at a time passes through „Ein Ende ohne Beginn kann nicht
gespeichert werden", a refusal about a box the user had not reached yet. The button is the one
gesture the checkbox used to be, without being a second place the mode can be stated.

The storage form is untouched: `NULL` / 10 characters / 16 characters, `all_day` still `1` for the
date-only shape. `all_day` and a NULL `start_at` remain orthogonal, as before; nothing reads the
flag in that state — the derivation writes the `0` that `demo.ts` and the CSV importer already
store there, so that a date-less row is not rewritten just for being opened.

**A row whose four boxes were never touched is written back verbatim, not derived.** The boxes
describe what the *dialog* can express, which is less than the table holds: the CSV importer
leaves seconds on a timestamp (`toIsoLocal` only swaps the space for a `T`) and reads `all_day`
off the start cell alone, so an imported start and end can disagree about carrying a clock time.
Deriving over such a row rewrites data nobody touched, and refusing it — the rule above would —
locks the user out of the title and the notes for a shape they did not create and cannot see.
Reading a value back unchanged cannot be wrong, so in that state there is nothing to refuse
either. Repair happens when the user edits the times, not when they open the dialog.

---

## The Übersicht shows every upcoming event (2026-08-10, WP-33)

The dashboard used to ask for two lists — the next 14 days, plus the first six events beyond that —
and render the second one only in the `else` of „the first is empty". The customer read it as a
limit of six; it was worse than a limit, because one event this week hid every later one. Four
things were decided in fixing it, and each is easy to undo by accident later.

**Past events stay off this list.** It answers „was kommt". The full history is on the artist and
project pages, which list every event of their parent, and the print sheets take it from there.
Putting the past back here is a decision to re-make, not an oversight to fix. The one thing that
must keep working is the *running* multi-day event: `upcomingEvents` tests
`COALESCE(end_at, start_at)`, not `start_at`, and a client-side `daysUntil >= 0` filter added on
top of that would delete exactly those rows.

**Nothing is capped server-side, ever again.** `LIMIT 6` was the reported bug: the app withheld
data the user had entered, with nothing on screen to say so. The only shortening left is
`PREVIEW_ROWS`, which all three blocks pass to `UpcomingList`, and it exists only because it is
paired with „+ N weitere anzeigen". A cap without an affordance that opens it is data loss with
extra steps. The response is therefore unbounded in the event dimension — as it already was for
`tasks` — and that is the intended shape, not an oversight awaiting a `LIMIT`.

„Danach" was capped first because it was the obvious offender, but the argument was never specific
to it: „Datum offen" sits at the *top* of the section, where a Notion import with 40 undated events
pushes „Aufgaben" and „Braucht Aufmerksamkeit" off the first screen, and the near block becomes the
same list once `event_window_days` is raised — 365 is legal, and the window then holds the season.
`UpcomingList`'s `cap` is required rather than optional so that a fourth block cannot be added
uncapped by leaving the prop off.

**Unbounded in rows is not unbounded in columns.** `upcomingEvents` carries its own column list
rather than `EVENT_SELECT`'s `e.*`, because `notes` is rich-text HTML this list never renders and
`useInvalidateAll` refetches the dashboard after every write — a season of long notes turned each
task edit into a several-hundred-KB round trip. That is not the `LIMIT` coming back: no row is
withheld and nothing on screen changes, which is the whole difference. The cost is a contract in
two places — the query and `UpcomingEvent` in `client/src/api/types.ts` — so `check:api` asserts
both halves, `notes` gone and every rendered column present. `typecheck` cannot: the query returns
`unknown[]`, so restoring `e.*` would compile.

**The window is split client-side**, in `client/src/lib/eventGroups.ts`, for the reason the WP-40
entry above gives for `eventTime.ts`: `check:unit` reaches `lib/`, and nothing reaches the page.
The consequence is deliberate and worth stating, because it looks like lost coverage — the +14
edge is no longer a `check:dates` property. The *today* edge still is, and that is where SDL-10
actually sits: a bare `date('now')` gets it wrong in both directions, which is what the two
25-hours-apart zones exist to catch.

**The window is a setting; the heading default is not.** `event_window_days` follows
`attention_window_days` exactly — scalar string, clamped on the client, one line of server
allowlist. `'dash.events'` drops „· 14 Tage" so that a default heading cannot contradict a setting,
and so that it cannot claim a boundary that no longer withholds anything. Renamed headings are
overrides and survive untouched.

---

## A column you cannot see does not order the table (2026-08-10, WP-32)

The complaint was that a new task lands at position 2 or 3 instead of on top. The reason was
invisible: `task_sort` shipped `[status, priority, due]` while the Priorität and Fällig columns ship
`enabled: 0`, so the table was ordered by two columns that render nowhere.

**The general rule replaces the specific fix.** A sort rule is in effect only while its column is
visible — hidden *or* deleted makes it inert (`activeSortRules`, `client/src/lib/taskSort.ts`).
`manual` is exempt; it is `sort_order`, not a column.

That is what makes the shipped default's change to `[status]` need **no migration**, and the
migration is the part deliberately not built. TODO.md planned a self-detecting one that rewrites
`task_sort` only when the stored value equals the old default. It would have had to guess: a stored
`[status, priority, due]` is indistinguishable from a hierarchy the user assembled by hand to be
identical, and rewriting it would take priority ordering away from the one user who *did* show the
column and wants it sorted by it. The filter fixes both cases with no write at all, and because the
rule is filtered rather than removed, showing the column brings its ordering back.

The rejected alternative for the ordering itself: **temporarily pinning** the new row to the top
until the next navigation. A row that sticks and then jumps explains itself to nobody.

## The server's baseline order is the manual order (2026-08-10, WP-32)

`TASK_ORDER` (`server/src/lib/queries.ts`) ranks by `sort_order` and nothing else, with done rows
sinking. It ranked by priority and due date before, and the client keeps the server's order verbatim
whenever no rule is in effect (`sortTasks` short-circuits) — so those keys were rules nobody could
see in Settings and nobody could switch off, reachable from the same gap WP-32 is about. The
consequence is accepted deliberately: the print sheets, the .xlsx export and the archive page render
in server order and therefore now group by hand order rather than by priority. `priorityValues()`
died with the priority `CASE`; the client still ranks by the configured option order, where the
column is visible. TTU-11's check case was re-aimed at the new invariant, not deleted.

**A created task is stamped server-side** (`leadingSortOrder`, `routes/entities.ts`): the client
knows only its rendered siblings, never sees archived rows and cannot see the trash at all. The
scope is the `(artist_id, project_id)` pair and deliberately *not* `parent_id`, because a promoted
orphan renders in a list a `parent_id` minimum cannot see.

**`POST /tasks/:id/move` stamps it too, as a fourth placement field.** The first cut left
`sort_order` alone, reasoning that every field the endpoint writes is one the caller passes back and
that this symmetry is what makes the same call its own undo. That was wrong on the facts: an ordinal
means nothing outside its own list, so carrying it across dropped the moved task at an arbitrary
spot in the destination — below every open row coming from a hand-dragged list, above a
deliberately-placed first row coming from a composer-only one. The symmetry is kept by *widening*
the contract instead: a move with no `sort_order` lands the task at the head of its destination like
a new one, and the undo passes the captured ordinal back to restore the exact slot.

**Readers that are not the task table ask for `order=due`.** The Archiv page, the .xlsx export and
the print sheets render `listTasks` output verbatim and span several lists at once, where a per-list
ordinal interleaves them and prints a task due tomorrow below one due in six months. They get
`TASK_ORDER_DUE` — the pre-WP-32 ordering minus priority, which is a hidden column and stays out
under the same rule as everywhere else.

**A new and an upgraded season do diverge**, and that is the accepted cost of not migrating: show
the Fällig column in both and the old season's dormant `due` rule wakes up while the new one has no
such rule to wake. Both states are visible and editable in Einstellungen, which is the property that
makes it survivable; a migration that silently rewrote the old season's hierarchy would not be.

## The boot gesture is conditional, and the condition is measured (2026-08-11, PR #35)

The obvious-looking question about `client/index.html` is why the animation does not simply start
when the overlay paints, the way it did when #32 shipped it. Because that is the worst possible
moment: the overlay paints exactly when the renderer begins fetching, parsing and compiling a
1.3 MB bundle and mounting React, so the gesture's frames competed with the app's own startup on
every launch.

**It cannot be composited out of that competition.** This was measured, not assumed — the
`Animation` trace events in `disabled-by-default-devtools.timeline` carry Chromium's own verdict.
`bootMotion` reports `compositeFailed: 8320, unsupportedProperties: ['offset-distance']`, the two
trail strokes report `8224` for `stroke-dashoffset`, the hand's fade reports `128` because its
element carries `offset-path`, and the trail group's stacked opacity pair reports `64`. Five of
twelve animations are drawn by the renderer's main thread, including the hand travelling the path,
which is the gesture. Rewriting them to be compositable is not available: the motion *is* the path
and the trace *is* the dash.

So the gesture waits instead. Phase A holds a still, flat frame until the app reports mounted and
the main thread yields an idle callback; phase B releases the animation onto a thread with nothing
left to do. Three consequences that look like arbitrary choices and are not:

**Phase A shows nothing — not the parked hand, and above all not the wordmark.** The gesture's
entire payload is the wordmark *landing* on the ictus. A wordmark already on screen makes it land
on nothing. An empty coloured rectangle also reads as a window that has not drawn yet rather than
as a stall, which matters because it may be on screen for a while.

**Past 1200 ms the gesture is forfeit.** The deadline looks harsh beside the 2700 ms it guards.
Hold plus gesture plus fade is already ~3.8 s of splash at that deadline; at the 2.5 s that feels
natural it would be ~5.1 s, which is worse than never animating. The gesture is a reward for a fast
boot, never a tax on a slow one. Measured cost when the app is fast: reveal moved from 2630 ms to
~2713 ms, so the hold buys the guarantee for ~85 ms.

Those figures use 2600 ms for the gesture, not 3070. The reveal fade starts at `--ti + 350` =
2230 ms and runs 370 ms, so it overlaps the 2700 ms envelope's tail instead of following it, and
the `animationend` that removes the node lands *before* the choreography's nominal end. Adding the
envelope to the fade was the intuitive reading and it was wrong by 470 ms, in the failsafe, in the
bail's delay and in two documents.

**The frame watchdog is only valid while the gesture is main-thread-bound.** It judges rAF cadence,
which is a fair proxy for what the user sees *because* the frames are drawn by the thread rAF runs
on. If the trail is ever removed and `offset-distance` becomes compositable, this inverts: the
watchdog would abort a perfectly smooth animation whenever something unrelated occupied the main
thread. Re-run the trace check before assuming it still earns its place, and delete it if it does
not.

**It judges the whole gesture, in rolling windows, and it has one deliberate blind spot.** Judging
once and retiring left ~92 % of the animation unmonitored, which is where the late stutters live —
a query retry's backoff, a route effect, a decode, a GC. The blind spot is the price of the fix to
its other half: the „uniformly slow" test used to be a flat 22 ms median, justified as „every panel
this ships to is 60 Hz or faster". That is not true of a 4K panel on HDMI 1.4 at 30 Hz, and not true
of a ProMotion display, which idles its refresh rate down over the still frame of phase A and ramps
back up over exactly the frames the watchdog measures — both aborted smooth gestures, and a fixed
30 Hz panel could never play one. The limit is now the floor *or* an allowance over the fastest
frame that display has actually delivered, whichever is larger. What slips through is sustained
contention so uniform that not one frame in 2.6 s lands on vsync: from inside the page that is
indistinguishable from a genuinely slower panel. Real contention jitters, and `drops` catches
jitter.

**Every boot now files a report, because the first field stutter was unfalsifiable.** The first
launch after a local install visibly hitched once — and left nothing to read: `data-boot` and
`data-abort` die with the overlay node, so there was no way to tell whether the watchdog had
aborted, whether the gesture had played at all, or which frame was late. The overlay now folds
what the watchdog measured into a small JSON report in its single exit path — outcome, the door
the reveal came through, ready/start/end on the deadline's own clock, frame statistics — and
writes it to `localStorage['auftakt-boot-report']` and through the `bootSettled` bridge. Three
recording gaps close with it, and all three stay unjudged: the exempt first frame is kept
(`frames.warm`); the gap between release and the first rAF callback is kept (`frames.lead` — the
animations' clocks start at style application, so a long first presentation is a jump no delta
ever carried); and the reveal-fade tail is recorded instead of abandoned (`tail`, with a
retrospective verdict). The watchdog's rules are unchanged: recording past `fading` keeps every
property that made stopping the *judging* there correct, because the judge is unreachable from
the tail path. The report is also the next thing stored in localStorage after the emoji list
above — an origin change orphans it, which costs one launch's diagnostics and is accepted.

**A boot that collapsed reveals through a different door.** `signalFailed()` rather than
`signalReady()` from `window.onerror`, from an unhandled rejection, and from `ErrorBoundary`. Both
bring the overlay down — that part was never in question — but the failure paths were previously
indistinguishable from a healthy boot, so the overlay answered a window that had just thrown away
its whole tree with the full three seconds of celebration and *then* showed the blank. The signal
is an attribute set before the event, because the consumer is an inline script that knows nothing
about the bundle.

**The startup backup moved behind an IPC signal but kept an 8 s fallback.** ELP-08 already took it
off the awaited path; that was never the same as taking it off the *thread*. `runStartupBackup`
POSTs to a server imported into the main process, so its `VACUUM INTO` per season is synchronous
there — no input routing, which is why click-to-skip went dead mid-gesture — and `await loadURL`
resolving on `did-finish-load` timed it to land exactly when React had mounted. It now waits for
the overlay's own exit path. The fallback is not optional: a renderer that crashes before the
reveal must not cost the user their backup for that launch.

There are two fallbacks, and the second one is why the first is not enough. The 8 s timer lives in
the process `app.quit()` destroys, so on Windows and Linux a user who closes a wedged window — or
just an impatient one, during the hold — took the whole launch's backup and update check down with
it, silently, which is the exact outcome the fallback exists to prevent. `window-all-closed` now
releases the chores itself and lets them settle before quitting, capped at 5 s so a wedged server
cannot turn „close the window" into „the app will not exit". `ensureBackupDir` declines to prompt
when there is no window left to prompt over: a folder picker on an empty desktop after the user
quit reads as a hang, and leaving the flag unset means the next launch asks properly.

**Reduced motion still removes the overlay outright rather than getting phase A.** A static hold
would arguably suit those users better than the app popping in mid-mount. But
`newContext({ reducedMotion: 'reduce' })` is the documented escape hatch that every driving script
in `docs/VERIFYING.md` relies on, and quietly turning it into „hold, then reveal" would break them
all. Worth revisiting only behind a separate opt-out that Playwright can use first.

---

## Known sharp edges with no owner

Real, understood, and deliberately not scheduled. Each carries a comment at its own site; none is
worth a backlog entry, because the cost of the fix exceeds what it buys today. Listed so that
finding one does not read as a discovery.

- **Landing ids are reused.** `nextId` is `max(surviving ids) + 1` (`patchLanding`, `db.ts`), so
  deleting the highest-numbered section and adding one hands out the same `lt<id>` again. Every
  holder of the key survives that today — the undo restores the row carrying its own id, `prepend`
  replaces an existing entry rather than adding a second. A monotonic counter in `seasons.json`
  would close it properly.
- **`RecordFormModal` is not generic over its field names.** That is what would close the rest of
  CCL-24's excess-property gap; judged disproportionate against typed payload mappers, which
  already cover the four form paths.
- **The `tasks → columns` closure is one-directional.** Copying „Termine"/„Projekte"/Links *without*
  „Einstellungen" leaves rows whose `type`/`status`/`category` names an option the target's lists
  do not offer — the same class as a task whose status names no Status option. The forward edge
  (tasks force columns) is closed; the inverse is not.
- **The error boundary is app-wide.** `SectionArranger`'s sections are the obvious granularity for
  containing a throw to one widget.
- **The three settings option lists can be emptied.** `requireNonEmpty` guards built-in *columns*,
  but „Termin-Typen" with zero types leaves EventEditor's dropdown empty. The removal dialog
  degrades safely when rows still hold a value; an *unused* list can still be emptied.
- **`first_run_done` is close to redundant.** `ensureBackupDir` returns early whenever `backupDir`
  is set, so the flag now means „a folder was chosen at least once" and only matters if
  `backup_dir` were later cleared. Left as a guard.
- **Moving the app origin to `127.0.0.1` empties the emoji picker's „frequently used" list, once.**
  Chromium buckets web storage per origin, and `http://localhost:4317` and `http://127.0.0.1:4317`
  are two of them. The audit that cleared the change checked our own code, where the only key is
  `auftakt-booted` and it really is sessionStorage — but `emoji-picker-react` keeps `epr_suggested`
  in localStorage, reachable from the notes editor. Upgrading past that build resets it. The old
  bucket is still on disk and unreachable: there is no supported way to read another origin's
  localStorage from the main process, and this does not justify inventing one. Recorded because the
  next thing that lands in localStorage will not be an emoji list.
- **The Übersicht's event blocks are split at fetch time, not at midnight.** `groupUpcomingEvents`
  takes „today" from its default `fromUtcMs`, read once inside a `useMemo` keyed on the list and
  the window, and the query sets `refetchOnWindowFocus: false` — so an Electron window left open
  overnight keeps yesterday's boundary until some write invalidates `['dashboard']`, and an event
  that became „heute" stays under „Danach". Not a regression from WP-33 moving the split off the
  server: that same window did not re-fetch before either, so it showed a stale split then too. A
  rollover timer or a focus refetch would close it; both cost more than one stale heading buys on
  a desktop app that is usually reopened, not left running.
