# Verifying a change by hand

The automated gates are `npm run typecheck` and `npm run check` (backup · dates · api · markdown).
Everything they cannot reach — anything that only exists once a browser has laid the page out — is
verified by driving the dev server, and this file is the accumulated cost of doing that.

Every entry below is something that produced a **wrong verification result** at least once during
the 2026-07 review: a check that passed against a defect, or failed against working code. They are
listed because each one costs half an hour to rediscover.

## Setup

```bash
npm run demo          # rebuild .demo and start Express :4317 + Vite :5317
```

Then drive `http://localhost:5317/#/artist/1`, `#/project/1`, `#/archiv`, `#/einstellungen`.
Use headless Playwright or curl — **not** `npm run electron:dev`, which opens a real window on the
user's desktop.

**The Übersicht is `#/dashboard`. `#/` is the season landing page** — a different screen with no
task tiles and no „Nächste Termine". Asserting dashboard content against `#/` fails against
working code. The print sheets are `#/print/artist/:id` and `#/print/project/:id`.

### Before believing any result

- **Confirm which database you are talking to.**
  `curl -s localhost:4317/api/seasons` and look at `activeFile`. `npm run demo` sets
  `AUFTAKT_DATA_DIR`; a bare `npm --prefix server run dev` does not, so it silently comes up
  against `.data` on the same port and the browser keeps talking to it. A leaked dev server from an
  earlier session cost one full verification run, and the app looked broken rather than the setup.
- **`npm run demo:seed` `rmSync`s the whole `.demo` directory**, so re-seeding under a running
  server leaves it holding a deleted file. Restart through `npm run demo`.
- **…and `npm run demo` is not by itself proof that it worked.** With a server already on 4317 from
  an earlier session, a full `npm run demo` still printed its seed counts *and*
  „Auftakt server listening on http://localhost:4317", and `activeFile` still read
  `.demo/auftakt.db` — while `GET /api/dashboard` answered from the pre-reseed database and was
  missing a row that `sqlite3 .demo/auftakt.db` showed was there. Both documented ways of
  confirming the target pass in this state. What catches it: `ps -o lstart= -p $(lsof -ti tcp:4317)`
  against the seed time — a server older than the reseed is answering from a deleted inode — or
  comparing one API response against the file directly. Kill both ports, then `npm run demo`.
- Kill stray servers by port, never with a broad `pkill`:
  `lsof -ti tcp:4317 -ti tcp:5317 | xargs kill`. **The `-i` must be repeated.** macOS ships
  lsof 4.91, which reads the second `tcp:…` as a *filename*, prints its usage block to stderr and
  exits non-zero having matched nothing — so `lsof -ti tcp:4317 tcp:5317` kills neither server
  while looking like it did, and the next run then talks to the leaked one.
- **…but a free port is not proof of a clean machine.** `npm run demo` reaps its own tree now —
  `scripts/demo.mjs` runs it in its own process group and takes that group down on SIGINT, on
  SIGTERM, and on finding itself reparented — so Ctrl-C and an ordinary kill both leave nothing
  behind. What survives is `demo.mjs` itself being `kill -9`ed, and the survivor is then the
  `tsx watch` parent, which holds **no port**: `lsof` reports the machine clean while a git
  operation touching `server/src` is enough for that orphan to start a server on 4317 seconds
  later. Three such stacks were once found in one repo, the oldest three weeks old. When a port is
  busy and nothing explains it, sweep by process, not by port:
  `ps -eo pid,lstart,command | grep code/auftakt`, and kill the `concurrently` / `tsx watch` /
  `vite` parents by pid (`kill -9` for old ones that ignore SIGTERM).
- **`npm run demo` has no Vite keyboard shortcuts.** Its stdin is deliberately `ignore`d, because a
  process group that reads the terminal in the background is stopped with SIGTTIN, and the tree
  runs in its own group so it can be reaped. `r`, `u`, `o`, `c` and `q` therefore do nothing;
  Ctrl-C is unaffected. `npm run dev` still has them.
