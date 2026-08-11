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

- **Wait for `html[data-app-ready]`, not for `networkidle`.** It is set once React has committed,
  painted, and its bootstrap queries have settled — or given up after 700 ms, so it also arrives
  when a query 500s or hangs, which is exactly when `networkidle` does not. `html[data-app-mounted]`
  is the weaker one: committed and painted, data or no data. Both work on the dev server too, where
  no overlay exists, which makes them the right handle for scenarios that have nothing to do with
  booting. Set by `client/src/boot.ts`; there are matching `auftakt:ready` / `auftakt:mounted`
  events on `document` if you would rather listen than poll.
- **The boot animation never plays on the dev server**, and that is the point. `#boot-overlay` in
  `client/index.html` is gated on `'%PROD%' !== 'true'` — Vite's HTML env replacement, applied by
  the dev middleware as well as the build — so against `npm run demo` on `:5317` the node is
  removed before React mounts and a driving script can ignore it entirely. Everything below applies
  only when you verify against a **built** bundle: `npm run build`, then the server on `:4317`.
- **The overlay has no fixed duration any more, and it is no longer a property of the build.** It
  holds a still frame until the app is ready, then decides at runtime whether to play the gesture,
  based on measured frame health. So a `waitForTimeout(2600)` is wrong in both directions, and the
  same build legitimately produces different outcomes on the same machine — a boot-screen
  screenshot diff is not reproducible by construction. Read `html[data-boot]` instead, which walks
  `hold` → (`play` | `cross`) → `done`:
  - `hold` → phase A, a flat `#f6f6f4` rectangle. Typically ~95 ms; up to 3500 ms, then it reveals
    regardless.
  - `play` → the gesture is running; ~2.6 s from here to `done`. Not 3.07 s: the overlay's fade
    starts at 2230 ms and *overlaps* the 2700 ms envelope's tail rather than following it, so the
    node is gone before the choreography's nominal end.
  - `cross` → a 200 ms fade instead of the gesture. Four ways in: readiness arrived past the
    1200 ms deadline, the app signalled that it collapsed (`html[data-app-failed]`, see below), the
    user clicked, or the frame watchdog aborted. `#boot-overlay[data-abort]` distinguishes the last
    one and names the reason (`hitch` — one frame over 50 ms; `slow` — a median well over the
    cadence this display has been seen to deliver; `drops` — a fifth of frames lost; `starved` —
    too few frames delivered).
  - `done` → the node is gone and `#root` is no longer `inert`.