- **A running dev server hijacks a *packaged* app started next to it**, which matters when working
  through `BACKUP-TESTING.md`. `waitForServer()` polls `/api/health` on 4317 and the dev server
  answers 200, so the gate passes, the window loads against `.data`, and a `--user-data-dir` meant
  to isolate the run is silently void — every result after that describes the wrong database. The
  packaged server's own `EADDRINUSE` surfaces separately, as a generic Electron error dialog at
  unrelated timing, which reads as a different bug. Kill dev servers first, and run only one
  Auftakt at a time. `AUFTAKT_PORT=4417` moves the packaged app if you truly need both;
  `AUFTAKT_DATA_DIR` will *not* move it, because `electron/main.ts` overwrites that variable
  before the server is imported.

## Playwright traps

- **The boot animation never plays on the dev server**, and that is the point. `#boot-overlay` in
  `client/index.html` is gated on `'%PROD%' !== 'true'` — Vite's HTML env replacement, applied by
  the dev middleware as well as the build — so against `npm run demo` on `:5317` the node is
  removed before React mounts and a driving script can ignore it entirely. Everything below applies
  only when you verify against a **built** bundle: `npm run build`, then the server on `:4317`.
  There, the overlay covers the viewport for ~2.6 s and keeps its pointer events the whole time, so
  it swallows the first interaction of a run — `locator.click()` rides it out through actionability
  retries, but a raw `mouse.click()` at coordinates only skips the animation. `#root` carries
  `inert` for the same interval, so a keyboard-driven script finds nothing focusable until the
  reveal. And even on `:4317` it plays on a **cold** boot only: the inline head script sets
  `sessionStorage['auftakt-booted']`, so every `reload()` in the same context comes up without it.
  Both directions read as a bug — the overlay being absent after a reload is correct, and a script
  that opens a context per scenario pays the 2.6 s each time. `newContext({ reducedMotion:
  'reduce' })` removes it outright; to look at a single frame,
  `document.getAnimations().forEach(a => { a.pause(); a.currentTime = ms })` (seeking past ~2600 ms
  fires the fade's `animationend`, which removes the node — that *is* the reveal, not a lost
  overlay).
- **`page.goto` to the same hash is a no-op** under `HashRouter`, so a dialog left open by the
  previous scenario silently eats every click. Call `reload()` after `goto`.
- **`locator.isVisible()` does not wait** — it samples immediately, so it reads the state before an
  aborted request resolves. Use `waitFor`.
- **Labels and table headers are CSS-uppercased.** `innerText` returns `DEADLINE` and
  `PRUNE-TEST`; a case-sensitive match finds nothing. Match case-insensitively.
- **`Label` is a bare `<label>` with no `htmlFor`**, so `getByLabel` finds nothing. Address modal
  fields by placeholder — except in the event dialog, whose fields have none. Its four date/time
  inputs carry an explicit `aria-label` (`Beginn — Datum`, `Beginn — Uhrzeit`,
  `Ende (optional) — Datum`, `Ende (optional) — Uhrzeit`) and are the one place `getByLabel`
  does work. Title, Ort and Notizen there still have to be addressed positionally.
- **`TextInput` renders no `type` attribute** unless one is passed, so `input[type="text"]` misses
  every untyped field. In the event dialog `input:not([type])` matches Titel and Ort — two, but
  only while the Notizen link bar is closed: `RichTextEditor` mounts `Link-Text` and
  `Link-Adresse` on demand and those are untyped too, so the same selector counts four with the
  bar open. Beginn and Ende are four `type="date"`/`type="time"` inputs (WP-40); they used to be
  two of the untyped matches. The selector is unchanged, any count around it is not.
  In a `RecordFormModal` the text branch passes `type="text"` explicitly, so `input:not([type])`
  is **not** empty there either: `type: 'color'` renders its hex box through `ColorField`, which
  builds its own untyped `TextInput`. The Artist and the Projekt dialog therefore hold exactly one
  untyped input each — the one next to the colour swatch — and only Kontakt, Link and Dokument
  have none at all.
- **Scope modal selectors to the dialog**, not the page: `input:not([type])` also matches boxes on
  the page behind it, so `.first()` silently addresses the wrong field and the dialog looks
  unresponsive. `div.max-h-\[calc\(100vh-5rem\)\]` is `Modal`'s own card; `.last()` of those is
  the topmost dialog.
- **An event row is `li.group` and its ✎ is `[title="Bearbeiten"]` — neither is unique to events.**
  Contact rows are `li.group` too, and the same `[title="Bearbeiten"]` button sits on every
  contact, link and document row, so on an artist page an unscoped selector picks whichever card
  the layout puts first. Scope to the section: `[data-section="termine"] li.group` (the arranger
  stamps `data-section` outside arrange mode as well). Clicking the title text does nothing — only
  the button opens the editor. „Neuer Termin" is reached through the `+ Termin` button in the
  „Wichtige Termine" card, not a global one.
- **A `type="date"` or `type="time"` box is three tab stops, not one** — the native picker tabs
  through its own segments. Getting from Titel to the Notizen text in the event dialog takes 17
  presses, so a fixed-length tab walk silently ends up *inside* a picker and reads as a broken tab
  order. Walk until the expected element has focus instead of counting. The rich-text toolbar is
  `tabIndex={-1}` and deliberately never appears in that walk; address its buttons by `title`.
- **`Modal` traps Tab**, so a walk that expects to reach the page behind an open dialog loops
  inside it forever. `PillSelect`'s option menu is the exception the trap makes: it portals to
  `document.body`, so while it is open `document.activeElement` is *outside* the dialog card and
  moves with ↑/↓, not Tab.
- **`InlineInput` autofocuses and React sets `value` as a *property***, so `input[value="…"]` never
  matches. Use `input:focus`.
- **Setting `input[type=color].value` directly is deduped by React's value tracker.** Use the
  native setter.
- **A status change re-sorts the task table**, so `.first()` addresses a different row afterwards.
  Assert the write, not the label.
- **`input[placeholder*="Aufgabe"]` matches the global search box, not the task composer** — the
  search placeholder is „Suchen … (Künstler, Projekte, Aufgaben, Termine, Kontakte)" and it comes
  first in the DOM, so `.first()` types into the header and the table never changes. Anchor it:
  `input[placeholder^="Neue Aufgabe"]`, or `^="Neue allgemeine Aufgabe"` on the Übersicht.