- **Every boot files a report: `localStorage['auftakt-boot-report']`.** Written in the overlay's
  single exit path just after the node is removed, so it is the non-racy way to learn what a boot
  did after the fact: wait for `html[data-boot="done"]`, then read it — no need to catch
  attributes before the overlay vanishes. One JSON object, last boot wins (a warm reload
  overwrites it with `skip / warm`, which is also how you prove the reload happened). Fields:
  `outcome` (`play` | `cross` | `skip`), `why` (`done`, `deadline`, `click`, `app-failed`,
  `abort:<reason>`, `hold-max`, `gesture-max`, `warm`, `reduced-motion`, `no-prod`),
  `readyMs`/`startMs`/`endMs` on the same clock the 1200 ms deadline reads, and — when the
  gesture played — `frames` (judged deltas: `n`, `med`, `p95`, `worst`, `quick`, `drops`, plus
  `lead`, the release→first-callback gap, and `warm`, the exempt first frame's delta) and `tail`
  (deltas recorded unjudged during the reveal fade, with a retrospective `verdict`). A
  `tail.verdict` of `hitch` on a run with **no** `data-abort` is not a contradiction: the
  attribute still means the watchdog *changed the outcome*, the tail is record-only. Under
  Electron the same report goes out over the `bootSettled` bridge.
- **Under Electron the reports accumulate: `boot-log.jsonl` in userData.** One line per settle —
  including warm reloads (a season switch writes `skip / warm`; that line is the reload proving
  itself, not noise) — wrapped by the main process with `at` (ISO time, main's clock, so a
  renderer cannot spoof it) and `app` (version). Capped at 64 KB, then trimmed to the last 100
  lines. A launch whose renderer never reported — crashed, wedged, or the inline script died and
  the CSS bail cleared the overlay — still gets a line: the 8 s chores fallback writes
  `{"outcome":"no-report","why":"fallback-8s"}`. Read it with
  `tail -n 5 ~/Library/Application\ Support/Auftakt/boot-log.jsonl | jq .` (Windows:
  `%APPDATA%\Auftakt\boot-log.jsonl`). Dev mode writes nothing, matching the overlay it reports
  on. The writer is `electron/bootLog.ts`, electron-import-free so `check:unit` covers it.
- **A traced launch: `AUFTAKT_BOOT_TRACE=1`.** Records the first ~6 s (any larger number: that
  many milliseconds) to `boot-trace-<stamp>.json` in userData, loadable at ui.perfetto.dev. Find
  CrRendererMain, locate the overlay's `auftakt:*` marks (`blink.user_timing` category), and read
  what else ran between `auftakt:play` and `auftakt:done` — long `v8.compile` tasks are the cold
  code cache, RasterTask and GPU-process work the cold shader caches. Two traps: `open -a
  Auftakt` drops environment variables, so launch the binary directly —
  `AUFTAKT_BOOT_TRACE=1 /Applications/Auftakt.app/Contents/MacOS/Auftakt` — and tracing has
  overhead of its own, so a traced run *attributes* a stall rather than timing it honestly.
- **`document.getAnimations()` returns all twelve animations during the hold, not `[]`** — paused is
  not idle, and a paused animation with a fill is still in effect and still enumerated. What
  distinguishes the hold is `playState`: every one reads `paused` except `bootBail`, the dead man's
  switch, which runs unconditionally and spends the whole hold inside its 6 s delay. A script that
  polls for an empty list waits forever; check `getAnimations().every(a => a.playState === 'paused'
  || a.animationName === 'bootBail')` instead. To look at a single frame, wait for
  `[data-boot="play"]` *first*, then `document.getAnimations().forEach(a => { a.pause();
  a.currentTime = ms })` — and note the clock now starts at phase B, not at navigation. Seeking past
  the end fires the fade's `animationend`, which removes the node: that *is* the reveal, not a lost
  overlay.
- **An app that threw during boot reveals without the gesture, deliberately.** `window.onerror`, an
  unhandled rejection, or a render error the `ErrorBoundary` caught all reach `signalFailed()`, which
  sets `html[data-app-failed]` before announcing readiness; the overlay then cross-fades rather than
  celebrating over a blank window. So a scenario that injects a throw gets `cross`, and
  `[data-app-failed]` is the handle that tells you why it was not `play`.
- **A blocked main thread makes the gesture abort, so do not block it and then blame the overlay.**
  Injecting a busy-loop to simulate load, or attaching a debugger, trips the watchdog and you get
  `cross` instead of `play`. That is the feature working, and it applies for the *whole* gesture —
  the watchdog judges rolling 200 ms windows to the last frame, not just the opening one. The one
  exception is a block that lands after the reveal fade has begun (~2230 ms in): from there the app
  is already showing through, so the watchdog stops judging — it keeps recording, and the block
  shows up in the report's `tail` — and the overlay lets the fade finish rather than throwing the
  splash back to full opacity. That run stays a clean `play` → `done` with no `data-abort` — the
  attribute means the watchdog changed the outcome, not merely that a frame was late. Probing that
  window needs a *short* block, ~80 ms: a longer one runs past the fade's own end, so the overlay's
  `animationend` is dispatched before the next rAF callback, `remove()` wins the race and nothing
  is left to observe on the node — though `tail.worst` in the report still shows it. Read
  `data-abort` by polling inside the page while `#boot-overlay` still exists — by the time an
  `await` in the driving script resolves, the node and its attributes are usually gone — or skip
  the race entirely and read `localStorage['auftakt-boot-report']` after `done`.
- **An aborted or skipped gesture keeps its last frame on screen, and that is not a stuck
  animation.** `cross` from within `play` adds `#boot-overlay.boot-froze`, which holds the svg
  visible while every descendant animation re-pauses, so a screenshot taken then shows the hand
  mid-swing with a half-drawn trail, fading out. A `cross` that never played shows the flat
  rectangle instead — the parked hand and an un-landed wordmark are deliberately never drawn.
- **The overlay swallows the first interaction while it is up**, whatever phase it is in, because
  it keeps its pointer events until removal. `locator.click()` rides that out through actionability
  retries; a raw `mouse.click()` at coordinates only reveals the app. `#root` carries `inert` for
  the same interval, so a keyboard-driven script finds nothing focusable until `done`.
- **It plays on a **cold** boot only.** The inline head script sets
  `sessionStorage['auftakt-booted']`, so every `reload()` in the same context comes up without it —
  correct, though it reads as a bug — while a script that opens a context per scenario pays the
  full boot each time. `newContext({ reducedMotion: 'reduce' })` removes it outright and stays the
  cheapest way to get it out of the way.
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

- **The default `task_sort` is `[status, priority, due]`, not empty.** A „keine Regel" repro needs
  `PATCH /api/settings {"task_sort": []}` first.
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