- **The task title cell also carries the subtask counter** („Requisiten sichten\n0/3"), so an
  `innerText` comparison needs the first line only.
- **The Einstellungen tabs are links, not buttons** — `getByRole('button', …)` waits for ever.
  Navigate straight to `#/einstellungen/aufgaben`.
- **A drag must start on the ⠿, not on the row.** Every reorderer runs `useDragReorder` in
  `mode: 'armed'`, so the item is not `draggable` until a primary-button `pointerdown` lands on
  its handle — `locator.dragTo()` on the row body is a silent no-op that reads as "reordering is
  broken". What works: hover the row, `mouse.move` onto `[title="Zum Verschieben ziehen"]`,
  `mouse.down`, `mouse.move` to the target with `{ steps: … }`, `mouse.up`. The handle is
  `opacity-0` until the row is hovered but still hit-testable, so actionability passes either way.
- **`keyboard.down` emits one keydown.** A repeat-key defect (TTU-24) needs events dispatched with
  `repeat: true`.
- **Some repros only fire inside a refetch window.** On a local server the refetch beats a human's
  second click, so the defect looks fixed when it is not — delay the relevant request with
  `page.route` (CCL-21 and PGS-10 both need `GET /api/settings` held back).
- **A hash navigation does not refetch `['settings']`**, so a fixture written straight to the API
  needs a real `reload()` or the page persists the stale array over it.
- **Clean up fixtures between runs.** A script that throws mid-way leaves its rows behind, and the
  next run then matches two elements with the same name and picks the wrong one.

## Print and PDF

- **`page.pdf()`'s default `printBackground: false` *is* the SHL-11 repro** — and a screenshot can
  never show that defect, because screenshots always paint backgrounds.
- **`print-color-adjust: exact` is scoped to `.print-page`**, not to the print block. Chromium's
  „Hintergrundgrafiken" is off by default in the browser *and* in Electron's `window.print()`.
- **`sips -s format png` renders only page 1** of a PDF on macOS (no poppler needed). Page-level
  *text* needs `pdfjs-dist`, which joins glyph runs **without spaces** — match paging assertions on
  whitespace-stripped text.
- The demo's project sheet only crosses a page boundary at a group header with a tuned fixture
  (55 „new" + 6 „active" tasks); neighbouring counts silently miss it.

## Fixture facts about the demo

- **The default `task_sort` is `[status]`, and a rule for a hidden column is inert.** A season
  created before WP-32 still *stores* `[status, priority, due]` and behaves identically — Priorität
  and Fällig are `enabled: 0`, so `activeSortRules` drops them; there is no migration. A repro that
  needs a priority or due rule must **show the column first**
  (`PATCH /api/custom-columns/<id> {"enabled":1}`), or the rule does nothing and the check passes
  against a defect. A „keine Regel" repro still needs `PATCH /api/settings {"task_sort": []}`.
- **A newly created task carries a *negative* `sort_order`** — the transform stamps it one below
  its list's minimum so it lands on top. Assert relative order, never a literal ordinal, and expect
  the newest row first in any list nothing has been dragged in.
- **Under the default `[status]`, any two open rows of the same status are draggable.** The tuned
  same-rank block in `demo.ts` (tasks 41–45) is no longer the only place a drop is accepted; task 45
  is the odd rank there, and it is odd by *status* now, not by priority.
- **The dashboard's „Nächste Termine" has three blocks, and which one a row is in is the
  assertion**: event 8 under „Datum offen", then 2/5/1/10 inside the 14 days, then 4/3/7 under
  „Danach". Event 10 is the one to check after touching the split: it starts at 23:00 on day 14
  and ends at 01:00 on day 15, and it belongs to the *near* block, because a row is bucketed by
  its **start** day. All three blocks cap at 8 rows, but **none of them collapses on the demo** —
  the largest holds four — so „+ N weitere anzeigen" is not reachable here without POSTing more
  events first. Event 6 is nine days past and event 9 is soft-deleted; **both must be
  absent**, and either one appearing is a real bug, not a fixture quirk. Assert on block
  membership, not on a total — the event fixtures grow. And every offset is relative to the
  **seed day**, so a `.demo` built days ago drifts rows across the window boundary; rebuild with
  `npm run demo` first.
- **The project and artist pages ship `defaultHidden={['stats', …]}`**, so the „Fortschritt" tile
  is *not on screen* until a layout that names it is written. The dashboard's is.
- **Artist 2 and project 3 ship their own `layout`; artists 1/3/4 and every other project are
  `NULL`** and follow the `artist_layout`/`project_layout` template (WP-25). So the two states are
  both on the demo — and a check that arranges one artist must assert against a *different* one,
  because asserting against artist 2 proves nothing. Artist 2 also un-hides `stats`.
- **A layout assertion reads `[data-section]`/`[data-width]`, not the headings** — the arranger
  stamps both on every rendered section, and in arrange mode the in-card heading is hidden anyway.
- **The demo seeds `artist_layout_saved` but leaves `artist_layout` unset**, so „Gespeichertes
  Layout anwenden" is live from the first run while „Auf Standard zurücksetzen" starts disabled.
  The two are separate stores — asserting one after writing the other is how you prove the split.
- **The layout menu is a portal at `[role="menu"]`, not a child of the toolbar.** Its rows are
  `[role="menuitem"]`; the heading and status line are its first two `div`s. It closes on Escape
  (capture-phase, from `useAnchoredPopover`) and on a click on the `.fixed.inset-0` backdrop.
- **`Layout · Künstler` is composed from a renameable label** (`artist.kicker`). A check that the
  heading is right should rename it via `PATCH /api/settings {"labels":[…]}` and reload — that is
  the case the non-fused wording exists for, and a hardcoded assertion passes against both.
- **An *empty* custom widget's 🗑 deletes straight away** — `nonEmptyKeys` is what routes it to the
  „Bereich löschen" dialog, so a script that waits for „In den Papierkorb" after binning a fresh
  widget times out against working code.
- **Project 1's notes contain a Markdown table**, so `thead` first matches *that*, not the task
  table. Project 1 also shares its name with its opening concert, so a text match there hits the
  page heading rather than the event row.
- **`getByRole('button', { name: 'Einfügen' })` is ambiguous in the rich-text editor** — it hits
  the toolbar's „Tabelle einfügen" (via its `aria-label`) as well as the link bar's „Einfügen".
  Use `{ exact: true }`. Every toolbar button carries `title` *and* `aria-label`, so accessible
  names there are substrings of one another far more often than the markup suggests.
- **The rich-text toolbar is not the same on every field.** `RichTextEditor`'s `compact` trims it
  to B/I/U, bullet, link and emoji — headings, ordered list, quote and the table button are
  simply absent. Only the contact-row note and the task-comment cell are compact; asserting on
  „Tabelle einfügen" anywhere else is fine, asserting on it there will always fail.
- **The table controls („Zeile +", „Spalte +", „Tabelle löschen") render *below* the editor** and
  only while the caret is inside a table. A script that clicks the table button and then looks
  for them above the text finds nothing.
- **The project-scoped column manager lists nothing on the demo** (there are no project-scoped
  columns) — drive those cases from Einstellungen instead.
- **There are two `type="number"` inputs, one per „Zeitfenster"**, and they sit on different
  Settings tabs: „Braucht Aufmerksamkeit" under `#/einstellungen/aufgaben`, „Termine in der
  Übersicht" (the „Danach" divider) under `#/einstellungen/kategorien`. Neither tab's „Speichern"
  is its page's only one — scope to the card.
- **`paletteFor('Deadline')` is `#fee2e2`, the same colour `LEGACY_EVENT_COLORS` holds for it**, so
  „Deadline" cannot distinguish the two code paths. „Termin" can (legacy `#e2e8f0` vs palette
  `#dcfce7`).
- **Hiding a *filled* built-in opens the „Bereich ist nicht leer" dialog**, whose overlay then eats
  every following click. An *empty* custom widget skips the dialog entirely.
- **The link dialog's „Kategorie" is `type: 'pills'`, not a `<select>`** — `selectOption` finds
  nothing. The options are `[aria-pressed]` buttons and the current value is
  `[aria-pressed="true"]`; a second click on it clears the field.
- **Project 1's „Technik" group is the only link group with two rows**, so it is the only place a
  reorder is observable, and the group's `sort_order` values are *interleaved* with the other
  groups' (0, 5, 6, 7) — which is the case a per-group reorder must not disturb. The group
  headings are `span.rounded-full` inside the list's `div.space-y-4` and CSS-uppercased.

## What is not verified this way

The Electron half — dialogs, relaunch, the packaged app against a real data directory — has its own
checklist in [BACKUP-TESTING.md](BACKUP-TESTING.md), to be run on macOS **and** Windows before a
release. It covers what no headless run can.
