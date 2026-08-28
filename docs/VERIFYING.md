# Verifying a change by hand

The automated gates are `npm run typecheck` and `npm run check` (unit · backup · dates · api ·
markdown), plus `npm run check:browser` and `npm run check:boot`, which are outside `check`
because each needs a browser binary, and `npm run check:package`, which is outside it because it
inspects a build and only a tag produces one. Everything *they* cannot reach is verified by
driving the dev server, and this file is the accumulated cost of doing that.

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

The repository depends on `playwright-core` (exact `1.62.1`) for `npm run check:browser`, and on
nothing else: that package downloads no browser, so the binary comes from wherever the machine
already keeps one (`npx playwright-core install chromium` fetches it once). For ad-hoc driving,
keep **one** install outside the working tree and reuse it — one per session in a temp directory
costs an npm tree every time, and a stray `PLAYWRIGHT_BROWSERS_PATH` re-downloads half a gigabyte
of browsers that were already cached.

**The committed gate is `npm run check:browser`** — it rebuilds `.demo`, boots the stack on
`:4325` + `:5317` and drives it, so it cannot run beside `npm run demo` and says so rather than
guessing. Run it after a change to the two-window/season paths, to the task table, the column
manager or the editor, to a delete or a reorder, to anything under `#/einstellungen`, to a
dialog's keyboard behaviour or the search overlay, and to anything that lays out narrow or
prints; it is not a substitute for the passes below.

**Where a case letter lives.** Comments across the repo cite the gate's areas as `case A` …
`case AX`; this table is the index that resolves them. The authoritative range is each file's
own head line in `scripts/check-browser/cases/` — a new surface adds a file there and a row
here.

| file | areas | covers |
|---|---|---|
| `seasons.mjs` | A–E | the season matrix in two windows, and the export that carries it |
| `tasks.mjs` | F–H | the three core paths: a task, a column, the editor |
| `records.mjs` | I–K | deleting a record, and reordering by the ⠿ |
| `render.mjs` | L–N4 | the two pure render assurances: the smallest window, and paper |
| `settings.mjs` | O–R2 | the four Einstellungen tabs and what they write |
| `keyboard.mjs` | S–T | the keyboard contract and the search overlay |
| `electron.mjs` | U–U2 | the two Electron surfaces, against a recording bridge stub |
| `announcements.mjs` | V | the announcement overlay (WP-63) |
| `subtasks.mjs` | W–Z | the task tree |
| `toolbox.mjs` | AA–AC | the rich-text toolbar |
| `images.mjs` | AD–AG | images in the text |
| `archive.mjs` | AH–AK | the archive and its boundary |
| `columns.mjs` | AL–AO | the custom column types |
| `landing.mjs` | AP–AS | the landing page and its two conflicting blobs |
| `reorder.mjs` | AT–AX | the reorderable surfaces |

**The second committed gate is `npm run check:boot`** (WP-61c) — the boot gesture exists only in a
built bundle, which is the one surface `check:browser` deliberately cannot reach, so this one
builds the client itself, serves it from the real server on `:4327` against a throwaway data dir
and drives seventeen cold boots. It needs neither `:5317` nor `.demo`, so unlike `check:browser` it
runs happily beside a live `npm run demo`. Run it after anything in the overlay in
`client/index.html` — the watchdog's constants, the phases, the report's fields — and after a
change to the caps in `electron/appLog.ts`, which it reads.

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
- **Node's `fetch` cannot observe an HTTP cache hit.** undici adds `cache-control: no-cache` and
  `pragma: no-cache` to *every* request it sends, and Express's `fresh` honours that — correctly,
  since the client asked not to be given a cached answer. So a conditional request written the
  obvious way (`fetch(url, { headers: { 'if-none-match': etag } })`) reads **200**, and the server
  looks like it is ignoring its own ETag when it is not. `curl -H 'If-None-Match: …'` on the same
  URL returns 304. Pass `'cache-control': ''` explicitly to override undici's default — a browser
  revalidating an `<img>` sends no such header, so that is the faithful simulation, not a
  workaround. Cost one wrong verdict on `/api/images/:token` (WP-37).
- **Paste is verifiable headlessly — it is a `parseHTML` rule, not an event handler.** ProseMirror
  parses clipboard HTML with the same rules as any other DOM input, so
  `editor.commands.insertContent('<p><img src="…"></p>')` in `check-markdown.ts`'s jsdom editor
  exercises exactly what a paste would, with no browser involved. That is how the clipboard
  assertions at the foot of that script reach a path that reads like it needs a real Cmd-V. The
  corollary is the trap: a parse rule *is* a paste rule, so widening one to read stored HTML
  silently widens what a paste may bring in (WP-37).
- **`setContent` repairs an illegal document; `useEditor({ content })` does not.** The app hands
  stored Markdown to the editor at *construction*, which goes through `Node.fromJSON` and validates
  nothing. `setContent` dispatches a replace step, and ProseMirror fits an illegal slice into the
  schema on the way in — so a document that crashes the real editor loads perfectly in a check
  script written the obvious way. Build a fresh `new Editor({ content })` per case and call
  `doc.check()`, then dispatch an empty transaction to reach the plugins that touch the end of the
  document. The WP-37 image bug was invisible to the round-trip gate for exactly this reason.
- **`.rte-content img` counts ProseMirror's own elements.** ProseMirror puts an
  `<img class="ProseMirror-separator">` after an inline atom at the end of a text block, so
  „the image was inserted once" reads as two or three. Select
  `img:not(.ProseMirror-separator)`. Cost one wrong „the insert is duplicating images" verdict.
- **The server rejects a dev client on any port but 5317 with a bare 403.** `ALLOWED_ORIGINS` in
  `server/src/index.ts` is built from `CLIENT_DEV_PORT = 5317`, so running Vite on another port to
  dodge a busy 4317 makes every write fail as „Forbidden" and reads exactly like a broken feature.
  Move the *server* (`AUFTAKT_PORT=4319`) and keep the client on 5317.
- **A gate that cannot fail is worse than no gate — prove the new one bites.** Revert the fix,
  watch the new case fail, restore it. Doing that here caught a sabotage that was itself broken: a
  duplicate `getAttrs:` key added *above* the real one changed nothing, because the later key wins,
  and the gate went on passing against what looked like unfixed code. Delete the property under
  test rather than shadowing it.
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

**Some of these are now committed, and this file is still where they are decided.**
`npm run check:browser` (WP-R6, extended by WP-64a, WP-64b and WP-64c) encodes the ones its cases need —
two pages in one context, the sessionStorage pin plus a document reload, `data-app-ready` over
`networkidle`, the out-of-band delete, the toast that lands one query late, the anchored composer
placeholder, the two `[data-column-row]` lists, the real keystroke a note needs before it stores
anything, the ⠿ and its 2-px nudge, the drop point clamped out from under the sticky header, the
drop highlight polled together with the fade it arrives beside, the dialog-scoped „Löschen", the
toast filtered by its own record, „gone" as a wait rather than a count, the two viewports a
624×560 window really produces,
the overhang sweep's exemption for a scroll container, the A4 `page.pdf()` whose default
`printBackground: false` is a repro rather than an oversight, the tab order read as *positions*
rather than as keystrokes, the recording bridge stub, and the `<select>` that has to be used once
before it can be measured. A new trap belongs **here first** and in the gate second: the gate covers
the flows it drives, this file covers the app. Nothing below is retired by it — everything the gate does not drive is still
verified by hand, and the gate itself is written from this list.

- **How a page was *reached* changes what a delete on it does.** „Daten konnten nicht aktualisiert
  werden. (not found)" after deleting an artist reproduces when the page was reached by a
  client-side navigation (dashboard → artist card → „✎ Bearbeiten" → delete) and **not** when the
  same page was opened with `page.goto('#/artist/4')`, which is how a script naturally writes it.
  `navigate()` is a React Router transition, so the unmount races a DELETE that takes ~2 ms against
  localhost, and the two routes in lose that race at different rates. A repro that only ever
  `goto`s the page under test reports the bug fixed while a user hits it on the first click. Drive
  the navigation the user drives — and read `useUndoableDelete`'s `gone` before assuming a stray
  404 during a delete is a server bug.
- **`getByRole('button', { name: 'Löschen' })` is ambiguous on any page with tasks on it.** The
  task table's row 🗑 carries `title="Löschen"`, so it takes the accessible name too — on a project
  page that is four matches, and the one you want (the edit dialog's footer button, WP-34) is only
  one of them. Scope to the dialog: every `Modal` is a `div.fixed.inset-0`, and the topmost is the
  last of them. The same scoping is what makes „Löschen" reachable inside *two stacked* dialogs.
- **Toasts stack, and they hold for 6 s — which is longer than a script takes to do the next
  thing.** So `getByRole('button', { name: 'Rückgängig' }).first()` can be an *earlier* operation's
  undo still sitting on screen, and clicking it reverts the wrong row while every visible signal
  looks right: a toast was there, it was clicked, a „rückgängig gemacht" toast came back. This cost
  a real diagnosis — the delete under test was fine, the click was landing on the previous test
  step's toast. Filter by the record's own name
  (`.locator('.pointer-events-auto').filter({ hasText: 'Kollektiv Halbton' })`), and do not assert
  on `count()`: the toast renders a tick after the request resolves, so a count read at the wrong
  moment reports 0 while the very next `click()` — which waits — succeeds.
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
- **The way to a bundle the overlay does exist in is the server, not a static file server.**
  `server/src/index.ts` serves `client/dist` on its own port whenever it finds it, and
  `AUFTAKT_CLIENT_DIST` also flips `isPackaged`, which drops the two `:5317` entries from
  `ALLOWED_ORIGINS` — i.e. exactly the packaged app's configuration. So `npm run build:client`
  followed by
  `AUFTAKT_DATA_DIR=$(mktemp -d) AUFTAKT_PORT=4327 AUFTAKT_CLIENT_DIST=$PWD/client/dist npm --prefix server run start`
  puts a faithful production client on `http://localhost:4327/`: same origin, no Vite, no `:5317`,
  and therefore nothing to collide with — which is why `check:boot` can run beside a demo and
  `check:browser` cannot. Handing `client/dist` to any *static* server instead leaves the app with
  no `/api`: the bootstrap queries reject, `signalFailed()` fires, and **every** boot comes up
  `cross / app-failed`. That reads as a broken gesture and is a missing server.
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
    one and names the reason (`hitch` — one frame over 58 ms, so a 50.1 ms gap, which is three
    vsync intervals at 60 Hz, is deliberately tolerated; `slow` — a median well over the
    cadence this display has been seen to deliver; `drops` — a quarter of the window's frames
    late, each late frame counting once however many slots it spans (WP-61b); `starved` — too
    few frames delivered).
  - `done` → the node is gone and `#root` is no longer `inert`.
- **Every boot files a report: `localStorage['auftakt-boot-report']`.** Written in the overlay's
  single exit path just after the node is removed, so it is the non-racy way to learn what a boot
  did after the fact: wait for `html[data-boot="done"]`, then read it — no need to catch
  attributes before the overlay vanishes. One JSON object, last boot wins (a warm reload
  overwrites it with `skip / warm`, which is also how you prove the reload happened). Fields:
  `outcome` (`play` | `cross` | `skip`), `why` (`done`, `deadline`, `click`, `app-failed`,
  `abort:<reason>`, `hold-max`, `gesture-max`, `warm`, `secondary`, `reduced-motion`, `no-prod`),
  `readyMs`/`showMs`/`startMs`/`endMs` on the same clock the 1200 ms deadline reads (`showMs`
  is when `.boot-show` made the svg visible; the first raster's cost is the `showMs → startMs`
  span, and `showMs` with `startMs: null` is the signature of a cross that landed during the
  show frames), and — when the gesture played — `frames` (judged deltas: `n`, `med`, `p95`,
  `worst`, `quick`, `drops`, plus `lead`, the release→first-callback gap, and `warm`/`warm2`,
  the two exempt head frames) and `tail` (deltas recorded unjudged during the reveal fade,
  with a retrospective `verdict`). A `tail.verdict` of `hitch` on a run with **no**
  `data-abort` is not a contradiction: the attribute still means the watchdog *changed the
  outcome*, the tail is record-only. Under Electron the same report goes out over the
  `bootSettled` bridge.
- **The report is versioned: WP-61 made it `v: 2`, WP-61b `v: 3`.** v: 2 — two head frames
  exempt instead of one (so `frames.n` counts one delta fewer, and `warm2` joins `warm`) and
  `HITCH_MS` moved 50 → 58. v: 3 — the `drops` sum caps each delta at one lost slot (judge and
  report field both) and `showMs` joins the clock fields. Nothing branches on `v` — an old
  line stays readable field for field — but `why`, `drops` and `tail.verdict` were produced
  under different rules, so a log holding several generations must not be compared across the
  boundaries. Old lines are *stricter*: a v:1 `tail.verdict` of `hitch` needed only 50 ms, and
  a v:2 `abort:drops` can name a window v:3 would pass. `grep '"v":3'` separates them.
- **Under Electron the reports accumulate: `app-log.jsonl` in userData.** One line per settle —
  including warm reloads (a season switch writes `skip / warm`; that line is the reload proving
  itself, not noise) — wrapped by the main process with `at` (ISO time, main's clock, so a
  renderer cannot spoof it) and `app` (version). Since WP-69 that file is **shared with the
  runtime lines** main writes for a caught failure, and the discriminator is `src`: a boot report
  never carries it, every runtime line always does. Past 512 KB it is rewritten to the newest
  lines fitting *both* 500 lines and 256 KB, whole lines only. A launch whose renderer never
  reported still gets a line, through one of two doors: a
  crashed or wedged renderer that lives past 8 s gets `{"outcome":"no-report","why":"fallback-8s"}`
  from the chores fallback, and a launch *quit* before the overlay settled — Cmd-Q or Ctrl-C
  during the hold or the gesture; on macOS the 8 s timer dies with the process — gets
  `{"outcome":"no-report","why":"quit"}` from the before-quit/SIGINT hooks. An empty log after a
  launch therefore always means the diagnostics did not run, never that the boot was merely
  short-lived. Read it with
  `jq -c 'select(has("src") | not)' ~/Library/Application\ Support/auftakt/app-log.jsonl | tail -n 5`
  (Windows: `%APPDATA%\auftakt\app-log.jsonl`) — a plain `tail` now mixes runtime lines in, which
  is exactly what `summarizeBootLog` filters out with `isBootLine`. An installation that predates
  WP-69 still has `boot-log.jsonl`; main renames it onto the new name on the first start after the
  update — idempotent, and never over an `app-log.jsonl` that already exists — so the history
  survives. Dev mode writes nothing, matching the overlay it reports on. The writer is
  `electron/appLog.ts`, electron-import-free so `check:unit` covers it.
- **Since WP-54 the customer can reach it too**, which is the point of the file: Einstellungen →
  „Programm & Hilfe" → „Feedback senden…" → „Bericht speichern" writes the log into a bundle on
  the desktop and asks them to attach it — since WP-69f under **two** headings, „Startprotokoll"
  carrying every boot line and „Laufzeitprotokoll" the last 200 runtime lines (64 KB), each counted
  separately in its own heading. `summarizeBootLog`'s five-line digest is now the **fallback** — it
  rides in the mail body only when no bundle was written (the browser build, or a failed write), so
  a mail that carries the file carries no digest at all. Do not verify the digest by
  reading the dialog; read the summary itself under `check:unit`, where the four record species
  and the untrusted-`why` case are pinned.
- **The dialog is two clicks and one optional box (WP-75), and the flow it replaced is what most
  stale driving scripts still expect.** „Feedback senden…" opens it, „Bericht speichern" writes the
  file, „Fertig" closes it. There is **no kind and no area** — a script waiting for „Fehler",
  „Wunsch" or „Allgemein" waits out its timeout — the one textarea is optional, so the primary
  button is enabled from the first frame, and it is called „Bericht speichern", not „Weiter". Both
  steps are **one dialog in two states**: the handover replaces the form, so `.fixed.inset-0` stays
  at 1 throughout and a script waiting for a second layer hangs. The dialog places focus itself in
  the second state (the box in the first, „Adresse kopieren" in the second), because `Modal` only
  does that when it opens.
- **„Bericht speichern" writes `Auftakt-Diagnose-<ref>.txt` to the desktop, whether or not anything
  was typed, and nothing else happens** (WP-66; it used to reveal the file in the Finder and launch
  a mail client too). Five things follow for anyone verifying it. It is a *real file on the desktop
  of whoever runs the app*, so never drive the unstubbed path from a script — the browser stub in
  `lib/drive.mjs` records `saveDiagnostics`'s arguments into `window.__saved` and the assertion
  belongs on the filename the handover then names. **Opening the dialog writes nothing**, so
  `window.__saved` must still be empty until the click. **The write is on „Bericht speichern", not
  on „Fertig", and the handover waits for it**, so a script that waits for the file after „Fertig"
  waits for ever, and one that expects the handover in the same tick as the click is racing an IPC
  round trip (`collectSystemFacts` awaits the GPU calls). **With nothing typed the report is not
  empty**: the renderer sends `FEEDBACK_NO_NOTE` („Ohne eigenen Text gespeichert…"), so an
  assertion that `__saved[0].report` is `''` is asserting on a bug. The file persists between runs,
  so a manual pass that does not delete it is reading a stale bundle a minute later — the reference
  in it is the tell. And **dev writes no boot log**, so a bundle built in dev holds the machine
  section and „noch keinen Start protokolliert" under „Startprotokoll" — with „noch keinen Fehler
  protokolliert" under „Laufzeitprotokoll" unless something really did go wrong; those are the
  branches, not a truncated file.
- **„Text ergänzen", a changed text and „Bericht speichern" again writes a *second* bundle, and
  the handover then names `…-2.txt`.** The file carries the report text, so the first one would
  otherwise be the version the customer attaches; `uniqueBundleName` (`electron/diagnostics.ts`)
  gives the second its own name and main returns it. The reference is stamped once, when the
  dialog opens, so both saves land on it — reopening the dialog instead is a *new* stamp, and
  across a minute boundary a different one, which is why the collision is driven from inside one
  dialog. Three consequences for a driving script. **The dialog remembers report text → name**, so
  a text already on the desktop — an unchanged one, or an edit taken back again — names that bundle
  without writing a third: `window.__saved` stays where it was. Only the *taken-back* edit tests
  that, though: everywhere else the remembered name and the predictable one are the same string, so
  a guess passes as well as a lookup. **A stub that always answers `Auftakt-Diagnose-${ref}.txt`
  cannot see any of this** — it makes the one name the handover must never predict
  indistinguishable from the one it may — so both stubs emulate the suffix (second save of a
  reference → `…-2.txt`). And **`window.__holdSave = true` parks the next save** until
  `window.__finishSave()`: while it is parked the handover must not be on screen at all, which is
  how „it waits for the write instead of guessing the name" is asserted rather than assumed. During
  that wait the primary button is disabled **and reads „Speichert…"**, so
  `getByRole('button', { name: 'Bericht speichern' })` matches nothing for as long as the save is
  held — up to two seconds in the real app, where `collectSystemFacts` races `getGPUInfo` against
  its own timeout.
- **Nothing on this path opens anything by itself (WP-66).** „E-Mail öffnen" is gone: a script
  that waits for it, or that expects `window.__external` to fill after „Bericht speichern", hangs.
  The `mailto:` now sits at the bottom of the handover as the link „hier klicken" (in „Oder
  einfach hier klicken, um einen E-Mail-Entwurf zu öffnen…"; `getByRole('link', …)`, not
  `button`), and it is the *only* thing that ever reaches
  `openExternal` from this dialog — which makes the recording stub the instrument for the
  promise as well: after „Bericht speichern", `window.__external` must still be empty.
- **The handover's one copy button needs clipboard permission, and it really uses it.** „Adresse
  kopieren" is `navigator.clipboard.writeText` — no bridge involved, and the loopback
  origin the packaged app runs on is a secure context, as is the dev server. To assert on it,
  `context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: UI })` — a *context*
  permission, so it may be granted at any point, before or after the page is open — then read
  back with `page.evaluate(() => navigator.clipboard.readText())`; both work headless. The write
  also needs the page focused, so `bringToFront()` it when earlier cases left pages open. Without
  the grant the write rejects, the dialog shows a „Kopieren hat nicht geklappt" toast and the
  button keeps its label — which reads as „the copy button is broken". On success the label says
  „Kopiert ✓" for 2.5 s, so a second assertion inside that window is looking for a button that no
  longer has the name it clicked. The „Betreff"/„Text" rows that used to sit beside it are gone
  with the mail they composed (WP-75); what carries the report now is the file.
- **The note's cap is the file's, not the mail's.** `maxLength` is `FEEDBACK_NOTE_MAX` (2000)
  and every character of it reaches `saveDiagnostics` — no per-keystroke fit any more, so what
  `fill()` puts in the box is what `window.__saved` gets, verbatim and trimmed. The *mail* is the
  derived copy: `feedbackMailto` drops the boot digest first and then clips the note with „[…]"
  to keep the URL under 1900 encoded characters, so a long note reaching the compose window cut
  while the file holds it whole is correct rather than a defect. The arithmetic is pinned in
  `check:unit`, not in a browser.
- **A traced launch: `AUFTAKT_BOOT_TRACE=1`.** Records from before the window until ~750 ms after
  the overlay settles — capped at ~6 s, or the env var's value in milliseconds — to
  `boot-trace-<stamp>.json` in userData, loadable at ui.perfetto.dev. Quitting does not lose it:
  before-quit and SIGINT/SIGTERM hold the exit until the write lands, so quit (or Ctrl-C the
  terminal) as soon as the app appears. Find
  CrRendererMain, locate the overlay's `auftakt:*` marks (`blink.user_timing` category), and read
  what else ran between `auftakt:play` and `auftakt:done` — long `v8.compile` tasks are the cold
  code cache, RasterTask and GPU-process work the cold shader caches. Two traps: `open -a
  Auftakt` drops environment variables, so launch the binary directly —
  `AUFTAKT_BOOT_TRACE=1 /Applications/Auftakt.app/Contents/MacOS/Auftakt` — and tracing has
  overhead of its own, so a traced run *attributes* a stall rather than timing it honestly.
- **Re-creating a first launch: `node scripts/clear-boot-caches.mjs`.** Deletes exactly the
  packaged app's Chromium/V8 cache directories from userData (`Cache`, `Code Cache`, `GPUCache`,
  the two `Dawn*Cache` shader caches, `Shared Dictionary`, `blob_storage`, `v8-cache`) —
  allowlist-only, because the same directory holds the live database and `Local Storage`
  (emoji-picker state, the boot report copy). It refuses while anything answers on `:4317`, so
  quit the app and kill dev servers first (`lsof -ti tcp:4317 -ti tcp:5317 | xargs kill`). The
  evidence pair for the boot log is one cleared+traced launch, then one warm launch. This
  reproduces cold caches, not macOS Gatekeeper's first-open pass over a quarantined bundle —
  re-install from the `.dmg` for the faithful worst case.
- **`document.getAnimations()` returns all twelve animations during the hold, not `[]`** — paused is
  not idle, and a paused animation with a fill is still in effect and still enumerated. What
  distinguishes the hold is `playState`: every one reads `paused` except `bootBail`, the dead man's
  switch, which runs unconditionally and spends the whole hold inside its 7 s delay. A script that
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
  the watchdog judges rolling 200 ms windows to the last frame, not just the opening one. There are
  two exceptions. The first is the **head of the gesture**: the first two measured deltas after
  `data-boot="play"` are exempt from every test (WP-61 — the first schedules the svg's first
  raster, the second waits for it), so a block landing there does not abort and shows up as
  `frames.warm` / `frames.warm2` instead. That is also the handle for driving it: the show
  continuation (since WP-61b, two rAFs into `start()`) sets `data-boot="play"` and calls
  `watchFrames()` inside one task, and a `MutationObserver` callback is a microtask, so an
  observer on that attribute is registered *after* the watchdog's first rAF and runs after it in
  every frame from then on — blocking inside your own rAF callback *k* therefore inflates
  measured delta *k*, where delta 1 is `warm`. Slot-addressable injection with no polling and no
  rAF patching: 150 ms at slot 1 stays a clean `play`/`done`, the same 150 ms at slot 3 is
  `cross`/`abort:hitch`. Before WP-61 slot 2 aborted, which is the whole bug. Since WP-61b two
  sub-hitch gaps in one window no longer abort either — a ~50 ms and a ~33 ms block in the same
  200 ms window is a clean `play`/`done` with `frames.drops: 2` (the customer's log line,
  re-enacted); a third late frame in the window still crosses with `abort:drops`. And the two
  `.boot-show` frames sit *between* `start()` entry and `data-boot="play"`: on a machine with a
  cold raster the cost now lands in the report's `showMs → startMs` span, so `warm`/`warm2` near
  16.7 with a fat `showMs → startMs` is the fix working, not a measurement gone missing.
  The second exception is a block that lands after the reveal fade has begun (~2230 ms in): from there the app
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
- **`document.documentElement` is `null` inside an `addInitScript`** — which is the one moment an
  observer of `html[data-boot]` can be installed, since the attribute's first write happens during
  parse. `observe(document.documentElement, …)` therefore throws, the rest of the init script never
  runs, and with no `pageerror` listener attached the run looks **completely normal**: the slot
  injection above silently did nothing for nine cases and all nine passed. Observe the document
  instead — `obs.observe(document, { attributes: true, subtree: true, attributeFilter: [...] })` —
  and always attach `page.on('pageerror')` to a page that carries an init script.
- **Headless Chromium's frame cadence is whatever the machine gives it, and no flag makes it
  60 Hz.** On the ProMotion Mac this is developed on it is 8.3 ms — a whole gesture reports
  `med 8.3 · p95 8.6 · worst ≤ 10.4 · drops 0`, and that is *unchanged* by `--disable-gpu`, by
  swiftshader and by 20× CDP CPU throttling (`Emulation.setCPUThrottlingRate` slows script, not the
  compositor). A CI runner may well deliver 16.7. Two consequences for anything that injects frame
  stalls. An absolute block size is not portable — 50 ms is a tolerated 50.0 ms gap at 120 Hz and a
  `hitch`-triggering 66.8 ms one at 60 — so **derive the block from the median the run itself
  reports**. And `--disable-frame-rate-limit` is not the 60 Hz simulation its name suggests: it
  uncaps rAF entirely (0.2 ms between blocks, a 0.2 ms median), which makes every judged verdict
  meaningless — nine of a seventeen-case set went red under it against a perfectly good build.
- **An injected shape that sits *on* a watchdog threshold is flaky by construction.**
  `drops >= 0.2 * (deltas.length + drops)` rearranges to `drops >= n / 4`, so `g` injected gaps of
  `G` ms among `c` clean frames of `med` ms abort only while `c <= 3g`, and the window closes only
  once `g*G + c*med >= 200`. Three 45 ms gaps at an 8.3 ms median put those at `c >= 9.03` and
  `c <= 9`: four runs out of six aborted, two played to the end, and neither answer was a defect.
  Four gaps clear the margin at 60 Hz and at 120. Compute it before trusting an injected outcome —
  and prefer asserting *where the cost was accounted* (`warm`, `warm2`, `showMs → startMs`, `tail`)
  over asserting which door the run left by.
- **An aborted or skipped gesture keeps its last frame on screen, and that is not a stuck
  animation.** `cross` from within `play` adds `#boot-overlay.boot-froze`, which holds the svg
  visible while every descendant animation re-pauses, so a screenshot taken then shows the hand
  mid-swing with a half-drawn trail, fading out. A `cross` that never played shows the flat
  rectangle instead — the parked hand and an un-landed wordmark are deliberately never drawn;
  `crossFade()` strips `.boot-show` on that path, so even a cross landing inside the show
  frames fades the flat rectangle.
- **A visible svg is not a playing gesture.** Since WP-61b, `.boot-show` unhides the svg up to
  two frames *before* `data-boot="play"` — animations still paused, only the parked hand
  showing — so a script that keys "the gesture started" off svg visibility now fires a phase
  early. Wait for `[data-boot="play"]`; that write still happens in the same task as the
  watchdog's first rAF.
- **The overlay swallows the first interaction while it is up**, whatever phase it is in, because
  it keeps its pointer events until removal. `locator.click()` rides that out through actionability
  retries; a raw `mouse.click()` at coordinates only reveals the app. `#root` carries `inert` for
  the same interval, so a keyboard-driven script finds nothing focusable until `done`.
- **It plays on a **cold** boot only.** The inline head script sets
  `sessionStorage['auftakt-booted']`, so every `reload()` in the same context comes up without it —
  correct, though it reads as a bug — while a script that opens a context per scenario pays the
  full boot each time. `newContext({ reducedMotion: 'reduce' })` removes it outright and stays the
  cheapest way to get it out of the way.
- **A cold boot without a cold cache: clear the session key and reload.**
  `sessionStorage.removeItem('auftakt-booted')` followed by `page.reload()` comes up as a cold
  start — the head script finds no key, `__auftaktWarm` stays false, the gesture plays — while the
  HTTP and V8 code caches stay warm. That is the second launch onwards of an installed app, and the
  only way to get repeated gestures out of one page. Measured against the built bundle: `readyMs`
  92 ms on the first, cache-cold load and 20–36 ms on every one after it, against the 1200 ms
  deadline; under 20× CPU throttling the warm number is 532 ms and the cold one 1574 ms — the only
  one of the four to miss the deadline. It is the *cache*, not the machine, that decides whether a
  slow runner still sees a gesture. A fresh page in the same context is a cold session too
  (sessionStorage is per tab) but shares the context's HTTP cache. The gesture's own length is not
  a machine property either: `endMs − startMs` measured 2599 ms at full speed and 2613 ms at 20×,
  because the animations run on their own clock.
- **The reduced-motion escape hatch is the *script's* `matchMedia`, not the `@media` rule.**
  `#boot-overlay`'s `@media (prefers-reduced-motion: reduce) { display: none }` only covers the
  interval before the body script runs; what removes the node, files `skip / reduced-motion` and
  leaves `#root` un-inert is `matchMedia('(prefers-reduced-motion: reduce)').matches` in that
  script. Deleting the CSS rule changes nothing observable — a context with
  `reducedMotion: 'reduce'` still reports `skip / reduced-motion` — so a check written against the
  stylesheet proves nothing about the hatch every other driving script depends on, and the media
  query reads like dead code it is not.
- **`page.goto` to the same hash is a no-op** under `HashRouter`, so a dialog left open by the
  previous scenario silently eats every click. Call `reload()` after `goto`.
- **`html[data-app-ready]` survives an in-app hash navigation**, so after a `goto` to a *different*
  hash it resolves instantly and says nothing about the page you just asked for. It is a
  document-load signal, not a route signal. Either `reload()` after the `goto` (which also makes
  the pin apply, below) or wait for something the target route actually renders.
- **Several "windows" are several pages in ONE BrowserContext.** BroadcastChannel is partitioned
  per context, so two contexts never deliver — and a cross-window-freshness check against them
  "passes" vacuously, since nothing arrives and nothing was expected to. `context.newPage()`
  twice, not `browser.newContext()` twice. sessionStorage is still per page, which is exactly the
  Electron shape (per-window pins, shared broadcast).
- **A tab is pinned to a season via `page.evaluate(() => sessionStorage.setItem('auftakt-season',
  '2'))` followed by `reload()`** — the pin (and a fresh QueryClient) apply only with a document
  reload, so a hash `goto` after setting it renders the old season's cache and the check reads
  "pinning is broken" against working code. Not `context.addInitScript`, which pins every page in
  the context.
- **A curl-written fixture does not broadcast.** Only a window's own write path (through
  `useInvalidateAll`) posts the invalidate, so a second tab will not refresh after a
  `curl -X POST` — by design, not a defect. Drive the write through the first tab's UI when
  asserting cross-tab freshness, and `reload()` a tab that must see a curl-created season.
- **410 means "this window's season is gone", and only that.** Row-level misses stay 404. The
  client reacts to a 410 by dropping its pin and restarting on the landing page with a toast; the
  server marks it `no-store` and varies every `/api` response on `X-Auftakt-Season` — a cached
  410 replayed after recovery was an infinite reload loop, found by exactly this scenario.
- **The „…gelöscht" toast lands one query later than the page**, since it waits for `['seasons']`
  to answer so it can name a renamed term. Wait for the toast text; do not sample the toast stack
  after `data-app-ready`, and do not sleep for it either — toasts hold six seconds, so a fixed
  wait can miss it from either side.
- **Reproducing the 410 needs the delete to be out-of-band.** `curl -X DELETE /api/seasons/<id>`
  posts no invalidate, so the pinned window keeps believing in its season until it asks — which
  is the state every 410 bug needs. Deleting through a second window's UI instead broadcasts, and
  the window recovers before the step under test.
- **The demo seeds several seasons** (three at the time of writing) and their ids shift as
  fixtures accumulate. Create your own fixture season over the API and use the returned id;
  a hardcoded "season 2" assertion matches a different database on every run.
- **A *copied* season keeps every row id, which is what makes the fixture facts below usable in
  one.** `copyRows` carries `id`, so „project 2 has 3 tasks" and „artist 3 reaches 14" hold inside
  a copy, and a scenario that mutates rows can therefore run in its own season instead of on the
  shared demo. Two riders. The copy drops soft-deleted rows (`deleted_at IS NULL` per row), so the
  new season's Papierkorb starts **empty** — which is what lets `/api/deleted` be read by type
  rather than by name — and a subtask whose parent stayed behind arrives as a root task. And the
  copy is a snapshot of the season *as it is at that moment*: take it before anything has written,
  or an earlier step's fixture rides along and the documented counts drift (a task added to
  project 2 makes its confirm read „4 Aufgaben", which looks exactly like a broken cascade).
- **Focus-refetch never fires between two visible Electron windows on `visibilitychange`** — the
  client wires React Query's `focusManager` to real `focus` events instead. Headlessly, trigger it
  with `window.dispatchEvent(new Event('focus'))`, and remember `staleTime: 5_000`: a focus inside
  five seconds of the last fetch refetches nothing, which reads as "focus-refetch is broken".
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
- **An event row is `li.group` and its edit button is `[title="Bearbeiten"]` — neither is unique to
  events.**
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
- **Read a tab walk as a *position in the dialog's own tab order*, never as a list of elements.**
  Collect the card's tabbables with `Modal`'s own filter (`tabIndex >= 0`, not `[disabled]`, not
  inside `[inert]`, `getClientRects().length > 0`) and report the index of `document.activeElement`
  in it. `-1` is then the one answer that matters — focus on `<body>`, on the page behind the
  backdrop, or in a portal are all „the trap let go" — and every WP-42 promise becomes a number:
  index 0 is always the header's ✕, so „the dialog focused its first *field*" is 1, and „the
  forward wrap skipped the ✕" is a cycle that never returns to 0. On the artist dialog the walk is
  `2 3 4 5 6 7 1`; a *confirm* has no tabbable in its body, so its wrap goes to the ✕ (`1 2 0 1`)
  and only the record dialogs wrap to the first field.
- **The topmost card is the *last* `.fixed.inset-0 > div`, and the topmost `.fixed.inset-0` is
  often not a dialog at all.** A `Modal` opened out of another one is rendered *inside* it
  („Spalte … ausblenden" out of „Spalten verwalten"), so document order puts the topmost last — a
  `querySelector` finds the outer one. And `PillSelect`'s portal hangs its own click-away layer,
  a bare `div.fixed.inset-0` with no card in it, off `document.body`: while a pill menu is open
  `topDialog(page)` is *that layer*, so scope to `.first()` there. The count going 1 → 2 on
  opening a pill is the tell.
- **Do not wait for a dialog by its heading when the card behind it carries the same words.**
  „Feedback & Diagnose" is the card's `<h2>` and the dialog's `<h3>`, so
  `getByRole('heading', { name: 'Feedback & Diagnose' })` is a strict-mode violation that reads as
  „the dialog never opened". Wait for the dialog's own first control instead.
- **A tab walk that reaches a rich-text field never leaves it.** The editor's keymap handles Tab
  (WP-49 indents with it), so a walk through the Termin dialog stops moving at Notizen and every
  further press reports the same element — which reads as a broken tab order. Walk a dialog
  *without* an editor when the assertion is about the cycle (the Künstler dialog is the clean one:
  ✕, Name, Bild wählen, Farbe, Hex, Löschen, Abbrechen, Speichern).
- **React sets `value` as a *property***, so `input[value="…"]` never matches; address a focused
  field as `input:focus`. Since WP-42 *every* dialog autofocuses its first field, so `input:focus`
  is only unambiguous scoped to the dialog card — or outside any dialog, where an `InlineInput`
  is the one thing that autofocuses.
- **Every `Modal` places focus on open and returns it on close** (WP-42): the first body tabbable,
  which for a confirm dialog is the footer's „Abbrechen" — **Enter cancels those now**, so a
  script that used Enter as a harmless keystroke on a confirm deletes nothing and closes the
  dialog. The dialogs that hold typed text pass `dirty`, so Escape on a half-typed Saison,
  Bereich or Spalte answers with „Änderungen verwerfen?" — answer the question (or clear the
  fields) instead of expecting the dialog to be gone.
- **An Escape dispatched in the same frame as a `fill()` can beat a *lifted* `dirty`.** „Spalten
  verwalten" learns its dirty from `AddColumnForm` through a passive effect plus a second commit,
  and `Modal`'s Escape listener is a raw window listener that does not wait for React — so
  fill-then-Escape with no gap closed the dialog without the question and read as "dirty is
  broken". No human types and Escapes inside one frame; give the script a ~100 ms beat. Dialogs
  whose dirty is computed beside the `Modal` (Saison, Bereich, Spalte bearbeiten) commit
  synchronously with the input event and have no such window.
- **Focus after a column reorder only settles once the refetch has committed.** „Spalten
  verwalten"'s ▲/▼ go through the server, so `move` hands the restore to an effect keyed on the
  column list rather than doing it inline — `document.activeElement` read straight after the click
  is still the pre-move node. Wait for the row order to change, then read focus. `OptionsEditor`'s
  ▲/▼ are local state and have no such gap. Nor is a `requestAnimationFrame` after `invalidate`
  enough to close it: that frame beat React's commit, the arrow was not `disabled` yet, and
  focusing it was undone milliseconds later — the fix looked right and the walk still ended on
  `<body>`.
- **…and a one-shot restore is not enough, which is what `check:browser`'s case P went red on in
  CI for a month (`{"row":-1,"arrow":""}`, roughly a third of `browser` runs; #139, fixed).** The
  healthy sequence is measurable and was measured — `focusin [up]@row1 → focusout [up:off]@row1 →
  focusin [down]@row0`: the arrow the rule travelled with is `disabled` at its new end of the
  list, Chromium clears focus off a control that becomes disabled, and `TaskSortEditor`'s effect
  then focuses the *other* arrow. What a one-shot has no answer for is a render arriving **after**
  that effect which disturbs the rule for one commit — a superseded `GET /api/settings` from an
  earlier write's invalidate, which is what a slow runner produces. Focus is cleared a second
  time, the restore is already spent, and the next render (the correct order) re-focuses nothing.
  `row: -1` is that state. The restore therefore **chases**: it stays armed and puts focus back on
  every commit that drops it, standing down only when focus lands on a real element outside the
  list. Two shapes have to survive that, and both are in the gate — a body that still knows the
  rule but leaves it at an end (`i` unchanged, arrow disabled: an *index* test misses this), and a
  body from before the rule existed at all (`i < 0`, so „the rule is gone" must not disarm).
- **Reproducing a superseded read: fulfil one, never hold it.** Parking the GET does nothing —
  React Query cancels the in-flight fetch when a newer refetch starts, so a held response is
  discarded rather than applied (0/7 here, both shapes: request held, and response fetched early
  and fulfilled late; also 0/10 under 8× CPU throttling). What the product has to survive is the
  *commit*, so cause that instead: a one-shot `page.route` that answers a single `GET
  /api/settings` with a body the window has been past for two writes, and — because
  `invalidateQueries()` is the one thing that refetches regardless of `staleTime` — make the
  window ask for it through the app's own cross-window signal,
  `new BroadcastChannel('auftakt').postMessage({ v: 1, type: 'invalidate' })` from inside the
  page. `client/src/lib/broadcast.ts` states the spec suppresses delivery only to the posting
  channel *object*, so a second channel in the same window reaches the app's singleton; a
  synthetic `focus` event does not work, the five-second `staleTime` swallows it. Two rules make
  it honest: wait for a quiet window first, or a GET still in flight eats the shot and the case
  reports a product failure for an injection that never happened — and assert the „was served"
  flag as its own staging line, the way `check:boot` asserts every injected cause. The gate then
  reproduces the *effect* (a commit that disturbs the rule) rather than the *cause* (a genuinely
  late read); that is the trade, and it is the input the restore has to handle.
- **The same one-shot shape is still in `CustomColumnManager`, deliberately.** Its list also comes
  back from a refetch, so it has the same exposure — but it has never been observed doing it, and
  its comment says so. A red there is not a new finding; it is this one, and the fix is written
  out in `TaskSortEditor`.
- **Setting `input[type=color].value` directly is deduped by React's value tracker.** Use the
  native setter.
- **A status change re-sorts the task table**, so `.first()` addresses a different row afterwards.
  Assert the write, not the label.
- **`text-decoration-line` does not show up on the descendants it paints.** It is not an
  inherited property — the decoration propagates *visually* into in-flow block boxes while the
  computed value on every one of them stays `none`. So a done task's struck comment reads
  `line-through` on the wrapper and `none` on the `<p>` the Markdown renderer emits, and a check
  written on the `<p>` fails against working code (WP-58). Assert on the element that carries the
  class, and — since the propagation is what the fix relies on — assert the *precondition*
  separately: `display: block`, `float: none`, `position: static` on the descendant. An
  `inline-block` there would silently stop the strike, which is also why the strike sits on the
  title button rather than on the `<tr>`.
- **Tailwind v4 serialises `text-neutral-400` as `oklch(0.708 0 none)`**, not `rgb(163,163,163)`,
  so a hardcoded rgb comparison never matches. For „this cell no longer overrides the row's grey"
  the honest assertion is the comparison itself: read `getComputedStyle` on the `<tr>` and
  require the cell's `color` to equal it.
- **`input[placeholder*="Aufgabe"]` matches the global search box, not the task composer** — the
  search placeholder is „Suchen … (Künstler, Projekte, Aufgaben, Termine, Kontakte)" and it comes
  first in the DOM, so `.first()` types into the header and the table never changes. Anchor it:
  `input[placeholder^="Neue Aufgabe"]`, or `^="Neue allgemeine Aufgabe"` on the Übersicht.
- **The task title cell also carries the subtask counter** („Requisiten sichten\n0/3"), so an
  `innerText` comparison needs the first line only.
- **A column header's `innerText` is neither the column's name nor only its name.** The header is
  CSS-uppercased and prefixed with the column's icon, so „Abgabe" reads back as „📆 ABGABE" — an
  equality test against the name fails on a table that is rendering it correctly. Case-fold and test
  for containment. `table thead th` also spans *every* table on the page, and on an artist or
  project page the Besetzung table („Position", „Person") comes first, so a positional read of that
  list is not the task table's.
- **A row located by its title stops matching the moment that title is being edited.** React sets
  `value` as a property, so an open `InlineInput` has no text — `locator('tr').filter({ hasText:
  title })` resolves to nothing and every follow-up call waits out its timeout while the editor is
  right there on screen. Anchor the row on something that stays rendered (its Bereich pill, its
  comment) and address the cells by `td` index; `td` 0 is the tree gutter, so with the demo's
  columns Fällig is 3 and Abgabe 8. `#/artist/1` has one more column („Freigabe") but it sits
  *after* those, so both indices still hold there.
- **Typing one segment into a *filled* date cell does not produce a half-typed date** — it replaces
  that segment and the value stays complete, so a check for „Enter must not commit" passes
  vacuously against working code and would pass against the bug too. Reproduce it in an **empty**
  date cell (demo task 2, „Anmietung Schlagzeug klären", has no Fällig), or press Backspace on a
  filled one to clear the focused segment. `input.validity.badInput` is the state under test;
  Enter then leaves the editor open and writes nothing (WP-43).
- **Search hits are not tab stops.** ↑/↓ move a marker while focus stays in the field, so read
  `aria-activedescendant` against the `[role="option"]` ids rather than `document.activeElement`,
  and press Enter on the *field*. What Tab from the field lands on is **not fixed**, and asserting
  it is how this check goes red on a good build: Chromium makes an `overflow-y-auto` region
  focusable only while it really scrolls, so with a long list the next stop is the panel itself and
  with the demo's six „Konzert" hits — `scrollHeight === clientHeight` — it is the next button in
  the header instead. Assert what the rule actually says: the next stop is **not a hit**. And read
  the hit count in the same evaluate, because „focus is not on a hit" is also true of a panel that
  closed on the keystroke.
- **⌘F/⌘K focus the search field, and are inert while any dialog is open.** A script that expects
  the shortcut to work over a modal is asserting the opposite of the rule (WP-43).
- **An option group is one tab stop, so a tab walk that counted pills now ends somewhere else.**
  The items carry `data-roving`, and exactly one of them has `tabindex="0"` — assert that pair
  (`[data-roving][tabindex="0"]`) rather than walking, and use the arrows to move inside the
  group. The same holds for a ▲▼ pair, where ↑/↓ *perform* the move; auto-repeat is ignored, so a
  held key moves a row once.
- **Scroll a popover trigger into view before clicking it.** `useAnchoredPopover` closes on any
  scroll outside its menu, and the scroll `click()` performs for itself arrives *after* the
  popover opened — the menu blinks shut and the run reads „`PillSelect` does not open at all",
  with `aria-expanded="false"` to back it up. `await trigger.scrollIntoViewIfNeeded()` first.
- **…and scrolling first is only half of it: `click()` scrolls *again*, after its own stability
  check, and the event lands one frame later — inside the menu it just opened (#155).** A scroll is
  performed synchronously; its **event** is not. Chromium queues it and dispatches it in the next
  „update the rendering" step, which neither `scrollIntoViewIfNeeded()` nor `click()` waits for —
  and `click()` runs `scrollRectIntoViewIfNeeded` *after* the visible/stable/enabled wait, so
  nothing at all separates that scroll from the mouse events it then dispatches. When the layout
  has moved since the explicit scroll — a background refetch committing, which is exactly what a
  loaded runner produces — the click has something to scroll, opens the popover, and the queued
  event then reaches `useAnchoredPopover`'s capture-phase listener, which closes the menu the same
  click opened. Measured on `#/project/2` with the move injected (`window.scrollBy(0, -160)`
  between the two scrolls): `listbox+` at 1104 ms, `scroll` (document) at 1105 ms, `listbox-` at
  1111 ms — **4 of 12 runs**, the rate the `browser` job showed on 2026-08-26. Which wait after it
  reports the damage is a coin toss, so one close wears three faces — „Menü false", „Menü true,
  Eintrag sichtbar false" and „sichtbar true, geklickt false" are the same defect caught
  milliseconds apart, never three. **The recipe is a menu that has survived a frame, not a sleep
  and not a longer timeout**: scroll, wait one rendering opportunity, click, wait another, and only
  then believe a listbox that is still on screen — otherwise make the gesture again, which now
  finds the row where the last one left it and scrolls nothing. Count that retry and put the number
  on the summary line (`reopenedPopovers`, beside `reloadedSurfaces`): a run that reached green by
  racing is not a run that never raced, and a ⚠ six hundred lines up is not something anybody reads.
  `scrollSettled()` in
  `check-browser/browser.mjs` is that wait (two `requestAnimationFrame`s: a frame's scroll steps
  run *before* its animation-frame callbacks, so one already proves delivery and the second is the
  margin), and `ccOpenPill` in `cases/columns.mjs` is the shape. `cases/tasks.mjs`,
  `cases/subtasks.mjs` and `cases/keyboard.mjs` open the same pill and carry the same exposure.
- **…and the scroll that shut it was not always one anybody performed (WP-83).** The entry above
  blames the driver's own `click()` scroll, and that was only half of it: the second half needs no
  driver at all, which is why `scrollSettled` could not cover it and why the same case went red
  again after #156. The task table's wrapper is `overflow-x-auto` (`TaskTable.tsx:614`), and an
  open `InlineInput` is **wider than the value it commits** — `min-w-48` for a text cell, `w-40`
  for the date one. So the moment an editor closes, the table gets 70–150 px narrower; and because
  `InlineInput` only closes when its write's blanket `invalidate()` resolves
  (`InlineInput.tsx:112` → `hooks.ts:946`), on a run with this gate's ~25 open windows that
  arrives *seconds* after the server already has the value. A case that waits on the API — as AM's
  `until(() => ccValues(…))` does — therefore starts its next gesture with the editors still open
  behind it. Reach a late column with `scrollIntoViewIfNeeded` and the wrapper is at its right-hand
  end; the narrowing then forces the browser to pull `scrollLeft` back into range, and **that
  clamp is dispatched as a `scroll` event**, which `useAnchoredPopover` used to read as „the user
  scrolled". Measured on `#/project/2` with nothing injected: `editor-` at 217 ms, `scroll`
  (wrapper, left 269 → 200, scrollWidth 1501 → 1432) at 229 ms, `listbox-` at 238 ms. Where that
  lands decides which face it wears — before `shown()` the retry above eats it (**6 of 30** runs at
  24 windows and 6× CPU throttling), after it the click detaches and the run reads „sichtbar true,
  geklickt false" with no ⚠ at all, which is CI run `33073114558`. Forced into the click's own
  window it is **12 of 12**, and Playwright names it exactly — `element was detached from the DOM,
  retrying`, then the timeout. **The tell is that the anchor does not move**: the table loses
  exactly what the clamp takes back, so a pill to the right of the shrink is stationary — measured
  at 0 px in both axes — and the menu is still perfectly aligned with its trigger at the moment it
  is taken away. Hence the rule the hook now applies: re-measure the anchor and close only when it
  has really gone somewhere (`popover.ts`), which leaves a genuine page scroll closing the menu as
  before. Withholding that one event from the hook took the forced repro from 12/12 to 0/8, and the
  fix takes it to 0/12 with the unforced reopen rate going from 6/30 to 0/20.
- **…and never screenshot an open popover with `fullPage: true`.** Same rule, one step further:
  `shot()` in `lib/drive.mjs` stitches a full-page picture by *scrolling*, which closes the popover
  before the shutter — so the file shows the page without its menu and every locator after it times
  out against working code („the picker does not open"). Take the viewport shot instead
  (`page.screenshot({ path })`, no `fullPage`), or screenshot after the pick. Cost half an hour on
  WP-62.
- **„Spalten verwalten" has two lists on an entity page since WP-59, and `[data-column-row]`
  matches both.** The upper one is „Globale Spalten" — one row per global column, with the 👁/🚫
  toggle *only* (no ▲▼, no ✎, no 🗑, and none at all on the locked Status/Aufgabe rows), writing
  this page's `task_columns`. The lower one is the page's own scope, which is where renaming,
  reordering and deleting still live. So a bare `[data-column-row]` on `#/project/1` no longer
  matches nothing (it used to, which was the old trap here), it matches the seven globals — scope
  to the list: `ul:has-text("Globale Spalten")` reads badly, so take
  `page.locator('ul').nth(0|1)` inside the dialog, or filter the rows by name. „Auf Saison-Vorgabe
  zurücksetzen" only renders while `task_columns` is non-NULL, so a script that waits for it on an
  untouched page hangs. The demo still has exactly one page-scoped column („Freigabe" on
  `#/artist/1`, WP-51); every other artist page's *lower* list is empty.
- **Toggling a global column there writes the entity, not the column.** Assert on
  `GET /api/projects/<id>` → `task_columns` (a JSON *string*, keyed by `colId` — `due`,
  `custom:9`), never on `/api/custom-columns`, whose `enabled` is deliberately untouched. Toggling
  a column back to the season default **deletes** its entry, and emptying the map stores `NULL` —
  so „the override is gone" and „the page never had one" are the same stored state by design.
- **An artist page holds several tables** — every project card is one — so `table thead th` reads
  the project grid, not the task table. Pick the table whose header row carries „Aufgabe".
- **Column headers are uppercased in CSS**, so `innerText` says `FREIGABE` where the DOM says
  `Freigabe`. Worse, `innerText` read straight after a modal's `waitFor()` returned a *partial*
  view of the still-settling dialog — „Globale Spalten" was missing from it while the same node's
  `textContent` had it all along. Assert on `textContent` (`locator.evaluate((el) => el.textContent)`).
- **The Einstellungen tabs are links, not buttons** — `getByRole('button', …)` waits for ever.
  Navigate straight to the slug: `#/einstellungen/aufgaben` („Aufgaben & Übersicht"),
  `/kategorien`, `/daten` („<Saison> & Daten") or `/hilfe` („Programm & Hilfe"). The labels moved
  in WP-54 and the slugs did not, so a script keyed on a slug survived it and one keyed on a
  label did not. `a[href^="#/einstellungen/"]` is the tab bar and exactly four elements; a bare
  `nav a` also takes the header's own links, and `#/einstellungen` itself is an index route that
  redirects rather than a page — assert that as a navigation (`waitForURL`), because after a
  `reload()` the URL is the redirected one either way.
- **A settings editor refuses by going *stumpf*, not by complaining afterwards.** „Speichern" is
  `disabled` while the draft is invalid (`validateOptions`) or unchanged, so a script that clicks
  it and waits for a message waits 30 s on a dead button. The refusal to read is the pair: the
  disabled button and the amber sentence naming the row („Kategorie 6 hat keine Bezeichnung …").
- **`aria-current` on a tab lands one commit after the URL.** `waitForURL` resolves on the history
  entry, `NavLink` marks itself on the render that follows — so a read taken straight after the
  navigation says `null` on a router that is working. Poll for it. (And assert something the target
  tab actually renders beside it: „the link is current" is also true of a route that rendered
  nothing into the `<Outlet>`.)
- **`OptionsEditor` reseeds its draft from the server list, and throws away what was typed in
  between.** `useEffect(() => setDraft(options), [options])` — so anything added between a save
  landing and its invalidate arriving simply vanishes, silently. A script that adds a row, saves,
  and adds the next row as soon as the *API* shows the first one is racing that reseed: the second
  row disappears, and every following click addresses a row one position off — which is how a
  cleanup step ends up removing a demo category and hanging on the reassignment dialog it opens.
  Wait for the **rows**, not for the API, before touching the editor again.
- **Its rows are keyed by index, so two clicks on „the last ✕" inside one render hit the same
  position twice.** One row is removed, the second click re-runs the same `removeAt(i)` — and if
  the list shrank in between, the position now holds a different option. Remove one at a time and
  wait for the row count to drop before the next click; with a used category behind it, the
  rediscovery of this costs a demo fixture rather than a red check.
- **Read an option row's label off `el.value`, and check the whole draft before every save.** React
  writes `value` as a property, so the labels are invisible to a selector — but `evaluateAll(els =>
  els.map(el => el.value))` reads them, which is the only way to find out *which* row „the last
  one" currently is. `check:browser` asserts the full label list before each „Speichern" for that
  reason: as an assertion it says „what was typed is in the draft and nothing else moved", and as a
  guard it is what stops the reseed above from turning a red check into a renamed demo category.
- **The two „Zeitfenster" boxes must be *emptied*, not selected-over.** Their defect (PGS-04) was
  a clamp per keystroke: the empty field was written back as a 1 and the next digits appended, so
  clearing 14 and typing 60 stored 160. `ControlOrMeta+a` followed by typing never leaves the box
  empty and passes against exactly that — press Backspace first.
- **A `mailto:` is fire-and-forget, so the feedback dialog produces no app state to assert on.**
  Its only observable is the URL handed to `openExternal`, and the real one opens a mail client
  on the machine running the script. Stub the bridge with an `openExternal` that *records* —
  `window.__external.push(url)` — then read it back with `new URL(...)` and `searchParams`, which
  is also the only honest check of the encoding. Since WP-66 only the optional
  „hier klicken"-Mailto link produces one, and the dialog stays open behind it, so the recorder
  answers two questions rather than one: what the link handed over, and that nothing else did.
  **`check:browser` carries its own copy of that stub** (WP-64c) rather than importing
  `lib/drive.mjs`, which belongs to the ad-hoc runtime, imports `playwright` and points at :4317.
  Two runtimes, one pattern: a change to the bridge has to be made in both. The gate's copy takes
  the platform and the two update answers as parameters, because `checkForUpdates`'s `refresh`
  argument is the card's own distinction between the cached startup check and the one the button
  asks for — which is how one page drives both the „Herunterladen & installieren" branch and the
  „Zur Releases-Seite" one.
- **The update card's progress bar cannot be reached by a stub that only answers questions.**
  The percentage is *pushed* from main over `onUpdateProgress`, so a bridge stub whose members all
  return promises leaves the card frozen in its first frame — which is exactly the frame it used
  to have permanently, i.e. the defect WP-60 fixed looks identical to a stub that cannot drive it.
  `stubElectron` now keeps `installUpdate` pending and hands the subscriber back as
  `window.__updateProgress(pct)`, with `window.__finishUpdate()` to resolve the invoke. Three
  prerequisites, and each one fails silently on its own: the card is at
  **`#/einstellungen/hilfe`**, never at `#/einstellungen` (which lands on „Aufgaben & Übersicht" —
  the card is simply not in the DOM, so every selector matches nothing and reads as „the update
  card is broken"); `platform` must be `'win32'`; and `checkForUpdates` must answer
  `{ updateAvailable: true, canInstall: true }` — on the stub's defaults („darwin", `null`) the
  „Herunterladen & installieren" button does not exist and the click waits for ever. Everything
  past `quitAndInstall` — the restart dialog, `setProgressBar`, NSIS — has no browser equivalent
  and is Windows-manual by construction.
- **„Bericht speichern" is the click that writes the file, and the handover waits for that
  write.** It replaces the form in the *same* dialog once main has answered, so `dialogs(page)`
  stays at **1** and „the second modal appeared" is not a usable wait — wait for
  „Adresse kopieren" instead, or for the file name in `topDialog(page).innerText()`. Its footer is
  „Text ergänzen" and „Fertig"; the second closes the dialog and sends the toast naming the
  bundle, and nothing anywhere claims the mail was sent, because the app cannot know. Escape and
  the backdrop close the whole dialog from there — there is no layer left to peel.
- **The handover has body tabbables, so focus does *not* land in the footer.** WP-42's „a confirm
  focuses the footer's safe answer" holds for dialogs whose body has nothing to focus; this one's
  first stop is „Adresse kopieren" (`tabStop` index 1). `Modal` places focus only when it opens,
  so the button carries `autoFocus` for the state change — Enter on arrival copies the address,
  the first step, and nothing that cannot be taken back.
- **The dialog asks nothing at all.** Since WP-75 there is no kind, no area and no required
  answer: one textarea („Was ist passiert? (optional)"), reachable as `locator('textarea')` from
  the first frame — address it by position rather than by label (the `getByLabel` trap below
  applies here too). The subject of the optional `mailto:` is `[AF-<10 digits>] Auftakt-Feedback
  (v<version>)`, and the reference is stamped once when the dialog opens — the same value appears
  in the subject, in the body's technical block („Kennung: AF-…") and in the diagnostics filename,
  which is what to assert they agree on. With a bundle written the body's first line is
  `!! BITTE NOCH ANHÄNGEN: …`; without one it starts on `--- Meldung`, or on
  `--- Technische Angaben` when nothing was typed either.
- **`getByLabel` finds nothing in a `RecordFormModal`.** Its `<label>` (`fields.tsx`) carries no
  `htmlFor` and does not wrap the input, so the two are not associated and Playwright's
  accessible-name lookup times out — 30 s per field, reading as „the dialog never opened".
  Address the field by its placeholder instead (`getByPlaceholder('z. B. Fördervertrag')`).
- **A drag must start on the ⠿, not on the row.** Every reorderer runs `useDragReorder` in
  `mode: 'armed'`, so the item is not `draggable` until a primary-button `pointerdown` lands on
  its handle — `locator.dragTo()` on the row body is a silent no-op that reads as "reordering is
  broken". What works: hover the row, `mouse.move` onto `[title^="Zum Verschieben ziehen"]`,
  `mouse.down`, `mouse.move` to the target with `{ steps: … }`, `mouse.up`.
- **Match the handle's title with `^=`, not `=`.** In a link list *with* categories the tooltip is
  „Zum Verschieben ziehen (innerhalb der Kategorie)"; everywhere else it is the bare sentence. An
  exact-match selector finds nothing on `#/project/1`.
- **Two more moves belong in the recipe, and both are silent when missing.** The pointer has to
  *travel* before Chromium turns the press into a native drag, so a single `mouse.move` to the
  destination starts nothing — go there with `{ steps: 25 }`. And the last `dragover` before the
  release is what sets the drop target, so end with a 5-step 2-px nudge; a move that finishes on
  the coordinate the previous gesture already ended at can leave `overKey` where it was.
- **A driven drag never delivers a `drop` anywhere but to the reorderer, so CCL-15 is not
  gateable from a browser.** Measured with a listener on the global search field while dragging a
  contact row onto it: `dragenter` and `dragover` arrive (seven of them, with the payload's MIME
  in `dataTransfer.types`), and `mouse.up` dispatches **no `drop` at all** — the field stays
  empty even with `DRAG_MIME` reverted to `text/plain`, i.e. with the defect back in place. So an
  „a row released over an input types nothing into it" assertion passes against the bug and must
  not be written. The corollary is about the fix as a whole: **deleting the `setData` call
  outright changes nothing a driven run can see** (Chromium starts a drag with an empty data
  store; only Firefox refuses one), so „remove `DRAG_MIME`" is not a canary for the drag cases —
  removing `handleProps`' `onPointerDown` is, and it takes nine of them red at once. CCL-15 and
  the Firefox half stay hand-verified.
- **`waitForURL` resolves one query before the target page has rows on it.** A client-side
  navigation changes the hash with the transition, so a `count()` read straight after it is 0 on
  a page that renders the card a moment later — and the *click* that follows passes anyway,
  because a locator waits. Wait for the node before counting it.
- **The handle is `opacity-40` at rest and `opacity-100` on row hover** (WP-35 — it used to be
  invisible until hovered). Both states are hit-testable, so actionability was never the issue;
  what changed is that a screenshot assertion about a "clean" row now has a ⠿ in it.
- **Reorderable surfaces, as of WP-50:** task rows, links (within one category group), contacts,
  the project cards on an artist page, the artist cards on the Übersicht, the season cards on the
  landing page, the landing page's document lists (the builtin „Dokumente" card *and* every custom
  Dokumente-Bereich), and sections in „anordnen" mode.
- **The landing documents reorder without a `reorder` request.** They are a JSON array in
  `seasons.json`, so the drag issues `PATCH /api/landing` with the whole `documents` (or
  `sections`) array — a script waiting for `**/reorder` waits for ever. Assert against
  `GET /api/landing`, or after a `reload()`.
- **A *refused* drop issues no request at all**, so there is nothing to poll for and no state to
  wait on — the row simply snaps back. „Nothing happened" has to be asserted as a beat (longer
  than the accepted reorder beside it took) followed by the same read, which is the one place in
  a drag scenario where a fixed wait is the honest shape rather than a coin toss.
- **The link list's group dimming is a CSS transition, so it has to be polled while the pointer
  is still held.** `LinkList` puts `opacity-40` on every group but the dragged row's, on a
  `transition-opacity` wrapper — sampled the instant the pointer arrives over the foreign group it
  still reads ~0.99, so a check written as grab → move → read fails against working code, and the
  700 ms sleep that hides it is a guess. Hold the drag (`mouse.down`, `mouse.move`, *no*
  `mouse.up`), poll `getComputedStyle` until one foreign group has dropped, then assert — and
  assert the **source** group is still `1` in the same sample, which is the half that fails if the
  dimming is simply applied to everything. The wrappers are `div.transition-opacity` inside
  `[data-section="links"]`, one per group, each holding its heading `span`.
- **The drop target's cue is a different property on every surface, and one of them is a colour
  that no literal may name.** A task row gets `outline-style: solid` where every other row reads
  `none`; a project card gets `ring-2`, i.e. a box shadow on the outer `[data-project-card]` —
  which carries no `hover:shadow-md` of its own, so the reading is unambiguous while the pointer
  sits on it, and the *inner* `Card` would not be; a **section in „Bereiche bearbeiten" is always
  outlined** (dashed `neutral-300`) and only its *colour* changes. So read the arranger's target
  as the **odd colour out** of all sections rather than against `oklch(0.439 0 none)`, which is
  how Tailwind serialises `neutral-600` today and not a contract (same trap as `text-neutral-400`
  above).
- **The highlight and the fade do not arrive in the same frame.** Both cues sit behind a CSS
  `transition`, and `reducedMotion: 'reduce'` does not touch transitions — so a poll that waits
  only for „some element is the drop target" reads the *carried* one at full opacity, which fails
  the „and the dragged card goes blass" half against working code — met on the project cards, the
  first time that case ran („blass keine" against a card on its way to 0.4). Put **both** states in
  the poll's predicate.
- **A drop point on a big surface has to be computed, and the app's sticky header is 62 px.** The
  geometric centre of a `[data-section]` in „Bereiche bearbeiten" is regularly outside the window
  — the section is taller than the viewport — and a `mouse.move` to a centre that has been
  scrolled up lands on the **header** instead: no `dragover` ever reaches the section, the release
  does nothing, and the run reads exactly like a refused drop. Clamp the point into the visible
  band (`max(rect.top, ~110)` … `min(rect.bottom, innerHeight - 12)`); `check:browser`'s
  `dragOver` does that for every target now, which is a no-op for a short row.
- **The task table's ⠿ is a *different element* under a header-click sort.** With an override in
  force the row renders a disabled handle titled „Spaltensortierung aktiv — …", so
  `[title^="Zum Verschieben ziehen"]` matches nothing at all: an unguarded `boundingBox()` there
  costs 30 s and then ends the run rather than reddening a line. Address the disabled one as
  `[title^="Spaltensortierung"]`, and note that the column header's own `title` names the way back
  („Sortieren: aufsteigend → absteigend → Standard") — the third click is TTU-18.
- **`sort_order` is renumbered per sibling group, so the ordinals of two levels collide.** One
  drag among a parent's children renumbers *those* rows 0..n-1 while the top-level rows keep their
  own 0..n-1 — by design, because the column orders a row among its siblings and not in the table.
  A check that expects the numbers to be unique per page fails against working code.
- **A card must not open when it is dragged**, and that is assertable rather than assumed:
  `DragHandle` swallows its own click (it sits inside the project card's `<Link>` and beside the
  season card's `role="button"`), so after a card reorder the URL must be unchanged — and on the
  landing page's document rows, whose label *is* a button into the outside world, the recording
  bridge stub must still be empty. Pair it with one real click, or „nothing was opened" is also
  what a stub nobody wired reports.
- **`keyboard.down` emits one keydown.** A repeat-key defect (TTU-24) needs events dispatched with
  `repeat: true`.
- **Some repros only fire inside a refetch window.** On a local server the refetch beats a human's
  second click, so the defect looks fixed when it is not — delay the relevant request with
  `page.route` (CCL-21 and PGS-10 both need `GET /api/settings` held back).
- **To stage a two-window landing conflict, hold the second window's WRITE, not its read.**
  The obvious setup — snapshot `GET /api/landing` at generation N and deliver it late, so the
  window computes from stale content — does not work, and produces a green run with zero 409s:
  the other window's write broadcasts an invalidate, the held window's `['landing']` query is
  active, so it refetches, and *that* GET supersedes the held one inside react-query. Measured
  during WP-53: two GETs from the same page, the second carrying the newer generation, and
  `update()` computing from it. That is the app's first line of defence working. The lost update
  the package is actually about is a write computed from N *arriving* after N+1 landed, so route
  the `PATCH` and sleep before `route.continue()`, then fire the other window's write inside that
  window. Release the hold before the retry (`hold = 0` inside the handler) or the run measures
  the sleep twice.
- **A `sleep` before `route.continue()` delays the *request*, not the answer — so it hands the page
  data that is *newer*, never older.** The distinction is invisible until a repro needs a stale
  answer to land late, and then it silently inverts the experiment: the held request reaches the
  server *after* everything else has, and comes back current. To hold an *answer* back, read the
  server at the right moment and deliver it afterwards — `const res = await route.fetch(); await
  sleep(ms); await route.fulfill({ response: res, body: await res.body() })`.
- **…and a refetch held that way still does not win, because react-query cancels it.**
  `invalidateQueries` goes through `refetchQueries`, whose `cancelRefetch` defaults to **true**, so
  the next invalidate aborts the fetch still in flight and its late answer is dropped rather than
  published (`@tanstack/query-core` 5.101.4, `build/modern/queryClient.js:168` — the same line is
  `build/legacy/queryClient.js:179` and `src/queryClient.ts:319`). Measured in WP-82 on
  `#/project/2`: refetch 1 read a one-key `task_columns`, its answer was held 2.5 s and settled
  1.4 s after refetch 3 had published all three — and the page still showed three. So „an earlier
  invalidate republished the older value over the newer one" is **not** a mechanism here, for any
  store that invalidates on write; it is the same first line of defence the two-window landing
  entry above describes. Look at what the *server* ended up holding instead.
- **Assert the 409 actually arrived.** Every one of these cases passes for the wrong reason if the
  timing slips and no conflict happens — the outcome is correct either way, which is the whole
  point of the fix. Count them off `page.on('response')` and fail on zero.
- **A hash navigation does not refetch `['settings']`**, so a fixture written straight to the API
  needs a real `reload()` or the page persists the stale array over it.
- **Clean up fixtures between runs.** A script that throws mid-way leaves its rows behind, and the
  next run then matches two elements with the same name and picks the wrong one.
- **`EditableText` opens from its hover-revealed ✎, not from a click on the text.** Those headings
  sit in clickable surroundings (widget cards, season cards), so click-anywhere would misfire —
  the component says so and a script that clicks the heading simply never opens an editor, then
  times out waiting for the input. Use the pencil's accessible name:
  `getByRole('button', { name: '„Verträge 2027“ umbenennen' })`, German quotes included. The input
  it opens is an `InlineInput`, so find it by class (`input.uppercase` for a section heading) or
  as `input:focus` — never `input[value="…"]`, see above. Enter commits.
- **Open an `InlineNotes` editor by clicking a text run, never the prose box.** A `.click()` on
  `.prose-md` lands at the element's center, and the demo notes put links and a linked image
  there — the click then navigates (or selects the image) and `.rte-content` never mounts, which
  reads as „the editor is broken". `getByText('Streichquartett')` opens the artist note reliably.
- **⌘↵ saves only while the caret is still in the text, and the failure is silent.** It is the
  editor's own keymap, so a chord pressed while focus sits on a toolbar control — or on
  `<body>`, after a control unmounted under it — reaches nothing, the note is never committed and
  the API keeps the old row: „the editor does not persist" for what is really a lost caret. What
  keeps focus where it belongs is `Btn`'s `onMouseDown={(e) => e.preventDefault()}`, on every
  toolbar button *and* on each colour swatch. Taking it off a **swatch** is worth knowing about
  before writing a canary for it: the app recovers on its own most of the time, because `pick`
  ends in `editor.chain().focus()` and usually wins the race against the menu unmounting — it
  showed up in one run of three, and only as the four „was it stored" assertions. Taking it off
  `Btn` reproduces every time. Either way, assert the stored value rather than the screen: the
  marks all land correctly in the DOM in exactly the runs where nothing is saved.
- **`.prose-md` is *both* surfaces, so „wait for the reader to come back" is not a wait at all.**
  The editable node's own class list is `prose-md ${roomy}rte-content …` (`RichTextEditor`), so
  while a note is being edited `page.locator('.prose-md').first()` **is the editor** — a
  `waitFor()` on it after ⌘↵ is satisfied by the surface that is already on screen, and an API read
  taken straight afterwards races a PATCH that has not been sent yet. What really says the commit
  landed is the editor **going away**: `InlineNotes` leaves edit mode only once the write resolved
  (RTE-01), so `.rte-root` detaching is the signal, and `gone(page.locator('.rte-root'))` is the
  wait. **`CommentCell` is the exception and the rule inverts there**: its `onBlur` runs
  `setEditing(false)` *before* `onCommit`, so a task comment's editor is gone while the PATCH is
  still in flight and „the editor went away" says nothing about the write at all. For a comment,
  poll the API for a value only the write can produce — and make that predicate discriminate,
  because the demo seeds task 30's comment with a `tc-rot` run, so a poll for a bare `tc-` is
  satisfied by the row as it already stands and resolves on its first read.
  Getting this wrong is not merely a race — a re-open that runs inside the gap clicks the
  *editor's* own paragraph, watches it re-focus, and is then unmounted underneath the next
  keystroke, which reads as „the note cannot be opened a second time". Address the reading view as
  `.prose-md:not(.rte-content)` when the distinction matters.
- **Opening and closing a note stores nothing — a serializer change needs a real keystroke.**
  `InlineNotes.commit` compares the draft against the prop and returns early when they are equal,
  and the draft only moves when `RichTextEditor` fires `onChange`. So the obvious repro for „what
  does the editor write back" — click the note, click away, read the API — reports the stored text
  unchanged whatever the serializer does, which reads as „the bug is fixed" against unfixed code.
  It cost one wrong verdict on WP-57. Type something (`page.keyboard.type(' Nachtrag.')`; the
  autofocus already parks the caret at the end) and then blur. That is also how the user meets such
  a bug: the note is intact until the day somebody fixes a typo in it.
- **Demo project 5 („Klanginstallation") is the blank-line fixture** (WP-57): a blank line between
  two lists, two consecutive blank lines, a blank line after a list, four `&nbsp;` markers in all.
  A script that edits it is not re-runnable against a dirty database — PATCH the description back
  before the run rather than re-seeding under a live server.
- **`h1` is not a safe blur target, because a note can contain one.** The demo project description
  begins with `# Eröffnungskonzert`, which renders an `<h1>` inside `.prose-md` — the same text as
  the page heading, so `locator('h1')` is a strict-mode violation that looks like a duplicated
  page title. Use `.first()`, or click something a note cannot contain.
- **Commit-on-blur is asynchronous.** After clicking outside the editor, the PATCH is still in
  flight; a `GET` issued immediately reads the pre-edit row and the save looks lost. Wait for the
  re-rendered reader to show the change (e.g. `.prose-md img[width="768"]`), then read the API.
- **Two `locator.boundingBox()` calls straddle the post-save re-render.** The query invalidation
  after a commit re-renders between them, so a parent measured before and a child measured after
  compare boxes from *different layouts* — a float read as escaping its container by 400px when
  the steady state was fine, twice. Snapshot all geometry in one `evaluate`, or better, phrase the
  assertion as an eventually-true `waitForFunction` so a transition can never be the sample.

### The announcement overlay (WP-63)

- **It is invisible until you install a payload, and that is deliberate.** There is no fixture in
  `server/src/demo.ts` and no UI that creates one — a card in front of every `npm run demo` would
  be in the way of every other visual check. Write the key by hand into `.demo/seasons.json`
  (gitignored), the way the real one is installed:
  `announcements: [{ id, title, body, date: 'MM-DD', celebrate: true }]`. The registry is re-read
  from disk on every request, so the next `reload()` picks it up — no server restart.
- **…but write that file the way the server does: to a `.tmp` and `renameSync` over it.** „Re-read
  on every request" is the other half of a trap. A plain `writeFileSync` truncates before it
  fills, so the file is briefly **empty** on disk — measured at 67 070 empty reads in 278 650
  against a hot writer, and **0 in 380 952** through tmp + rename — and `readRegistry` treats a
  parse failure as corruption: it renames `seasons.json` aside as `seasons.json.corrupt-<ts>` and
  bootstraps a fresh registry holding **one** season. Confirmed end to end by truncating the file
  under a running server: five seasons became one, with the corrupt file beside it. What that
  looks like from a driving script is a burst of „Saison existiert nicht mehr" a case or two
  later, with every fixture season of the run gone; `check:browser`'s `writeReg` is atomic for
  exactly this reason, and it cost one aborted run to find out.
- **„Was ist neu" is driven from the marker, not from a second build.** Set
  `announcementsSeen: { version: '0.9.0' }` in the same file and reload: anything in `CHANGELOG.md`
  above that version is what the card shows. Setting it to a version *above* the running one is how
  you keep it out of the way while looking at a dated announcement.
- **Measuring the fold needs its own payload — the „Was ist neu" card cannot show that bug.** The
  card the marker summons carries every entry above it, and a catch-up card is already at its
  ceiling (`max-h`, then `overflow-y-auto`): opening „Außerdem" changes its height by **zero**, so
  „the top edge did not move" passes against a centred card exactly as well as against an anchored
  one. Install a *short* dated payload with a `<details>` in the body — laid out like
  `CHANGELOG.md`'s, `<summary>` on its own line and blank lines around the list, or remark keeps
  the block as raw HTML and the bullets never become a list — and assert the growth **before** the
  anchoring. Measured at 357 → 415 px with the top edge sliding 197 → 168 while the overlay was
  still `items-center` (2026-08-27, viewport 1428×752). Locate the card by what it contains
  (`div:has(> #announcement-title)`), never by `nth()`: the fireworks canvas sits between the
  scrim and the card and moves the index under you.
- **„Nothing is shown" has to be a wait, never a `count()`.** `html[data-app-ready]` is also set
  from `BootReady`'s unconditional budget, so the feed request can still be in flight when the page
  is „ready" — a zero counted there passes against an overlay that is one round trip from
  appearing, which is the whole failure this assertion exists for. Wait ~2 s for the node and then
  report that it never came.
- **`GlobalSearch` renders its input permanently in the app header.** „⌘K did not reach past the
  overlay" is therefore *not* `input[role="combobox"]` being absent — that locator matches on every
  page of the app, and the assertion passes against a shortcut that walks straight through. Read
  `document.activeElement` instead: what `anyModalOpen()` prevents is the caret landing in that
  field behind a full-screen backdrop.
- **The „Was ist neu" card is only a real test while the card has two or more blocks — and the
  block count is a property of the card, not of one entry.** `splitSignoff` sets a paragraph apart
  only when there are at least two, so „a release card has no sign-off" is true on a single-block
  card whatever the code does. The gate asserts the block count as its own named check for that
  reason — a fixture fact, like the print case's row count. Driving the card from a marker below
  every version puts **every** entry into it, so the block `splitSignoff` would set apart belongs
  to the *oldest* entry: a probe derived from the newest one is the weaker half of the pair and
  the `count() === 0` is the discriminator. Label both for what they are. If a release ever ships
  one paragraph, that check is what tells you, and the answer is to strengthen the assertion, not
  to delete it.
- **A probe taken from `CHANGELOG.md` must skip the `Außerdem` fold's tags.** Since 2026-08-27 an
  entry ends in `</details>`, not in prose. A probe built from „the last non-empty line" therefore
  searched the card for the literal string `</details>` and went red — the card renders that line
  as structure, so the text can never be there. Filter `<details>`/`<summary>` lines out before
  taking first- or last-line probes. The fold's *content* is safe to probe even while it is shut:
  `textContent` reports it whether or not `<details>` is open.
- **The fireworks need `reducedMotion: 'no-preference'`.** Every other driving context here uses
  `reduce` — the boot gesture's documented escape hatch — and that is *also* the branch the overlay
  renders without a canvas, so the standard context gets the reduced-motion variant for free and can
  never see the celebration. And „a `<canvas>` is in the DOM" proves nothing: a loop that never runs
  looks identical from the DOM. Read the pixels back
  (`getImageData(…).data`, count alpha > 8) — headless Chromium runs `requestAnimationFrame` and the
  canvas is same-origin, so it is not tainted.

### Der Aufgabenbaum (#112)

- **The tree's handles are `tbody[data-group-id]` and `tr[data-task-id][data-depth]`.** One
  `<tbody>` per *top-level* task, holding that task and everything folded under it, so „does this
  subtask sit under that parent" is a containment question and not a distance in row indices. Two
  riders. `data-depth` is a **render position**, not `parent_id` — an orphan (below) is `0` while
  its `parent_id` is still set — and a bare `tbody` is not the task table's: the Besetzung grid is
  one, and on `#/project/1` the description's Markdown table is another, both *before* the first
  group. Neither carries the attribute, which is what makes it the handle;
  `document.querySelectorAll('tbody')` is ahead of the task table by however many that page
  happens to have, exactly as `document.querySelector('table')` is.
- **A folded subtask has no row at all.** `buildTaskRows` simply does not emit it — nothing is
  hidden, nothing is `display: none` — so an assertion phrased as „the row is invisible" matches
  nothing and reads as a broken selector rather than as a fold. Count the rows inside the group,
  or wait for `detached`.
- **A parent carries two disclosure controls, and their titles overlap.** The gutter chevron's is
  exactly „Einklappen"/„Ausklappen"; the counter pill beside the title is
  „1 von 3 Unteraufgaben erledigt — einklappen" — the same word, lower case, *inside* a longer
  string. So `[title*="klappen"]`, `getByTitle(/klappen/i)` and an accessible-name regex are all
  ambiguous on any row that has children. Anchor the pill on „Unteraufgaben erledigt" — and the
  chevron on **neither** title, because both of them *are* the state under test: it is the only
  `<button>` in the row's first cell (`tr[data-task-id="…"] td:first-child button`, the ⠿ beside it
  being a `<span>`), and that handle stays the same handle across the click.
- **Read the fold from `aria-expanded` — and if you must read the rotation, read `rotate`, not
  `transform`.** Tailwind v4 compiles `rotate-90` to the standalone `rotate` property, so
  `getComputedStyle(chevron).transform` is `none` in **both** states and „the chevron turned"
  fails against working code; `rotate` is `90deg` open and `none` folded. It is also a 150 ms
  `transition-transform` (which in v4 covers `rotate`), and `reducedMotion: 'reduce'` touches
  animations, not transitions — so a value sampled straight after the click is mid-flight and
  neither state. Both `TreeGutterCell` chevrons (`parent` and the small `branch` one) carry
  `aria-expanded`, which is the handle that needs no polling.
- **Folding writes nothing, and that is assertable.** `collapsed` is `useState` inside
  `TaskTable`, so the toggle issues **no request at all** and does not survive a reload — „the
  fold persisted" fails against working code, and „the fold happened" must be read from the DOM,
  never from the API. Watching `page.on('request')` across the click is the honest form of the
  first half.
- **The counter pill's progress is a background image, and only while folded.** Expanded it
  recedes to `backgroundImage: none`; folded it carries the ratio as its own fill
  (`linear-gradient(to right, rgb(229, 229, 229) 33%, rgb(245, 245, 245) 33%)` for „1/3"). It is
  the one place the fold changes something other than the row count, so a case that only counts
  rows passes against a pill that has stopped standing in for anything.
- **„It renders flat" is the absence of the elbow, and it needs the pair to mean anything.** The
  gutter's connectors are inline-styled `<span>`s in the row's first `<td>`: a child row has a
  1 px rail at `left: 36px` (`span.w-px`) *and* a 12 px elbow (`span.h-px`), a parent has the rail
  only, and a leaf — or an orphan — has neither. Asserting „no elbow on this row" alone passes on
  a build that draws no connectors anywhere; assert an elbow on a real child of the same table in
  the same breath.
- **The orphan does not survive a season copy.** `createSeason` nulls a `parent_id` whose parent
  stayed behind (`db.ts`, „a subtask whose parent stayed behind becomes a root task, not a
  dangling FK"), and the soft-deleted parent is dropped — so the demo's planted orphan (task 12
  under the trashed task 11) exists **only in the demo's own season**, and a case that takes a
  copy first is asserting against a plain root task that looks identical on screen. To get one
  inside a copy, make it the way the app does: delete a parent and answer „Nur diese Aufgabe".
- **The delete dialog's count comes from a *second* query, which lands after the page.**
  `requestDelete` prefers `descendantsOf(useAllTasks())` — `scope: 'all'`, so it sees archived
  children the table does not — and falls back to the one-level live map until that query
  resolves. The count is frozen into the dialog's state at click time, so a 🗑 clicked too early
  says „3 Unteraufgaben" for ever and reads exactly like TTU-05 back again. Wait for
  `**/tasks?scope=all` (attach the `waitForResponse` before the navigation) rather than for
  `data-app-ready`, which says nothing about a query a table mounts for itself.
- **The subtask composer stays open after Enter.** It is the „add several" affordance, so a script
  that waits for `input[placeholder^="Neue Unteraufgabe"]` to disappear as its proof of creation
  waits for ever; wait for the new row instead. It closes on Escape and on a blur with an empty
  box — and clicking „Unteraufgabe hinzufügen" on a *folded* parent unfolds it first
  (`startSubtask`), so the composer is never opened into a group nobody can see.
- **…and the new row lands a query after the API knows about it.** `onAdded` invalidates and the
  table re-renders on the refetch, so a `treeRows`-style read taken the moment
  `GET /tasks?project_id=…` first returns the child shows the group *without* it — and the very
  next line, reading the same DOM for its failure detail, shows the counter already at „0/1". The
  two disagreeing inside one `check()` is the tell; wait for the row, then assert.
- **„Unteraufgabe hinzufügen" is keyed on `parent_id`, „Verschieben" on the render depth**, and
  the orphan is the row where those two disagree: it has the move button (TTU-30 — moving it is
  how the user repairs it) and not the add button (TTU-15 — offering it there is how a
  three-level tree gets built). Asserting one without the other misses whichever way the test was
  swapped.
- **Completing a child sinks it *inside* its group; completing the parent moves the whole
  `<tbody>`.** `sortTasks` runs once over the top-level list and once per sibling list, so a done
  subtask stays under its parent (it does not leave for the bottom of the table) while a done
  parent takes its children with it. Read the group's rows and the order of the `data-group-id`
  attributes — never a row index into the table, which both halves change.
- **Neither direction cascades.** A done child leaves the parent's `status` alone and a done
  parent leaves its children's alone; the counter pill is the only thing that moves. Assert both
  server-side, because on screen a greyed parent above three greyed children is what a cascade
  would look like too.

### Bilder im Text (#108)

The entry under „Before believing any result" above still holds — a paste *is* a `parseHTML` rule,
so `check-markdown.ts` reaches the gate's decision table without a browser, and nothing below
re-asserts it. What only a browser can answer is which HTML the **clipboard** hands over in the
first place, and the answer differs per route. All of it is measured on Chromium 1234 /
playwright-core 1.62.1.

- **`navigator.clipboard.write` absolutizes a relative `src`, so it cannot express „our own
  reference is on the clipboard".** Write
  `<img src="/api/images/<token>?season=1">` as a `text/html` `ClipboardItem`, press ⌘V, and what
  arrives in the paste event is `src="http://localhost:5317/api/images/<token>?season=1"` — the
  fragment is round-tripped through the system clipboard, which resolves every URL against the
  document. `isImageRef` tests `startsWith('/api/images/')`, so the gate refuses it and the picture
  is dropped while the surrounding text lands: from a driving script that reads exactly like „the
  paste gate rejects our own images". It does not. Use this recipe for the **foreign** half only,
  where the URL is absolute anyway (`https:`, `data:`, `file:`) and the rewrite changes nothing.
- **A real in-editor ⌘C does *not* absolutize, which is what makes the „copy a picture inside a
  note" case drivable.** ProseMirror writes the clipboard synchronously from the `copy` event
  (`clipboardData.setData`), and that path is not the async API's — the HTML keeps
  `src="/api/images/<token>?season=1"` verbatim, `getAttrs` accepts it, and `canonicalImageSrc`
  strips the pin on the way into the document. The recipe: select the image *node*
  (`editor.commands.setNodeSelection(pos)` — walk `doc.descendants` for `node.type.name ===
  'image'`), ⌘C, collapse the caret, ⌘V.
- **…and „collapse the caret" is the step that is silently missing.** ⌘A then ⌘C then `End` leaves
  the selection where it was — `End` runs against the pre-⌘A caret through `DOMObserver`'s ~20 ms
  flush — so the paste *replaces* the whole note with itself: the image count does not move, which
  reads as „the paste inserted nothing" on a build that pasted perfectly. `editor.commands.focus('end')`
  is the honest collapse, and the assertion is a count that went **up**.
- **A synthetic `ClipboardEvent` reaches ProseMirror, and it does not absolutize either.**
  `new ClipboardEvent('paste', { clipboardData: new DataTransfer(), bubbles, cancelable })`
  dispatched on `.rte-content` is handled (`editHandlers.paste` does not test `isTrusted`), so a
  relative `<img src>` *is* admitted this way. That makes it the wrong instrument for a rule the
  real clipboard would never present: it can only ever prove what `insertContent` already proves in
  jsdom. Prefer the two routes above; if you use it, say in the assertion that it is synthetic.
- **A pasted screenshot inserts nothing and uploads nothing, and that is the shipped promise**
  („Paste and drag-and-drop are deliberately not wired", DECISIONS.md). Both flavours behave the
  same — `ClipboardItem({ 'image/png': blob })` through the real clipboard, and a `DataTransfer`
  holding a `File` — and neither produces a `POST /api/images`. Assert the request count beside the
  image count: „nothing was inserted" is also true of a paste that never arrived.
- **A *dropped* file is refused and the event says so, but only the pair proves it.**
  Dispatching `dragenter`/`dragover`/`drop` with a `DataTransfer` on `.rte-content` gives
  `dispatchEvent → true` (nobody called `preventDefault`) for a file and `false` for HTML
  ProseMirror handles — and a drop carrying our own `<img>` as `text/html` **is** inserted. So the
  control for „a dropped screenshot lands nothing" is a dropped reference landing something, in the
  same case; without it the assertion passes on a drop that never reached the editor at all. (This
  is not the internal ⠿ drag, which is documented above as not delivering a `drop` at all.)
- **The season pin is what finds the picture, and only a *fresh* token can show that.** An image
  POSTed into a fixture season answers **404** on `/api/images/<token>` and **200** on
  `/api/images/<token>?season=<id>`; a wrong season is 404 as well. The demo's own hall plan cannot
  test any of this — it exists in the demo season *and* in every copy, so a request with no pin
  resolves the registry default and finds it anyway. Upload one for the case.
- **Read the bytes back as pixels, not as a status code.** The served image is same-origin (Vite
  proxies `/api`), so a canvas drawn from it is not tainted: `img.decode()`, `drawImage`,
  `getImageData`. That is also the only way to see the **white fill** — JPEG has no alpha, so a
  transparent source must come back white and not black (CCL-10), and a 200 with the right byte
  count says nothing about it. Build the source file in the page as well
  (`canvas.toDataURL('image/png')` handed back to Node as a `Buffer`): no dependency, no binary in
  the repository, and the dimensions are whatever the case needs — 1400×900 makes the client's
  1200 px resize do something visible.
- **Drive „Bild einfügen" through the button and intercept the panel**, never by feeding the hidden
  `<input type="file">`: the button sets `pickingImage` *before* it opens the panel, which is what
  stops the editor's blur guard committing the note mid-insert (RTE-02), and going around it tests a
  path the user does not have. `page.waitForEvent('filechooser')` alongside the click, then
  `chooser.setFiles({ name, mimeType, buffer })`.
- **A conditional request needs `'cache-control': ''`** — the undici entry at the top of this file,
  and `/api/images/:token` is the route it was found on. Without it a 304 reads as a 200.
- **`.prose-md img` on an artist page is not the note's image.** Every project card renders its own
  description, so `#/artist/1` has four `<img>` page-wide where the note has two. The artist note is
  **not a section** either — it lives in the header `Card` (`ArtistPage.tsx`, „the one general
  free-text field lives inside the header"), so there is no `[data-section="notizen"]` and a
  selector built on one matches nothing. It is the *first* `.prose-md:not(.rte-content)` on the page.
- **„Bild nicht gefunden" latching onto the *next* note (IMG-05) is not reachable through a
  navigation.** The bug needs one `MdImage` instance to render two different notes, and every route
  change remounts the note — the fetch for the other row goes through a loading state, so the
  component the latch lives on is gone before the second note arrives. Measured against the reverted
  fix: a hash navigation from a note whose picture 404s to one whose picture is fine draws that
  picture perfectly, and a `reload()` even more so. What reproduces it every time is replacing the
  note **under** the component: patch the row out of band, then make the window refresh itself
  (`window.dispatchEvent(new Event('focus'))`) — react-query keeps the previous data during a
  background refetch, so nothing unmounts and `Markdown`'s `useMemo` hands the same instance a new
  `src`. Mind `staleTime: 5_000`: a focus sooner than that refetches nothing, which reads as „the
  latch is fixed".
- **Opening and saving a note rewrites a raw `<img>` into the Markdown spelling, and that is not a
  loss.** Measured on artist 1: `> <img src="…" alt="Saalplan aus dem Export" width="120"
  align="right">` comes back as `> ![Saalplan aus dem Export](…?w=120&a=right)` (and the quote line
  above it gains two trailing spaces). `check:markdown` guarantees **render**-equality, not
  byte-identity, and `rehypeImgQuery` turns the query back into `width`/`align` attributes — so the
  reader draws the identical picture, 120 px, floated right, still inside the quote. Assert the
  *picture list* across a save (`src`, `width`, `align`, computed `float`, „is it in a link", „is it
  in a quote"), never the stored string; a diff of the stored text reports „the editor rewrote my
  note" against working code. What must be asserted on the stored side is narrower and does hold
  byte-for-byte: the same tokens, the same number of them, and **no `?season=`**.

### Das Archiv (#113)

Two different mechanisms share `#/archiv`, and only one of them is this section's. The **age-based
task archive** is a task in the „erledigt" category whose `erledigt_am` has aged past
`ARCHIVE_AFTER_DAYS`: it leaves every live list and appears in the upper table. The **Papierkorb**
below it — soft-deleted records, their dependency counts, „Wiederherstellen" and „Endgültig
löschen" — is unrelated, and its traps are in „Playwright traps" and „Fixture facts" above.

- **The archived-task rows carry no `data-task-id`, and there is no `tbody[data-group-id]`.** The
  upper table is a plain `<table>` + `.map()` in `ArchivePage`, not `TaskTable`, so every handle
  from „Der Aufgabenbaum" matches nothing here — which reads as „the archive is empty". Address
  the rows as `table tbody tr` and their four cells by `td` index (Aufgabe · Zuordnung · Erledigt
  am · Kommentar). It is also the page's **only** `<table>`, which makes
  `document.querySelectorAll('table').length` the honest „is the list on screen" reading: the
  `EmptyState` replaces the whole table, so a filtered-to-nothing archive is 0 tables and not 0
  rows.
- **An archived row has no control at all** — no `<button>`, no `<input>`, no `div.cursor-text`,
  no `[contenteditable]` — so „it cannot be edited from here" also passes on a table that never
  rendered. Pair it; both pairs are within reach. The Papierkorb rows on the *same page* carry two
  buttons each, and a live done row on `#/project/1` carries eight plus a comment box. Assert the
  *behaviour* beside the markup: a click on the title and a double click on the Kommentar cell
  mount nothing, because a missing button is not a missing handler.
- **Three of the four cells are struck and the Zuordnung cell deliberately is not** (`ArchivePage`
  — it is where the row came from and how to get back to it). The grey it *does* inherit, its two
  links included, so „the Zuordnung cell is not treated as done" has to be read off
  `textDecorationLine`: `oklch(0.708 0 none)` is the colour of every cell in that row and says
  nothing about which of them is struck. One node is exempt from the grey by design and is worth
  knowing before writing an „everything is grey" assertion — a Markdown **link inside the
  Kommentar** keeps its sky palette, exactly as in the task table's done comment — but no demo
  fixture carries one, so there is nothing to measure it on today.
- **The Zitat inside an archived comment is the one node that paints a colour of its own**, exactly
  as in the task table: `.prose-md blockquote` sets `#6b7280` and `.prose-md--done` hands it back
  to the row. That makes the assertion self-pairing with no second fixture — the quote's computed
  colour must equal the row's **and** differ from `rgb(107, 114, 128)`, which is what it would be
  without the modifier.
- **The retention number in „Erledigte Aufgaben (älter als 30 Tage)" comes from the server**
  (`/api/settings.archive_after_days`, PGS-24), and so does the empty state's „… wandern 30 Tage
  nach Abschluss hierher". Build the expectation from that field: a hardcoded „30" passes against
  a build that has stopped reading it. Both headings are `<h2>` and CSS-uppercased, so take
  `textContent`; the page has exactly two of them and `h2.closest('.space-y-3')` is that heading's
  section, which is how the two „Keine Treffer." are told apart.
- **The search box narrows *both* lists (PGS-22)**, and „Keine Treffer." is a different empty state
  from „Noch nichts archiviert": a needle that matches only an archived task leaves the Papierkorb
  saying „Keine Treffer.", and one that matches only a trashed record does the same to the task
  table. The box is `input[placeholder="Archiv durchsuchen…"]`, with a real ellipsis.
- **To put a task at a chosen distance from the boundary, go through the undo door.** `erledigt_am`
  is server-derived and the only body that may set it is the pair `acceptsErledigtAm` takes:
  `PATCH /api/tasks/:id {status: <the done value>, erledigt_am: 'YYYY-MM-DD HH:MM:SS'}` (SDL-02).
  A lone `erledigt_am`, or one beside an *open* status, is dropped and the transform stamps today
  instead — which reads as „the archive query is broken". Compute the stamp from
  `/api/settings.archive_after_days`, never from a calendar date: two tasks ten minutes either side
  of `now − N days` land on opposite sides, which is also the proof that the cutoff is a timestamp
  and not a calendar day.
- **…and compute that stamp with `setDate`, never with `Date.now() - N * 86_400_000`.** The cutoff
  is `datetime('now', 'localtime', '-N days')` — *calendar-day* arithmetic on the naive local
  clock, i.e. the same wall-clock time N days ago — while a fixed span of milliseconds is an
  absolute one. The two agree only while no DST transition falls inside the window: for the ~30
  days after either change they differ by exactly **one hour**, which is six times the ±10-minute
  margin a boundary fixture wants to use. Measured against an in-memory SQLite at
  `TZ=Europe/Berlin`: in the autumn window the „ten minutes past the cutoff" task lands *inside*
  the live window and never archives, and the spring window reverses it — four `check:browser`
  assertions red against correct code, about two months a year. Nothing else catches it, either:
  CI runs in UTC, and `check:dates` deliberately picks two DST-free zones 25 h apart. Build it the
  way SQLite does, `const c = new Date(); c.setDate(c.getDate() - n)`, and apply the same rule to
  anything compared against `deleted_at`'s purge window.
- **The archive is the pair `(status = the done option) AND (erledigt_am <= cutoff)`, so moving the
  „erledigt" flag to another category empties it.** That is the only path in the UI that takes a
  task back *out* of the archive, and it is a definition change rather than a write: `erledigt_am`
  is untouched and the rows simply reappear in the live tables. The door is
  `#/einstellungen/aufgaben` → „Verwalten" → the Status row's ✎ — **not** the Kategorien tab, which
  holds the other three option lists (Termin-Typen, Projekt-Status, Link-Kategorien) and not this
  one. „erledigt" there is a **radio**, not a checkbox: picking one clears the others
  (`OptionsEditor.update`), so there is nothing to untick first. And „Spalten verwalten" stays open
  behind the editor after it saves — Escape it before navigating, or its backdrop eats the next
  click.
- **„Fortschritt" is the one number that must see past the edge (CCL-04)**, and the demo makes the
  difference visible: on a freshly seeded demo `scope: 'all'` is 8/51 where `scope: 'live'` is
  3/46, so the dashboard tile reads „8/51". A check that compares against only one of the two
  passes either way — assert the tile against `all` and assert in the same breath that the two
  really differ.
- **The global search is not scoped to the live window.** `/api/search` filters `deleted_at` and
  the live parents and nothing else, so an archived task is a hit (`gs-hit-t24` for „Probenraum
  gebucht"). Following it — like following the Archiv's own Zuordnung link — lands on the page the
  task belongs to, where the row is not in the table. Both are the behaviour as it stands, and
  worth knowing before reading either as a bug.
- **Neither print sheet can show the edge**: `PrintArtist` and `PrintProject` filter out *every*
  done task, so an archived one is missing there for a reason that has nothing to do with its age.
  The `.xlsx` export can — `ExcelButton` sends no `scope`, so the sheet is the live list — but
  reading one means unzipping a workbook, and `check:browser` does not.

### Die Spaltentypen (#114)

Four types reach `tasks.custom_values` — `text`, `date`, `checkbox`, `select` — and `CustomCell`
is four hardcoded branches, one input widget each. The seven built-ins are a fifth kind: they bind
to real `tasks` fields through `key`, and two of them take no input at all.

- **A fixture season's own label is in the header, inside a `<button>`.** The switcher chip reads
  „<Saison> ▾", so a page-wide `getByRole('button', { name: /Spalten/ })` on a window pinned to a
  season called „… Spaltentypen" matches **two** buttons and `.first()` is the chip — which opens
  the switcher menu, i.e. a `.fixed.inset-0` click-away layer that `topDialog()` then reports as
  the topmost dialog. Every assertion after that reads an empty dialog and the run looks like „the
  column manager never opens". Anchor the button („⚙ Spalten", not `/Spalten/`) *and* keep the
  word out of the fixture's label.
- **A `route` handler that is still sleeping when its `unroute` runs takes the whole run down.**
  `route.continue()` then rejects with „Route is already handled", and a route callback is not
  inside the driving script's `try` — so the rejection is an unhandled promise rejection that ends
  the process, and every case after it simply never runs. It is the one place in a driving script
  where the failure is worse than a red line: the run reports nothing at all. `await
  route.continue().catch(() => {})` in any handler that delays, and prefer letting the page close
  over unrouting mid-flight. (The entries above about *holding* a request are about opening the
  window; this is about closing it again.)
- **`td:nth-child(0)` matches every `td` of the row, not none.** Measured on Chromium 1234 through
  `document.querySelectorAll` as well as through Playwright. So a cell position computed from the
  header row — „the column is not on screen" → index 0 — silently addresses the first control in
  the row instead of nothing: a missing date column read back as the „Bestätigt" checkbox
  (`value: "on"`). Clamp a not-found index to something that cannot match (`nth-child(9999)`).
- **„+ Spalte hinzufügen" resets its form *after* the POST resolves, not before**, and the reset
  includes `setType('text')`. So a script that waits for the new column to appear in
  `GET /api/custom-columns` and then picks the next type has its `selectOption` overwritten a tick
  later — the second column is created as a Text column and every assertion about it is about the
  wrong type. Wait for the *form*: `getByPlaceholder('z. B. Verantwortlich')` back to `''`. Cost
  one wrong run here.
- **The name field is the only thing that refuses, and it refuses silently.** `AddColumnForm.add`
  starts with `if (!name.trim() ...) return`, so the button is not disabled, no message appears and
  nothing is created — unlike the option editors in Einstellungen, which go *stumpf* with an amber
  sentence beside the row (see „A settings editor refuses by going stumpf"). „Nothing happened"
  therefore has to be asserted as a beat plus a re-read, not as a wait for a message.
- **The Kategorien editor exists only while „Auswahl (farbig)" is picked, and picking it seeds two
  rows** („offen", „fertig", `SEED_OPTIONS`). Their mere presence is not the user's input — the
  dirty check compares against them — and `normalizeOptions` **keeps an existing `value`**, so
  renaming a seed row leaves a category labelled „Zuerst" whose stored value is still `offen`. To
  get label == value, remove the seed rows (one click per render, they are keyed by index) and add
  your own with „+ Kategorie".
- **A pill's background is a 150 ms transition, so the colour has to be polled for.** `PillSelect`
  paints the category's colour from an inline `style` on a button carrying Tailwind's `transition`,
  and it interpolates out of the grey placeholder (`#f1f5f9`) when a value is first picked —
  `reducedMotion: 'reduce'` touches animations, not transitions. Sampled on the *label* alone the
  reading was `rgb(254, 227, 227)` for a category configured as `#fee2e2`, which reads as „the pill
  paints the wrong colour". Put the expected colour in the poll's own predicate.
- **A custom „Auswahl" pill offers an empty option and the built-in Status pill does not.**
  `CustomCell` passes `allowEmpty`, so the menu's first `[role="option"]` carries `data-value=""`;
  Status's first is the first real category. „The menu lists the configured categories" is true of
  both, so it is the empty entry that tells the two branches apart.
- **The checkbox stores a real boolean and the other three store strings.** `commitCustom` sends
  `e.target.checked`, so the blob holds `{"14": true}`, while `customValueOf` stringifies on the
  way out and the cell tests `raw === 'true'`. A check written against `'true'` on the API side
  passes against a build that stores the string and fails against the one that ships.
- **Clearing a custom cell stores `''`; clearing the built-in Fällig stores `null`.** Both cells
  are the same `InlineInput`, with `empty: 'raw'` in `CustomCell` and `empty: 'clear'` in
  `DueCell` — so the custom column keeps its key in `custom_values` with an empty value while
  `tasks.due_date` really becomes `NULL`. The screen is identical („—" in both), which is why this
  has to be read off the API.
- **A half-typed date is `value === ''` with `validity.badInput === true`**, and it needs an
  **empty** date cell — typing a segment into a filled one replaces that segment and the value
  stays complete (WP-43, and the entry under „Playwright traps"). Enter then leaves the editor
  **open** and issues no request at all, and Escape throws the digits away. Assert `badInput`
  itself as the precondition: on a browser whose locale orders the segments differently, two typed
  digits may complete a segment set and the case would otherwise pass vacuously.
- **The two timestamp built-ins render a `<span>` and nothing else.** „Zuletzt bearbeitet" and
  „Erstellt am" are `TimestampCell`, so the cell holds no `<button>`, a click mounts no editor, and
  „this column refuses input" only means something next to a cell that accepts it — the custom
  text cell in the same row is the pair. („Erstellt am" ships hidden, so the reachable one is
  „Zuletzt bearbeitet".)
- **Two writes into two cells of one row need the row's own GET held back to prove anything.**
  `commitCustom` sends only the changed key and the server merges it (TTU-23); a version that sent
  the whole blob would rebuild it from the `task` captured at render time and silently undo the
  first write. Against localhost the refetch beats the second click, so both versions pass —
  `page.route('**/api/tasks*', …)` with a delay on `GET` opens the window (measured: PATCH 1 at
  +0 ms, its refetch issued at +11 ms and held, PATCH 2 at +61 ms).
- **A column created in the manager reaches the table while the dialog is still open** — the
  manager's `onAdded` is `useInvalidateAll` — so „the header appeared" is assertable without a
  reload, and a script that reloads first cannot tell that apart from a build that only picks the
  column up on the next load.
- **The same 👁 writes to two different stores, and which one depends on the list it sits in.** In
  „Globale Spalten" it is `toggleHere` → this page's `task_columns`; in the page's own scope group
  below it is `toggleEnabled` → `custom_columns.enabled`, the **season default**, and hiding there
  asks first („Spalte „…" ausblenden" / „Die vorhandenen Werte bleiben erhalten …"). Showing again
  never asks. So a case about the per-page map must use a *global* row, and one about the season
  default a *scoped* row; reading `enabled` after clicking the upper list (or `task_columns` after
  clicking the lower one) reports „the toggle does nothing".
- **Hiding the column a header click is sorting by is only reachable from a page's own scope
  group**, and that is what makes it drivable at all: the manager sits on the page, so the table
  stays mounted across the write. The override then stops ordering (WP-59 + TTU-18) *and* the ⠿
  goes back to being draggable — the handle's `title` is the handle: „Spaltensortierung aktiv — …"
  while an override is in force, the bare „Zum Verschieben ziehen" otherwise. Showing the column
  again brings the override back: it is suspended, not deleted.
- **A custom „Auswahl" column sorts by its *configured* category order, not alphabetically by the
  stored value** (TTU-19). Pick fixture values whose three candidate orders all differ, or the
  assertion passes on the defect: on demo project 2 the season default is `35 40 34`, and with
  „Vorbereitung"/„Durchführung"/„Nachbereitung" on tasks 34/40/35 the configured order is
  `34 40 35` while a string compare gives `40 35 34`.
- **Toggling three global columns in one burst is the case the per-page map exists to survive**
  (SHL-10): every write persists the whole map, so a toggle computed from the pre-first-toggle
  value silently undoes its predecessor. Hold the entity `PATCH` back
  (`page.route('**/api/projects/*', …)`) or the writes settle between the clicks and the burst is
  never exercised. The stored map is keyed by `colId` — `custom:8`, `custom:9`, `custom:10` for the
  demo's three global custom columns.
- **…and holding all three by the *same* amount does not make them arrive in that order.** Each
  `sleep(400)` runs in its own route callback; one stall of ≥400 ms leaves all three timers expired
  at once, so the three `route.continue()`s go out together on three sockets and nothing decides
  which the server applies last — and since each carries the whole map, the last one applied is the
  whole answer. Measured in WP-82 on demo project 2, releasing all three at one instant: **2 of 10
  runs ended with the server holding write 2's map** (`{custom:8,custom:9}` — one column visibly
  back on the page), and the response order was PATCH 1 → PATCH 3 → PATCH 2. That, not a stale
  client, is what made `main` red on 2026-08-27 with 2 of 646 (run `33049630974`): the page was
  rendering the server's real map, and the map was wrong. The client now sends the burst's writes
  one at a time (`lib/pending.ts`, `queueWrite`), so **only one `task_columns` `PATCH` is ever parked in a
  route handler** — `**/api/projects/*` still carries `useEntityLayout`'s layout writes, which are not
  queued — a repro that waits for a second one before releasing anything will hang.

### Die Startseite und ihr Konflikt (#111)

`#/` is the one page whose content lives **outside every season**: Notizen, Dokumente, the custom
Bereiche and the arrangement are one blob in `seasons.json`, reached through `GET`/`PATCH
/api/landing` and stamped with a generation (`landing.rev`, WP-53). The two *headings* above them
are not — they are `labels` in the window's own season `settings`, with a generation of their own
(`settings.rev`, WP-R5). So the same page can refuse a write for two different reasons.

- **Every fixture season is a card on this page.** The grid is the whole registry in registry
  order, so a case running late in `check:browser` finds a dozen `check:browser …` cards beside the
  demo's three. A count asserts nothing; anchor each card on its own `aria-label`
  (`Saison „<Label>“ öffnen` — German quotes, and the term is renameable) and assert the *order*
  against `GET /api/seasons` rather than against a literal list.
- **The landing content is cross-season, so a fixture season buys no isolation.** Pinning a window
  to a copy does not give the case its own Notizen or Dokumente, deleting the fixture seasons at
  the end does not clean them up, and two cases writing landing content share one blob. The only
  isolation there is is `check:browser` rebuilding `.demo` per run — which also means a case here
  must not assume the demo's three documents are still the whole list if an earlier case added one.
  Compute the expected list from `GET /api/landing`, never from `demo.ts`.
- **The demo has *no stored arrangement*: `landing.layout` is `[]`.** The page nonetheless renders
  five sections, because `LandingPage` falls back to `DEFAULT_LANDING_LAYOUT` (`saisons` full,
  `notizen` half, `dokumente` half) and `SectionArranger`'s merge appends the two custom sections —
  keys `lt1`, `lt2` — at the end, full-width. So „what is the arrangement" read off the API is `[]`
  while the page shows five `[data-section]` cells, and the first thing any arrangement write does
  is materialise the whole array.
- **`saisons` is mandatory and full-width-only on this page.** Its strip carries „Nach oben" /
  „Nach unten" and nothing else — no „Breite umschalten", no „Bereich entfernen" — because
  `LandingPage` passes `mandatoryKeys={['saisons']}` and `fullWidthKeys={['saisons']}`. A script
  that addresses „the first Breite umschalten" is therefore on `notizen`, not on the season grid.
- **A landing document with no URL is not a button.** `DocumentRow` renders the label as a
  `<button>` calling `openExternal` only when `url` is set; without one it is a `<span>` plus
  „(kein Link hinterlegt)". So `getByRole('button', { name: … })` matches two of the demo's three
  rows, and the third one's *absence* from that namespace is the assertion — not an extra class or
  a disabled attribute.
- **Never click such a label without the bridge stub.** With no `window.auftakt`, `openExternal`
  falls through to `window.open(url, '_blank')` — a real tab and a real request to whatever the row
  points at, from whoever runs the script. The gate's recording stub puts the URL in
  `window.__external` instead, which is also the only way to watch `normalizeUrl` run on the way
  *out* (CCL-09): a row stored as „example.org/x.pdf" must hand over „https://example.org/x.pdf",
  and every demo row already carries a scheme, so that half needs a fixture of its own.
- **Hold the conflicting write with a gate, not with a sleep.** The entry under „Playwright traps"
  says to route the `PATCH` rather than the `GET` — this is the other half: a fixed sleep is a
  guess in both directions, and the honest hold is a promise the driving script resolves once the
  *other* window's write is visible in `GET /api/landing`. Only the **first** attempt may be held;
  the retry has to run at full speed or the run pays the hold twice and the case reports a timeout
  for a mechanism that worked.
- **The retry's request body is the assertion; the eventual state is not.** „Both windows' rows are
  there" is equally true of a run where the timing slipped and no conflict ever happened. Read the
  bodies off `page.on('request')`: the first `PATCH` carries the generation both windows read, the
  second carries the winner's. And the two bodies tell the two kinds of landing write apart — for
  an **intent** (`[...now, added]`, a document) the second body differs, because it was recomputed
  over the winner's list; for the one **snapshot** write the landing has (`layout`, whose `fn`
  ignores `cur` on purpose) the two bodies are byte-identical and only the `rev` moves.
- **…which is also the promise worth gating.** A refused arrangement write is re-applied as
  last-writer-wins for the *arrangement* — but its patch names only `layout`, so a document the
  other window added in the meantime rides through untouched. That is WP-53's whole point, and
  before it the arrangement write carried a stale `documents` array with it (SHL-01).
- **Provoking three conflicts in a row needs the write stolen inside the route handler.** Firing a
  fixed number of writes from a second window cannot be lined up with the retries. Perform a real,
  unconditional `PATCH /api/landing` (no `rev` — the route writes it) from the driving script
  *before* each `route.continue()`, and every attempt is stale by construction while the 409 under
  test is still the server's own. Three attempts is the budget (`MAX_CONFLICT_ATTEMPTS`), so three
  steals exhaust it exactly.
- **An exhausted budget leaves the dialog open with the typed text still in it.**
  `RecordFormModal.submit` closes only when `useGuardedAction` returns true, so the user gets the
  toast „Speichern fehlgeschlagen. (Ein anderes Fenster hat inzwischen gespeichert.)" *and* a modal
  still on screen holding what they wrote. A script that waits for the dialog to go away hangs; the
  filled field is the evidence that nothing was lost.
- **A refused landing write snaps the row back, and only an *edit* shows it.** `landingUpdate`
  publishes optimistically before awaiting — but only when every row in the patch already has an
  id (`rowsAllHaveIds`), and a newly added document is id-less by construction. So „the optimistic
  value does not outlive a refused write" has to be driven by renaming an existing document, not by
  adding one.
- **The headings rename through the pencil's accessible name, and that name is the current text.**
  `getByRole('button', { name: '„Notizen“ umbenennen' })` — German quotes — becomes
  `'„Merkzettel“ umbenennen'` the moment the rename lands. The heading itself is CSS-uppercased, so
  `innerText` reads `NOTIZEN` and never matches the stored label; the `data-label` attribute
  (`landing.notizen`, `landing.dokumente`) is the stable handle for the pair.
- **A settings conflict needs both windows on the *same* season.** `labels` is a per-season setting,
  so two windows pinned to different seasons write two different files and never collide, however
  hard the case tries. The landing content behind them is shared all the same — which is the one
  page where those two rules disagree.
- **`EditableFallbackText`'s pencil is „Bearbeiten – leer lassen für automatischen Text"**, and
  clearing the field is a *reset* to the automatic line, not an empty override. On a season with no
  events that line is „Noch keine Termine"; on one whose file could not be read it is
  „Zeitraum nicht verfügbar", and while the stats are still loading it is „…" (PGS-17). All three
  are different states and collapsing them is the defect the three-way branch exists for.
- **„The server has it" is not „the gesture is finished", and on a slow machine the gap is
  seconds.** Every write on this page resolves only after a blanket `invalidate()` — and the
  surfaces that own the gesture close on *that* promise, not on the response:
  `RecordFormModal` closes when `useGuardedAction` returns, `InlineInput` calls `onDone` when the
  write resolves, and `guard`'s error toast is raised after the `finally` that awaits it.
  `invalidate()` refetches every active query of its page **and broadcasts**, so every other open
  window refetches too; a page on `#/` refetches `seasonStats`, which opens *every* season file.
  Measured with 24 throttled windows on `#/` and sixteen seasons: the server had the row after
  ~200 ms and the „Neues Dokument" dialog stayed up **20 s**; a heading rename's input stayed open
  **5.6 s** in one round and **59.7 s** in a harsher one. This is not a defect — the editor does
  close — but a driving script that proceeds when `GET` shows the value is then clicking into a
  backdrop and reading a heading whose text lives inside an open `<input>`.
- **…and that is exactly how a landing case passes forty times locally and fails on CI.** Two
  shapes, both seen on the runner: the arrange click lands on the still-open dialog's backdrop, so
  „anordnen" never turns on and the strip reads *empty* for every section (`saisons: keine`); and
  `[data-label]`'s `textContent` is `''` while its `InlineInput` is open, so „the heading shows the
  new name" polls a refetch storm and gives up (` / ABLAGE …`). **Wait for the surface to go away**
  — `gone(page.locator('.fixed.inset-0'))`, `gone(page.locator('[data-label] input'))` — and put
  that boolean in the assertion's *detail*, so a red line names the stage that failed instead of
  describing an empty strip. Waiting is the same rule the editor entries above already state
  („what really says the commit landed is the editor going away"); what is new is that the wait
  has to be generous, because its length is a property of how many windows are open, not of the
  page under test.
- **…and there is a third shape, in the log rather than on the screen: „the server has it" is not
  „this window's log has heard about it" (#166).** The two entries above are about a *surface* that
  has not caught up; this one is about the driver's own record. Every conflict case here reads a log
  fed by Playwright `request`/`response` **page events**, which reach the node process over the
  browser's CDP connection — and AQ and AR then proceed on `until(lpBlob, …)`, a **node-side
  `fetch`** (AS proceeds on `surfaceSettled`, which is page-observed and only *usually* enough; see
  the end of this entry). Two clocks, and the second one is not behind the first by any guaranteed
  amount: the write is stored the moment the server handles it, the
  driver hears about the answer one hop later. So a round in which both PATCHes went out with the
  right revs and the retry really was answered 200 is read as `beantwortet mit 409` — one status
  short, which reads like a *refused retry* and is really an unread one. Measured with 24 windows
  on `#/` under 8× CPU throttling: the answer arrives a median of 18 ms *before* the poll lets the
  case proceed, against 147 ms on an idle machine — the margin is one `until` sleep plus one
  `unroute` round trip, and it is nearly gone. At 30 windows and 20× it goes the other way (+179,
  +293, +480 ms) and **one round in six fails exactly as the `browser` job did** on 2026-08-26
  (#162), with no injection at all. Injected at the boundary — the response handler's push deferred
  150 ms, which is where the event reaches this process — 10 of 12 rounds are red, and 0 of 12 with
  the wait below, up to a 5 s deferral. **The recipe is to wait for the log you are about to read**,
  not only for the state that implies it: `lpAnswered(log, n)` in `cases/landing.mjs` is that wait
  (`until` over the log's own answer count, `SETTLED_MS`, so a round that really is answered once
  fails the assertion it was going to fail with the same detail, later). It is a plain
  synchronisation and not a recovery — nothing is retried and no gesture is repeated — so unlike
  `reloadedSurfaces` and `reopenedPopovers` it announces nothing. Two sibling logs elsewhere are sound, and
  for reasons that do not generalise: `images.mjs`'s `uploads` is read after polling
  `insertedImage`, which needs a whole further round trip after the POST it counts; and
  `reorder.mjs`'s `ldWrites` carries this exact anatomy — a count read straight after
  `until(ldBlob, …)` — but watches **`request`** events, emitted before the server even handles the
  write, and a lost one reads as `0 !== 1`, a false *red* rather than a false green. Neither is a
  rule. Wait on the log, and if you are counting `request` events instead, know that the failure
  direction is the only thing protecting you.
- **…and „let the answer land" is not a duration.** AR held a bare `await sleep(400)` at that
  site from the day it was written, which is the one thing `scripts/lib/wait.mjs`'s own header
  forbids. It looked unavoidable because the assertion around it is „three attempts and no fourth",
  and a negative cannot be waited for — but the two halves come apart: the fourth attempt is
  already ruled out by the *toast*, which `guard`'s catch raises after `retryOnConflict` has spent
  `MAX_CONFLICT_ATTEMPTS` and after `landingUpdate`'s `finally { await invalidate() }`, so once it
  is up no fourth PATCH can still be issued — and a request is logged when it goes out, not when it
  is answered. Only the third **answer** was ever in question, and that is a condition.
- **`check:browser`'s landing cases reload rather than fail when a surface will not settle — and
  „neu geladen" is a *passing* verdict.** `surfaceSettled` waits `EDITOR_GONE_MS` (20 s) for the
  dialog or the inline input to leave; past that it reloads the page and the assertion reads the
  same screen rendered from the same server. Two things follow, and both matter before trusting a
  green landing line or copying this as the house pattern. **Its „offen" verdict is nearly
  unreachable**: editing state is component-local `useState`, so a reload destroys it by
  definition — after the fallback the editor is gone because the document is new, not because the
  write finished, and „offen" therefore reports a *failed reload*, never the wedged editor it
  reads as guarding. And **on the reload path the case stops witnessing the broadcast**: the merge
  is proved to have reached a screen, but no longer to have reached it *without* a reload. So the
  fallback announces itself — a `⚠` line where it happens and a count on the summary line — and a
  run that reloaded its way to green must be read as a run with something wrong in it, not as a
  green run.
- **A window left open costs every later case — so the runner now closes them (#178).**
  `check-browser.mjs` closes every page still open on the context after each scenario file, because
  a broadcast fans out to all of them: measured at *twelve* live windows by the time `columns` ran,
  against the ~30 opened over a whole run. This is safe only because nothing a file opens crosses
  its boundary — `fixtures` hands on helpers and data, never pages, and `context.pages()` appears
  nowhere else in the gate — and it is the reason a later case's writes are fast enough to drive.
  If you add a file that *does* need a page from an earlier one, hand the page over explicitly and
  say so here first.
- **„The server has the burst" is not „the screen has it", and the gap is a whole rung.** WP-82 put
  `invalidate()` inside `queueWrite`'s closure, so a burst of writes to one key is published one at
  a time — hiding three columns walks the screen through 3 → 1 → 2 → 3 while the server goes
  straight to three. A poll that reads the *server* and then asserts on the *screen* is therefore
  reading a state that is one write behind, and it must (a) carry every term its assertion reads,
  not half of them, and (b) be budgeted at `SETTLED_MS` rather than at some smaller number that
  looked generous locally. Both AO polls in `cases/columns.mjs` were wrong on both counts and were
  two of this file's CI reds.
- **An unthrottled local run cannot reproduce any of this.** A developer machine wins the race
  every time; the lever is CDP `Emulation.setCPUThrottlingRate` at 6×, which is what turned a
  green local gate red on the first run. Measure a flake fix with it, before and after, and quote
  both rates — a gate that went green once has not been shown to be fixed.
- **A season's own `period`/`subtitle` beat the automatic line even when the automatic one exists.**
  The demo's 2027 season carries both overrides *and* the same event range as 2026, which is what
  makes „the override wins" discriminate — asserted against 2028 (no events at all) alone it also
  passes on a build that never reads the override.

## Print and PDF

- **`page.pdf()`'s default `printBackground: false` *is* the SHL-11 repro** — and a screenshot can
  never show that defect, because screenshots always paint backgrounds.
- **`print-color-adjust: exact` is scoped to `.print-page`**, not to the print block. Chromium's
  „Hintergrundgrafiken" is off by default in the browser *and* in Electron's `window.print()`.
- **`sips -s format png` renders only page 1** of a PDF on macOS (no poppler needed). Page-level
  *text* needs `pdfjs-dist`, which joins glyph runs **without spaces** — match paging assertions on
  whitespace-stripped text.
- **The project-code badge cannot tell the two states apart.** The sheet's header carries a
  `border-b-4` in the *same* accent colour, and a border prints under `economy` as happily as
  under `exact` — so that shade is in the PDF either way. Assert on a pure background instead: the
  status-group pills on the project sheet (`.print-group-head span`) and the `ProjectStatusPill`.
  Measured on `#/print/project/1`: 19 distinct fill colours with the fix, 18 without, and under
  `economy` Chromium also *darkens* light text (`161,161,161` → `171,171,171`), which is another
  reason not to key on a text colour.
- **…and the status pill paints the *same* shade as its group heading.** Both come from
  `DEFAULT_STATUS_OPTIONS`, so on a project whose status is „In Progress" — demo project 1 —
  `#dbeafe` is on the sheet twice, once in the header and once as the group heading, and a
  document-wide „is this colour in the PDF" is satisfied by the pill while the heading prints
  white on white. Print such a sheet from a **copied season with the project's `status` PATCHed to
  `null`**: each group colour is then painted exactly once, which pins the fill to the heading.
  `check:browser` does that rather than keying on the first group's colour, which is only
  accidentally unambiguous.
- **An embedded image is not `/Subtype /Image`** — that matches **4** times on a sheet with no
  picture at all, because Skia embeds colour emoji as bitmaps (📍 in the events, 🚐 in artist 1's
  note). Nor is it `DCTDecode`, which pins the assertion to the fixture happening to be a JPEG.
  What identifies the real one is its *stored size*, and Skia writes the keys newline-separated:
  `/Subtype /Image\n/Width 260\n/Height 173` — take the numbers from the DOM
  (`img.naturalWidth/naturalHeight`) and require a `/X<n> Do` in a page's content stream beside
  it, or the picture is embedded but never drawn. **And wait for the bytes before printing**:
  `img.complete && img.naturalWidth > 0`, since `printToPDF` will happily snapshot a layout whose
  image has not arrived, which is a failure that comes and goes with runner load.
- **No demo artist sets `artists.image`**, so `.print-page header img` on `#/print/artist/1` is
  *not* the avatar — it is the two pictures inside artist 1's note (WP-37: one in a Zitat, one
  wrapped in a link), which land inside `<header>` because `PrintHeader` renders the note as its
  children. A check written against „the avatar" passes while the avatar `<img>` is deleted.
- **`page.pdf()` prints Letter unless told otherwise.** The print block's numbers are A4's — „A4
  inside the 14 mm @page margins leaves ~269 mm" is what `.prose-md img`'s 240 mm cap is derived
  from — and the customer prints A4, so a paging assertion taken at the default measures a page
  nobody has. Pass `{ format: 'A4' }`.
- **Overriding a print rule at runtime is how a paper assertion proves it bites**, without
  touching the source: `page.addStyleTag({ content: '@media print { … !important }' })`, take a
  second `page.pdf()`, remove the tag. `!important` beats `index.css` on cascade rather than on
  order. `check:browser` does exactly this twice — `print-color-adjust: economy` must make the
  group pills vanish, `break-after: auto` must strand the group header — and without those
  controls both cases would also pass on a Chromium that prints everything anyway.
- **A Chromium PDF can be read with `node:zlib` alone; `pdfjs-dist` is only needed for *words*.**
  Skia writes plain PDF 1.4 — `n 0 obj` bodies, a classic xref table, no object streams — with
  FlateDecode content streams. Two traps in parsing one: slice a stream by its dictionary's own
  `/Length` (a compressed stream may well contain the bytes „endstream", and a regex that searches
  for it hands back a truncated stream that inflates to nothing), and take the page order from the
  `/Pages` node's `/Kids` array, never from the order the objects happen to be written in. What is
  readable that way: fill colours (`r g b rg`, so `.7255 .1098 .1098` is `rgb(185,28,28)` to within
  a unit) and paint order, which is DOM order — enough for „did this print" and „where on the page
  did it land". Text is hex glyph ids against a subset font, and how many glyphs one `Tj` holds is
  a property of the font, so a `Tj` count is only ever comparable against another measurement of
  the *same* document.
- **Neither sheet prints a done task**, so WP-58's strike is not assertable on paper at all —
  `PrintArtist` and `PrintProject` both filter on the Status column's done value and say so in the
  heading. That heading is CSS-uppercased like every other one („AUFGABEN (1 OFFEN)"), so match it
  case-insensitively.
- The demo's project sheet only crosses a page boundary at a group header with a tuned fixture
  (55 „new" + 6 „active" tasks); neighbouring counts silently miss it. A sheet built from a
  **fresh** season — no description, no contacts, no events, and therefore no custom columns and
  no `thead` — needs **56 + 6**, which is the fixture `check:browser` builds over the API. The
  window is one row wide in both directions: at 55 the rule changes nothing, at 57 the header
  crosses on its own. What makes such a count survive a runner with other fonts is that every line
  height on the sheet is an explicit Tailwind value, so the page a row lands on is not a font
  metric — keep anything that could *wrap* out of the fixture and it stays reproducible. A search
  around the tuned length must go **both ways** (56, 57, 55, 58, …): a boundary can drift down as
  easily as up, and a search that only grows the list reports „no effect at any length" on a
  perfectly good build, which reads exactly like the regression it guards.
- **A sheet reached by `pin()` is not a sheet a customer ever reached.** Every print assertion here
  used to open `#/print/…` directly and read the bytes, and that is how the sheet stayed a *dead
  end* for two releases: the routes sit outside `Layout`, so there is no header, no Breadcrumbs and
  no season switcher on them, and the packaged app has no browser chrome and no „Zurück" in its
  menu either — the customer could leave the Ein-Pager only by quitting Auftakt (WP-71). Drive the
  whole walk at least once: click „🖨 Ein-Pager (PDF)" on `#/project/1`, then the sheet's own
  „Zurück", and assert the **URL on the other side** — the origin page, `#/project/1`, never
  `#/`. The error sheet (`PrintFallback`) is the one that goes to the start page, deliberately, and
  it is a different component.
- **A control on the sheet cannot be found in the PDF by its own colour.** The save button is
  `bg-neutral-900` and the sheet's body text is `text-neutral-900`, so „is this shade in the bytes"
  is answered by every line of the handout. Mark it instead — set an inline `color` nothing else
  paints (`rgb(1, 254, 3)`) and look for that one fill. It has to go on the `<a>` and the `<button>`
  **themselves**: both carry a `text-*` class, so a colour set on the row they share is inherited
  by neither. The control for that assertion is `@media print { .no-print { display: flex
  !important } }`, the same runtime override the two cases above use.
- **„Als PDF speichern" is a bridge call now, and a real `window.print()` leaves nothing to read.**
  Since WP-71 the button is `window.auftakt.savePdf(title)` under Electron (main renders the window
  with `webContents.printToPDF` into a file its save dialog names) and `window.print()` only in the
  browser, where there is no bridge. Headless Chromium's `print()` is a silent no-op, so „did it
  open the printer dialog" cannot be observed — override it in an init script
  (`window.print = () => { window.__printed++ }`) and assert the **pair**: the bridge recorder holds
  the title *and* `__printed` is still 0. Either half alone passes on a build that does both, which
  is the defect (a Windows printer list behind a button that says „Als PDF speichern").
- **Electron's `printToPDF` and Playwright's `page.pdf()` are the same Blink path**, so everything
  the bullets above read out of the gate's bytes is also true of the file the customer saves — with
  three deliberate options on the app's side: `pageSize: 'A4'` (this API defaults to **Letter**),
  `printBackground` left at `false` (`print-color-adjust: exact` on `.print-page` is what carries
  the sheet's colours; turning it on would lay the page background down as a sheet of ink), and no
  `margins` at all, because `@page { margin: 14mm }` owns them — Electron's own note that „the
  `landscape` will be ignored if the `@page` CSS at-rule is used" is the same rule seen from the
  other side. What no headless run can reach is the save dialog itself: that one is
  `docs/BACKUP-TESTING.md`'s kind of pass, on a packaged build.

## Native modules in the packaged app

- **`npm run check` never exercises Electron's ABI** — it runs under plain Node, and
  `check:package` only asserts the `.node` is *present*. Neither would notice a binary that cannot
  load in the app.
- **Run the built app's own Electron binary as Node to close that gap**, without opening a window:

  ```sh
  ELECTRON_RUN_AS_NODE=1 release/mac-arm64/Auftakt.app/Contents/MacOS/Auftakt -e "…"
  ```

  Point it at the *unpacked* copy (`Contents/Resources/app.asar.unpacked/node_modules/…`) and do a
  real `prepare`/`exec` round-trip, not just a `require`.
- **better-sqlite3 has been N-API since v13**, so `@electron/rebuild` no longer writes a
  `build/Release` — the shipped `prebuilds/<platform>-<arch>.node` *is* what loads. `electron-builder.yml`
  excludes the other seven; if that exclude ever over-matches, the app dies at the first query.

## Fixture facts about the demo

- **Only two contact lists are *interleaved*, and those two are the reorder fixtures**: project 1
  („NQ1 · Eröffnungskonzert") has three contacts and artist 1 („Nordlicht Quartett") has two, and
  their `sort_order` values run through each other (0, 6, 7 and 1, 8), which is the case a reorder
  must not disturb. Artist 3 deliberately keeps its single contact — the dependent-count fixture
  below leans on it. Since WP-78 there are two *long* lists as well (project 10 has 18 rows, project
  11 has 8), but those are contiguous and say nothing about the interleave; drive a reorder
  assertion on project 1 or artist 1.
- **The record delete (WP-34) is inside „✎ Bearbeiten", not on the page header** — „Löschen" in the
  dialog footer, then a nested confirm, then „In den Papierkorb". A script looking for a 🗑 next to
  the print link finds nothing, against working code. Useful fixtures: project 2 („NQ2 ·
  Schulworkshop") has exactly 3 tasks and nothing else, so its confirm reads „3 Aufgaben"; artist 3
  („Kollektiv Halbton") reaches 2 projects, 1 contact, 14 tasks and 1 event, which is the case that
  proves the count walks *through* projects rather than stopping at them.
- **What that confirm actually says has changed, and the old sentences are gone.** It reads
  „<Name>“ in den Papierkorb legen?", then „Mit dabei: 3 Aufgaben." (`cascadeText`, German list
  punctuation — the last separator is „und", never a comma), then „Alles wiederherstellbar im
  Archiv unter „Gelöschte Einträge“." „Gelöscht wird nur dieser Eintrag" and „verschwinden damit
  aus allen Listen" were deliberately removed (they explained soft delete, which the user never
  asked about) — a script keyed on either waits for markup that is no longer there.
  The count is also **fetched when the confirm opens**, so „Wird geprüft, was mitgeht …" is what
  is on screen first; read the dialog straight after its heading and the assertion lands on the
  pending state.

- **The default `task_sort` is `[status]`, and a rule for a hidden column is inert.** A season
  created before WP-32 still *stores* `[status, priority, due]` and behaves identically — the
  columns ship `enabled: 0`, so `activeSortRules` drops those rules; there is no migration. A repro
  that needs a priority rule must **show the column first**
  (`PATCH /api/custom-columns/<id> {"enabled":1}`), or the rule does nothing and the check passes
  against a defect. A „keine Regel" repro still needs `PATCH /api/settings {"task_sort": []}`.
- **The demo *shows* Fällig, and has a custom date column „Abgabe" (WP-43).** Both exist so the
  two date cells can be typed into at all; the demo's stored `task_sort` is `[status]`, so neither
  orders anything. Task 5 („Bühnenplan an Technik schicken") carries a Fällig date, an Abgabe date
  and a comment — the one row that exercises every editable cell — and task 2 has neither date,
  which is the empty cell a half-typed-date repro needs.
- **The done row with every cell filled is task 29 („Programmtext eingereicht") on `#/project/7`**
  (WP-58) — status and Priorität pills, a Fällig date, a Markdown comment, both timestamps, the
  „Bereich" pill, the „Bestätigt" checkbox and the „Abgabe" date. Its sibling task 28 is the done
  row with *empty* date cells, i.e. the „—" placeholders that must stay unstruck, and task 30 is
  the open control. **Priorität still ships hidden**, so anything about that column has to enable
  it first (`PATCH /api/custom-columns/<id> {"enabled":1}`) and `reload()`. In „Archiv", task 25
  („Technikrider geprüft") is the one archived row carrying a comment.
- **The coloured-text pair is tasks 29 and 30 on `#/project/7`** (WP-62): both comments carry a
  `<span class="tc-rot">` run, task 29 done and task 30 open. The done one has to take the row's
  grey and the open one has to stay red, and the *pair* is the assertion — on the done row alone,
  „grey wins" also passes on a build that never paints the colour at all. The demo's
  document-sized colour is project 1's description (a `tc-gruen` list item, and a
  `**<u><span class="tc-rot">…</span></u>**` run in the „Technik" paragraph, i.e. the nesting order
  the serializer produces); that description is also what the project print sheet renders, so it is
  the fixture for „what does paper do with it". A short, plain note to colour and un-colour without
  disturbing anything is project 2's description („Vormittagsformat für zwei Schulklassen.").
- **Exactly one demo column is scoped to a page: „Freigabe" on artist 1** (Nordlicht Quartett,
  WP-51), with values on that artist's own tasks 16 and 51. It is the fixture for „a scope's
  columns stay on its own page" — it must be absent from every project page, from the Übersicht
  and from every other artist.
- **Three of the four custom column *types* have a demo fixture and `text` has none.** „Bereich"
  (select, id 8), „Bestätigt" (checkbox, 9) and „Abgabe" (date, 10) are the global customs, and
  „Freigabe" (select, 11) is the scoped one — so `CustomCell`'s fallthrough branch, the one every
  unrecognised type also lands in, is reachable on the demo only by creating a column. `#/project/2`
  („NQ2 · Schulworkshop") is where to do it: three tasks (34 „Schulen kontaktieren" with a Fällig
  date, 35 and 40 without), none done, none a subtask, and `custom_values` empty on all three — so
  nothing a poll waits for can be satisfied by a value that was already there. Under the season
  default the three render in the order **35 40 34**.
- **Two demo pages depart from the season's column set, one per direction (WP-59).**
  `#/project/4` („AB2 · Radio-Session") stores `{"due":false}` and is the only project **without**
  Fällig — every other project has it, which is the customer's own example and the pair to compare;
  `#/artist/4` („Jonas Wehrmann") stores `{"priority":true}` and is the one page that **shows**
  Priorität, which ships hidden everywhere else. Both shift the `td` indices on *those two pages
  only* (project 4 loses one column, artist 4 gains one), so the documented „Fällig is td 3,
  Abgabe 8" holds everywhere else and nowhere there. Everything else is `NULL` and follows the
  default — assert a „follows the season default" case against project 1 or artist 1, never
  against these two.
- **A newly created task carries a *negative* `sort_order`** — the transform stamps it one below
  its list's minimum so it lands on top. Assert relative order, never a literal ordinal, and expect
  the newest row first in any list nothing has been dragged in.
- **Under the default `[status]`, any two open rows of the same status are draggable.** The tuned
  same-rank block in `demo.ts` (tasks 41–45) is no longer the only place a drop is accepted; task 45
  is the odd rank there, and it is odd by *status* now, not by priority. The whole block sits on
  `#/project/5`, with tasks 46–48 as task 41's children — which makes that one page the place to
  drive all three of the task table's rules: a drop between 41–44 is accepted, one on 45 is refused
  by rank, and one from 46 onto 42 is refused by the *parent* although both are of equal rank.
- **The orphan is not an orphan in a copied season.** `copySeasonData` re-roots a subtask whose
  parent stayed behind (`parent_id = null`, db.ts), so in any fixture copy the demo's task 12 is an
  ordinary top-level row and TTU-14 has nothing to stand on. Build one instead: `POST` a task,
  `POST` a child naming it, then `DELETE` the parent — the route stamps **one** row, so the child
  stays live under a trashed parent, which is that state exactly. Give the child the status of the
  row it is going to be dropped on: `canDrop` tests the effective parent *first* and the rank
  second, so a child of another status is refused for the wrong reason and the case would prove
  nothing about the promotion.
- **Every demo artist has exactly two live projects, artist 5 (WP-78) included.** So a project-card
  reorder there can be
  driven but not *asserted*: „and the other cards kept their relative order" is a statement about a
  list of one. Add a third card over the API (`POST /api/projects`) before opening the page — it
  arrives with `sort_order: 0`, i.e. tied with the first, so read the starting order off the DOM
  rather than assuming it. Project `sort_order` is seeded globally (project 1 → 0, project 3 → 2),
  so the values interleave across artists and „the other artist's cards are untouched" is a real
  check.
- **The season cards are the registry array itself.** `POST /api/seasons/reorder` rewrites
  `reg.seasons` — there is no column and no per-season database involved — so the assertion is
  `GET /api/seasons`, and the window must **not** have switched season over it (the pin and
  `activeId` are the pair to read). The card's ⠿ sits *outside* its `role="button"`, so the
  wrapper is the handle's container:
  `[data-section="saisons"] div.group.relative:has([aria-label$="„<Label>“ öffnen"])`.
- **The arranger is the one reorderer that does not arm.** It runs `useDragReorder` in the default
  `mode: 'always'`, so while „Bereiche bearbeiten" is on, every `[data-section]` carries
  `draggable="true"` and the ⠿ in the strip is an affordance rather than the trigger — pressing it
  and travelling still works, which is what keeps one drag recipe for all eight surfaces. Outside
  the mode nothing is draggable at all (`enabled: arranging`), which is *this* surface's canary
  where `handleProps` is every other one's. The strip is `[aria-label="Nach oben"]`'s parent row,
  and its handle carries `opacity-100` as a class of its own — **which a substring test cannot
  see**: `DragHandle`'s base list carries `group-hover:opacity-100` on *every* live handle in the
  app, so `className.includes('opacity-100')` is true of the hover-only state too and stays green
  when the arranger's override is taken away. Match the whole token
  (`/(^|\s)opacity-100(\s|$)/`), or read the computed opacity with the pointer parked off the
  strip.
- **The fixed anchor's neighbouring gaps are illegal drops, on the two pages that have one.**
  `toolbarAfterKey` is `artists` on the Übersicht and `saisons` on the landing page, and `canDrop`
  refuses any pairing that names it — so the anchor cannot be carried anywhere *and* nothing can be
  dropped on it, which is the drag twin of the two disabled ▲▼ (SHL-17). The honest handle for
  „which section is the anchor" is the toolbar itself: „✓ Fertig" sits in the grid as a cell of its
  own, and the anchor is the cell before it. An artist or project page passes no `toolbarAfterKey`
  at all, so every pairing there is legal.
- **The subtask trees, and which one answers which question.** The showcase is task 1
  („Instrumente – Anmietung und Transport", `#/project/1`): three *live* children — 2, 3 (coloured)
  and 4 (done three days ago, so still in the live list) — which is why its counter reads **„1/3"**,
  plus an **archived** fourth (task 53, done past `ARCHIVE_AFTER_DAYS`) that the table does not
  render. That gap is the fixture: its delete dialog says „4 Unteraufgaben" over a group of three,
  which is TTU-05 asserted rather than argued, and both numbers change together if a child is added
  here. Task 31 (`#/project/8`) is the childless row to grow a *first* subtask on — a leaf with no
  chevron and no counter until then — and task 32 beside it already has one (33), which is the
  folded-parent case. Task 12 („Verwaiste Unteraufgabe", `#/project/5`) is the orphan: its parent
  (task 11) is soft-deleted, so it renders at depth 0 with no connector while `parent_id` still
  says 11, and the pair survives every purge (SDL-01) — the Papierkorb row for the parent says so,
  „bleibt, bis abhängige Einträge entfernt sind". The **widest** tree is task 100 („Bühnenaufbau
  planen", `#/project/10`) with six live children, which is the field's maximum and the one to use
  for anything about the counter pill's width, the connectors or a fold at real depth; its counter
  reads „2/6".
- **Five archived tasks, one per shape of Zuordnung.** `demo.ts` stamps them at
  `ARCHIVED = -(ARCHIVE_AFTER_DAYS + 15)` and later, so they are always comfortably past the cutoff
  and no case ever needs an absolute date. **24** („Probenraum gebucht") and **53** („Angebot
  Backline eingeholt") sit on project 1 — 53 is task 1's fourth child, the one the tree never
  renders (above) — **25** („Technikrider geprüft") on project 3 is the only archived row with a
  comment and carries the only Zitat in the Archiv, **26** („Vorvertrag unterschrieben") hangs off
  artist 3 with no project, so its Zuordnung cell is an artist link alone, and **27**
  („Save-the-Date verschickt") is season-wide, so that cell is **empty**. The pair that makes the
  boundary visible without naming a date is **4 against 53**: both are done children of task 1, 4
  finished three days ago and is rendered, 53 finished past the cutoff and is not.
- **The dashboard's „Nächste Termine" has three blocks, and which one a row is in is the
  assertion**: event 8 under „Datum offen", then 2/5/1/10/11 inside the 14 days, then 4/3/7 under
  „Danach". Event 10 is the one to check after touching the split: it starts at 23:00 on day 14
  and ends at 01:00 on day 15, and it belongs to the *near* block, because a row is bucketed by
  its **start** day. All three blocks cap at 8 rows, but **none of them collapses on the demo** —
  the largest holds five — so „+ N weitere anzeigen" is not reachable here without POSTing more
  events first. Event 6 is nine days past and event 9 is soft-deleted; **both must be
  absent**, and either one appearing is a real bug, not a fixture quirk. Assert on block
  membership, not on a total — the event fixtures grow. And every offset is relative to the
  **seed day**, so a `.demo` built days ago drifts rows across the window boundary; rebuild with
  `npm run demo` first. Event 11 („Team-Sitzung Saisonplanung") is season-level (WP-47): its
  roll-up row links to `#/dashboard`, not to an artist or project page — a `/artist/null` href
  there is the regression WP-48 fixed, not a fixture quirk.
- **The project and artist pages ship `defaultHidden={['stats', …]}`**, so the „Fortschritt" tile
  is *not on screen* until a layout that names it is written. The dashboard's is.
- **Artists 2 and 5 and projects 3 and 10 ship their own `layout`; artists 1/3/4 and every other
  project are `NULL`** and follow the `artist_layout`/`project_layout` template (WP-25). So the two
  states are both on the demo — and a check that arranges one artist must assert against a
  *different* one, because asserting against artist 2 proves nothing. Artist 2 also un-hides
  `stats` **and tombstones `aufmerksamkeit`** (`hidden: true`, WP-45) — so its „+ Bereich" picker
  starts with „Braucht Aufmerksamkeit" on offer, and `aufmerksamkeit` is *not* in its
  `[data-section]` list. Artist 5 and project 10 are WP-78's, and they are about *length* rather
  than about a branch — see „field sizes" below.
- **The project split (WP-48) is in three states on the demo, and both broken ones are real.**
  Projects with `layout: NULL` render `kontakte` and `links` as separate half sections side by side
  (spec order) — the healthy state. Project 3's stored layout predates the split and has **no
  `links` entry at all**, so the merge appends it **last** in its `[data-section]` list at
  `data-width="half"` on every load and nothing is written down; that is the state 2 of the
  customer's 17 pages are in. Project 10's layout (WP-78) has `links` **stored last**, as the merge
  left it and the next arranger touch froze it; that is the state the other 6 are in, and the
  difference between the two is only visible in the database (`GET /api/projects/10` vs `/3`). A
  check that the two sections act independently (🗑 one, keep the other) belongs on a `NULL`-layout
  project, not on either of these. All three states — plus the artist-page pair, artist 1 against
  artist 5 — are pinned since WP-78a by `check:browser`'s **AX**, which reads them and writes
  nothing; that case is the net for the day the merge is ever taught to insert `links` beside
  `kontakte` instead of appending it.
- **One arranger touch writes the whole merged array down, tombstones included** — which is how a
  page in the first state becomes a page in the second, and it takes one ▲. `move()` persists
  `full`, not the entries the stored layout already had, so a single press on „Kontakte" turns
  project 3's three stored entries into six: the two reordered ones, the appended `links`, and
  `stats`/`aufmerksamkeit` as `hidden: true`. The user touched exactly one of the six. Drive it on
  a *copy*, never on the demo's own project 3 — that row is the fixture the readings above depend
  on. The strip's ▲ is `[aria-label="Nach oben"]` and it is disabled at index 0, so pick a section
  that is not first; on the project page there is no toolbar anchor to work around (only the
  Übersicht passes `toolbarAfterKey`, see AW).
- **The demo seeds `dashboard_layout` with the season sections opted in** — `termine` full-width
  after the roll-up, `kontakte`+`links` as a half pair. On any *non-demo* database all three ship
  `defaultHidden`: not in `[data-section]`, only in the „+ Bereich" picker. To drive the
  picker-restore path on the demo, blank the layout first
  (`PATCH /api/settings {"dashboard_layout": []}` — a real JSON array; a string is a 400,
  „muss eine Liste sein") and reload; the three then start hidden like everywhere else. **Or seed
  that state instead of patching it: `AUFTAKT_DEMO_FRESH=1 npm run demo`** builds the same
  fixtures without `dashboard_layout` *and* without `artist_layout_saved` (#70) — the seeder
  prints „Erstlauf-Modus" when it took that branch, and no other row differs.
  „Saison-Termine" (`termine`, editable) and
  „Nächste Termine" (`events`, read-only roll-up) are different sections — asserting a created
  event into the roll-up or a roll-up row into the editable list fails against working code.
- **A season contact's GlobalSearch hit navigates to `#/dashboard`** („Greta Simoneit" on the
  demo) — asserting an artist or project URL there fails against working code (WP-47 rows have
  no parent to land on).
- **The landing page's three seasons are a three-way fixture, and 2027 is the one that
  discriminates.** „Demofest 2026" is active and populated; **„Demofest 2027"** was copied from it
  *without tasks*, so it shows the same 4 Künstler and 8 Projekte with **0 Offene Aufgaben**, and it
  is the only card carrying an override for both editable lines — subtitle „Planung startet im
  Herbst" and Zeitraum „Juni – Juli 2027" — although its copied events give it exactly 2026's
  automatic range; **„Demofest 2028 (in Planung)"** is empty, so it is 0/0/0 with the
  „Noch keine Termine" fallback. The other two show the „Angelegt am <Datum>" subtitle fallback.
- **The landing blob itself: three Dokumente, two Bereiche, one Notiz, no layout.** `demo.ts` calls
  `patchLanding` once, so the content is generation **1** and `layout` is `[]`. The documents are
  „Fördervertrag Stadt (PDF)" and „Vorlage Künstlervertrag" with URLs plus **„Altes
  Sponsoring-Konzept" with `url: null`** — the „(kein Link hinterlegt)" branch. The two custom
  sections are „Ideen für 2027" (a Textfeld, `lt1`) and „Verträge 2027" (a Dokumente list, `lt2`)
  whose two rows live inside the section, *not* in `landing.documents` — two rows so the
  within-section drag has somewhere to go (WP-50). The Notiz carries a `**bold**` run, an emoji and
  a Markdown link, so „the note is rendered, not printed as source" is assertable on it.
- **A layout assertion reads `[data-section]`/`[data-width]`, not the headings** — the arranger
  stamps both on every rendered section, and in arrange mode the in-card heading is hidden anyway.
- **The demo seeds `artist_layout_saved` but leaves `artist_layout` unset** (both unset under
  `AUFTAKT_DEMO_FRESH`), so „Gespeichertes Layout anwenden" is live from the first run while
  „Auf Standard zurücksetzen" starts disabled.
  The two are separate stores — asserting one after writing the other is how you prove the split.
- **The layout menu is a portal at `[role="menu"]`, not a child of the toolbar.** Its rows are
  `[role="menuitem"]`; the heading and status line are its first two `div`s. It closes on Escape
  (capture-phase, from `useAnchoredPopover`) and on a click on the `.fixed.inset-0` backdrop.
- **`Layout · Künstler` is composed from a renameable label** (`dash.artists`, the Übersicht's
  section title — it was `artist.kicker` until the two ids were joined). A check that the
  heading is right should rename it via `PATCH /api/settings {"labels":[…]}` and reload — that is
  the case the non-fused wording exists for, and a hardcoded assertion passes against both.
- **The artist page's kicker has no `[data-label]` and no ✎.** It renders `dash.artists` as plain
  text, so `[data-label="dash.artists"]` matches on the Übersicht only, and a script that hovers the
  kicker waiting for a pencil waits for ever. Rename it on the Übersicht, or by `PATCH`.
- **An *empty* custom widget's 🗑 deletes straight away** — `nonEmptyKeys` is what routes it to the
  „Bereich löschen" dialog, so a script that waits for „In den Papierkorb" after binning a fresh
  widget times out against working code.
- **Project 1's notes contain a Markdown table**, so `thead` first matches *that*, not the task
  table. Project 1 also shares its name with its opening concert, so a text match there hits the
  page heading rather than the event row.
- **An icon button has no text at all — select it by `title`, never by its symbol.** Since WP-38
  every symbol that is a button's whole face is an `<svg aria-hidden>` from `icons.tsx`, so
  `getByText('✎')`, `:has-text("▲")` and `innerText()` assertions match nothing. `title` and
  `aria-label` are identical on these buttons and both survive, so `[title="Bearbeiten"]` and
  `getByRole('button', { name: 'Nach oben' })` are the stable handles. The glyphs that *do* still
  render sit beside a word — „⚙ Spalten", „🖨 Ein-Pager (PDF)", „✎ Bearbeiten" — so a text match
  there hits the label, not the symbol.
- **The rich-text toolbar does not exist until a note is being edited.** `InlineNotes` renders the
  *reading* view — a `.cursor-text` div, or a „+ hinzufügen" button when the note is empty — and
  only mounts `RichTextEditor` on click. A script that opens a page and looks for „Zitat" or the
  emoji button waits 30 s for markup that was never there. Click the note first, then wait for
  `.rte-content.ProseMirror-focused`.
- **The emoji picker's search box is not `type="search"`.** `emoji-picker-react` renders a plain
  `<input type="text">` under `.epr-search-container` with hashed class names, so the obvious
  `input[type="search"]` selector matches nothing and looks like the picker failed to open. Its
  placeholder is „Suchen" (we pass it; `emojiData` does not localize chrome). Results carry
  `[data-unified="<codepoint>"]` — `1f3b5` is 🎵, `1f3b8` is 🎸 — and appear in both the suggested
  strip and the list, so *count > 0*, never an exact count. Typing needs ~500 ms before the list
  settles.
- **`getByRole('button', { name: 'Einfügen' })` is ambiguous in the rich-text editor** — it hits
  the toolbar's „Tabelle einfügen" (via its `aria-label`) as well as the link bar's „Einfügen".
  Use `{ exact: true }`. Every toolbar button carries `title` *and* `aria-label`, so accessible
  names there are substrings of one another far more often than the markup suggests.
- **`aria-pressed` exists only on the toolbar buttons that *have* a state.** `Btn` renders
  `aria-pressed={on}`, and `on` is simply not passed for „Einrücken", „Ausrücken",
  „Tabelle einfügen" and „Bild einfügen" — React then omits the attribute, so
  `getAttribute('aria-pressed')` is `null` there. A check written as „not pressed" (`!== 'true'`)
  is therefore satisfied by a button that can never be pressed at all, and by a typo in the
  selector. Read it only on B/I/U, the two lists, „Überschrift 1/2/3", „Zitat", „Link …",
  „Schriftfarbe" and „Emoji" —
  and assert **both** sides, `'false'` before the click and `'true'` after: the attribute is the
  only thing that distinguishes „the toolbar noticed" from „the toolbar drew a dark button".
- **The rich-text toolbar is not the same on every field.** `RichTextEditor`'s `compact` trims it
  to B/I/U, Schriftfarbe, bullet, link and emoji — headings, ordered list, quote and the table
  button are simply absent. Only the contact-row note and the task-comment cell are compact;
  asserting on „Tabelle einfügen" anywhere else is fine, asserting on it there will always fail.
- **„Schriftfarbe" is the one popover that is *not* portalled** (WP-62). It lives inside the
  editor's own root, because the editor commits and unmounts the note when focus or a click lands
  outside it (RTE-02) — so `document.body`'s end is the one place its menu must not be. Handles:
  the trigger is `[title^="Schriftfarbe"]` — anchor it that way, the tooltip carries the platform's
  own spelling of the shortcut („⌘⇧F" on macOS, „Strg+Umschalt+F" on Windows) — the menu is
  `[role="dialog"][aria-label="Schriftfarbe"]`, its eight swatches are `[data-roving]` buttons
  whose accessible name is the German colour („Rot", „Blau", …), and „Standard" removes the colour.
  There is **no backdrop**, deliberately: a click outside closes the
  menu *and* does what it was aimed at, so a script must not wait for a `.fixed.inset-0` to appear
  or expect one to swallow its next click.
- **A swatch carries no text since WP-74 — its face is a filled chip.** The button holds one
  `aria-hidden` `<span>` painted `background: currentColor` under the button's own `tc-…` class, so
  `innerText`, `getByText('A')` and „does the swatch show the colour" read off the **child's
  `backgroundColor`** — not off the button's `color`, which also computes to the palette hex but
  would pass even against a build with no chip at all. It was a 13 px letter „A" until then, and
  the reason it is not any more is the entry below.
- **„Only six of the eight colours are visible" was never geometry — and the arithmetic says it
  cannot be** (WP-74). Reported from a customer's 1536×767 at 125 %, i.e. ~1229×614 DIP. Driven at
  exactly that shape, at four anchors — the project note, a task comment cell low in the table, the
  same note after scrolling, and the Termin dialog's Notizen with only 173 px of room below the
  trigger — the menu measured 134×102 in all four, `scrollHeight === clientHeight` in all four, and
  all eight swatches sat fully inside both the viewport and the menu's own scroll port.
  **A page note cannot be given a low anchor at all**, which is worth knowing before writing the
  obvious drive: a description card sits at the top of its page, so a scroll can only carry it *up*
  and out, `scrollBy` clamps at 0 and the toolbar stays exactly where it was — 306 px of room below,
  the roomiest anchor there is, reported as if it had been pushed to the bottom edge. The dialog is
  where the tight anchor lives. It cannot come out otherwise above a ~248 px
  viewport, which is worth doing on paper before driving anything: the menu is 102 px tall (8 + 28
  + 2 + 28 + 4 + 24 + 8), `useAnchoredPopover` flips above the anchor whenever
  `scrollHeight > spaceBelow && spaceAbove > spaceBelow`, so the branch that neither flips nor fits
  needs `spaceBelow < 102` **and** `spaceAbove <= spaceBelow` — i.e. `innerHeight < 110 + 28 + 102 +
  8`. The app's smallest window renders at 498, and even the `Math.max(80, …)` floor still clears
  both swatch rows (8 + 28 + 2 + 28 = 66) and cuts only „Standard". What reproduced instead was the
  **ink**: a 13 px semibold „A" covers 6.3 % of its 28 px cell, so all eight cells are ~94 % white
  and every one of the 28 pairs sits under ΔE00 4 measured as the colour the eye integrates at that
  size — rot/pink 1.5, grün/türkis 1.6, orange/bernstein 1.7. „Six colours" is that palette read
  *correctly*. A 20 px fill takes coverage to 55.6 % and leaves one pair under 10 (grün/türkis,
  9.9). Two rules follow. **A count is not the assertion** — `count() === 8` passed against the
  defect the whole time; assert each swatch's rect inside the menu's rect *and* the viewport, plus
  `document.elementFromPoint` at its centre hitting the swatch itself, which is what case AB now
  does at the customer's viewport. And **a legibility complaint is measurable**: rasterise with
  `page.screenshot({ clip })` (never `fullPage`, which scrolls the popover shut), then decode it in
  a second `about:blank` page with `createImageBitmap` + `OffscreenCanvas` — Node has no PNG
  decoder and the browser is already open.
- **…which makes „the palette adds no click-away layer" an assertion, and one worth writing.**
  Every *other* popover in the app hangs one off `document.body` — `PillSelect`,
  `ColorSwatchPicker` (the task row's „Farbe wählen"), `SeasonSwitcher`, `SectionArranger` all
  render `<div className="fixed inset-0 z-30">` — so „a colour picker's click-away layer is a
  second `.fixed.inset-0`" is true of that one and false of this one, and the two are easy to
  confuse by name. Measured on `#/project/2`: `.fixed.inset-0` counts **0 before and 0 after** the
  palette opens, and the menu's `closest('.rte-root')` is the editor. `topDialog(page)` therefore
  never becomes the palette and stays usable for a real dialog behind it (the Termin editor's
  Notizen). The discriminator for the missing backdrop is not the count, though — a build that
  added one would still close the menu on an outside click. It is that **the click also does what
  it was aimed at**: read `document.querySelector('.rte-content').editor.state.selection.from`
  before and after clicking into the text, and require it to have *moved*. Poll it — the DOM
  selection reaches ProseMirror through `DOMObserver`'s ~20 ms flush, so a value read in the same
  tick is still the old one.
- **„Standard" needs a *selection*; a caret inside the coloured run is not enough.** `pick(null)`
  is `unsetMark('textColor')` on whatever the selection is, and over an **empty** selection
  ProseMirror only drops the *stored* mark — the run on screen keeps its colour, and the change
  shows up on the next character typed instead. Everything about the state says otherwise while it
  happens: with the caret inside `<span class="tc-blau">` the trigger previews blue and the „Blau"
  swatch reads `aria-pressed="true"`, so a script that clicks „Standard" there and asserts the span
  is gone fails against working code. Applying has the same shape. Select the run first (`End`,
  then Shift+←). `unsetLink` is the counter-example and the reason this reads as a defect at first:
  the link bar *does* `extendMarkRange` before it unsets.
- **The trigger drops its colour preview while the menu is open, on purpose**, so read the preview
  with the menu **closed**. A #1d4ed8 „A" on the #262626 the open trigger paints is not a preview
  of anything, so the inner `<span>`'s class list carries `tc-…` only when `!open && color` — a
  check that samples it with the palette up reads „no colour" whatever the code does, and passes
  against a build that previews nothing at all. The pair is: unstyled while open, `tc-blau` once
  it has closed on a caret sitting in a blue run.
- **…and since WP-74 only the *bar* takes that colour, not the letter.** The wrapper `<span>` still
  carries `tc-…` — that is what the class-list assertion above reads — but the „A" inside it now
  carries its own `text-neutral-600`, so `getComputedStyle(letter).color` is **never** the palette
  colour and a preview check written against the letter reports „no colour" against working code.
  The three spans are, in document order, wrapper → letter → bar; read
  `getComputedStyle(spans[2]).backgroundColor`. Which is also where the **Tailwind v4 colour-space
  trap** bites: a Tailwind utility computes to `oklch(0.439 0 none)` while the hand-written `tc-`
  hexes in `index.css` compute to `rgb(29, 78, 216)`, so „the letter is not blue" is a
  `!== 'rgb(29, 78, 216)'` and never an equality against a neutral spelled as `rgb(…)`.
- **⌘⇧F is the keyboard route into it**, and it is the only way in without a mouse: every toolbar
  button is `tabIndex={-1}` (WP-43). Focus lands on the *current* colour, the arrows walk the grid
  (`useRovingFocus`), Enter applies, Escape closes — and **a second ⌘⇧F closes it too**, from
  either side of the focus boundary, so a script may press it twice and must not expect a second
  menu. `GlobalSearch`'s ⌘F listener now ignores a key the editor already handled
  (`defaultPrevented`), and the menu stops the chord itself while it owns focus — before those two,
  ⌘⇧F moved focus to the search field, which reads as „the shortcut does nothing" because the note
  commits and the whole toolbar unmounts underneath it. Plain ⌘F still reaches the search field
  from inside a note, deliberately, and *that* does commit the note on the way.
- **Opening and saving a note *normalises* what is inside `<u>` and a colour span, and that is not
  a bug in your fixture.** A character reference there is decoded on the way in, exactly as the
  HTML parser used to decode it, so `<u>Fassung&nbsp;3</u>` comes back as `<u>Fassung 3</u>` with a
  real U+00A0 (and `&auml;` as `ä`). The **rendered** HTML is identical before and after — that is
  the assertion to write; a byte comparison of the stored text reports „the editor rewrote my note"
  against working code. Outside any mark a bare `&nbsp;` is still read as literal text (older than
  this branch, and the WP-57 blank-line marker is deliberately untouched by all of it).
- **TipTap's `focus()` lands a frame later, so „focus came back to the text" is an eventually-true
  assertion.** Read straight after the menu closes, `document.activeElement` is still the trigger
  button and the check fails against working code. `waitForFunction(() =>
  document.querySelector('.rte-content').contains(document.activeElement))`.
- **A colour class computes to a plain `rgb(...)`, the greyed-out version does not.** The palette
  is hand-written hex in `index.css` (`.tc-rot` → `rgb(185, 28, 28)`), while the grey it has to
  yield to on a done row is Tailwind's `text-neutral-400`, i.e. `oklch(0.708 0 none)`. So assert
  the colour against the literal rgb, and assert the *graying* as the comparison the entry above
  prescribes — the span's `color` must equal the cell's.
- **The table controls („Zeile +", „Spalte +", „Tabelle löschen") render *below* the editor** and
  only while the caret is inside a table. A script that clicks the table button and then looks
  for them above the text finds nothing.
- **Where the caret landed is `document.querySelector('.rte-content').editor.state.selection`.**
  ProseMirror stamps the TipTap instance onto the view's own DOM node, so that one expression is
  the whole handle — no bridge, no typing a marker character and reading it back. What makes it an
  assertion is comparing it against the *document* position of the word that was clicked
  (`doc.descendants`, `node.text.indexOf(…)`); a bare offset says nothing, and „the editor opened"
  says less. Since WP-56 a click into the middle of an eight-letter word resolves to word + 5;
  before it, to the end of the note, which on the demo fixture was 268 characters away.
- **Click a word by measuring it with a `Range`, not with `boundingBox()`.** The box of `.prose-md`
  is the whole note, so its centre is a different paragraph on every fixture. Walk the text nodes,
  `setStart`/`setEnd` around the word, and click that rect's centre — the same recipe measures
  where the word *renders*, which is the other half of a caret check.
- **The geometry that has to match is box-relative, and the toolbar's ~32 px is not a bug.** The
  reading view carries the editor's border and padding since WP-56 (`InlineNotes`' `BOX`), so a
  word sits at the same offset *inside* each surface's box — `.cursor-text` while reading,
  `.rte-content` while editing — and the boxes keep the same width, which is what makes both wrap
  at the same word. The whole field still moves down by the toolbar's height when it mounts, by
  design. So assert `word.x - box.x` and `word.y - box.y` on both sides; asserting the same
  viewport `y` before and after fails against working code.
- **`white-space: pre-wrap` can never be shared with the reading view**, however much the two
  surfaces are meant to render alike. `.rte-content` needs it (ProseMirror otherwise collapses a
  space run as you type it), but react-markdown's DOM keeps the Markdown source's *own* newlines as
  text nodes beside the `<br>` remark-breaks inserts for them, and puts `\n` between the block
  children of a `<li>` or a `<blockquote>`. Measured on a fixture: giving `.prose-md p` the rule
  takes a note from 274 px to 334 px (every soft break renders twice), and adding `li` takes each
  item from 20 px to 70 px. Only whitespace collapsing hides all of that.
- **TipTap's autofocus runs *after* every effect.** `Editor.mount` calls `commands.focus(autofocus)`
  from a `setTimeout(0)`, so a selection dispatched from `useLayoutEffect` — or from anything else
  in the mounting commit — is silently moved to the end of the note a tick later, and the editor
  looks like it ignores `posAtCoords`. `RichTextEditor` turns the autofocus *off* when it has a
  click to honour rather than racing it (WP-56); `onCreate` would be the other ordering-safe door.
- **The task table's Kommentar cell is ~2500 px down `#/project/1`.** `wordBox`-style coordinates
  read before scrolling are outside the viewport, so `mouse.dblclick` lands on nothing and the run
  reads „the comment editor never opens". `scrollIntoView({ block: 'center' })` first, then
  measure. The demo's one comment worth clicking into is task 5's („… — Monitorwege."), and
  `document.querySelector('table')` is the Besetzung grid, not the task table.
- **…and it opens on a *double* click, where a note opens on a single one.** `CommentCell` binds
  `onDoubleClick` (plus „+ Kommentar" on an empty cell and the row's „bearbeiten" button);
  `InlineNotes` binds `onClick`. So the recipe that opens a project description silently opens
  nothing on a comment, and the run reads „the compact toolbar does not exist" — which is also
  what a real `compact` regression would look like. `mouse.dblclick` at a measured point, never
  `locator.click()` twice: two clicks at the same coordinates are a double click *and* a
  paragraph-wide selection, which is a different starting state.
- **A key pressed right after a click acts on the *previous* caret.** ProseMirror syncs the DOM
  selection into its own state through `DOMObserver`, which flushes on a ~20 ms timer, so
  `click(); press('Tab')` runs the keymap against the selection the editor had *before* the
  click. `InlineNotes` and `CommentCell` autofocus to the **end**, so that stale selection is the
  last block of the note: driving WP-49, Tab indented the closing line while the assertion read
  the first paragraph, and it looked exactly like a broken indent command. Click, then
  `waitForTimeout(120)` — and wait for `.rte-content.ProseMirror-focused` before clicking at all,
  since the autofocus itself lands a frame late. Two clicks at the same coordinates also count as
  a double-click and select the whole paragraph, so place the caret with
  `mouse.click(box.x + 12, …)` rather than clicking the same element twice.
- **A selection built out of counted keystrokes has to be *asserted*, not assumed** — the same
  ~20 ms flush, one step further. `End` pressed straight after a click runs against the caret the
  editor had before it, so the arrows that follow start from the wrong place: measured on
  `#/project/2`, click → `End` → nine `Shift+ArrowLeft` left the editor with a **five**-character
  selection, and „Standard" then un-coloured half the run, which reads as „removing a colour is
  broken". A mark applied to an *empty* selection is worse, because it changes nothing at all and
  every assertion after it fails for a reason that is not the one under test. Wait for
  `.rte-content.ProseMirror-focused`, give it a ~150 ms beat, and read the range back before
  touching the toolbar:
  `editor.state.doc.textBetween(selection.from, selection.to, ' ')` must equal the run.
- **`npm run demo:seed` while the dev server is running changes nothing it can see.** The rebuild
  replaces the file; the server keeps its handle on the deleted inode and answers from it, so a
  „fresh" fixture check reads the previous run's edits. Stop the server first (sweep by process),
  then `npm run demo` — and remember any script that edits demo data is not re-runnable against a
  dirty database.
- **The project-scoped column manager lists nothing on the demo** (there are no project-scoped
  columns) — drive those cases from `#/artist/1` (which has one) or from Einstellungen. A
  *scoped* column is also the only way to reach „hide the column a header click is sorting by
  while the table stays mounted": hiding a global one means going to Einstellungen, which unmounts
  the table and resets the override. Create one with
  `POST /api/custom-columns {"name":"…","type":"text","scope":"project","project_id":5}` — and
  note the scope and its parent id must travel together since WP-51, or the write is a 400.
  A scoped **list** needs the parent too: `GET /api/custom-columns?scope=project` alone is a 400.
- **A write straight to `/api/custom-columns` does not refetch the client's column list**, and a
  synthetic `window.focus` event does not either. Toggle through the app's own ⚙ Spalten manager
  when the case depends on the table re-rendering with the new column set.
- **There are two `type="number"` inputs, one per „Zeitfenster", and since WP-54 they share a
  tab.** Both are under `#/einstellungen/aufgaben`: „Braucht Aufmerksamkeit" on the
  „Aufgaben-Übersicht" card, „Termine in der Übersicht" (the „Danach" divider) on the card below
  it, which moved there out of `#/einstellungen/kategorien`. Scoping to the card is now required
  rather than merely tidy — a bare `input[type="number"]` is ambiguous, and so is „Speichern".
- **`paletteFor('Deadline')` is `#fee2e2`, the same colour `LEGACY_EVENT_COLORS` holds for it**, so
  „Deadline" cannot distinguish the two code paths. „Termin" can (legacy `#e2e8f0` vs palette
  `#dcfce7`).
- **Removing a *filled* built-in opens the „Bereich entfernen" confirm** (WP-45 — the old
  „Bereich ist nicht leer" refusal is gone), whose overlay eats every following click until
  „Entfernen" or „Abbrechen" is pressed. An *empty* built-in skips the dialog and removes at
  once, with an undo toast. An *empty* custom widget skips the dialog entirely.
- **„+ Bereich" is in the toolbar *outside* edit mode** (WP-45). A script that infers arrange
  mode from that button's presence is wrong now — the mode signal is „✓ Fertig" vs
  „✎ Bereiche bearbeiten", or the strip (`.section-title` hidden, dashed outlines).
- **An undo toast appears a React tick *before* the section unmounts.** The toast's setState and
  TanStack's cache notification land in different batches, so asserting a `[data-section]` is
  gone right after `toast.waitFor()` races the second batch and fails against working code. Wait
  for the node: `locator.waitFor({ state: 'detached' })` — `gone()` in the shared `drive.mjs`.
- **The removal toast names the section by its label, not its key.** On the artist page the
  `termine` 🗑 toasts „Bereich „Wichtige Termine“ entfernt." — asserting „Bereich „Termine““
  matches nothing (and `getByText` substring matching does not save you, the `„` is in the way).
  Take the expected name from `labels.ts`' default for that page's label key.
- **`aufmerksamkeit` is never in `nonEmptyKeys`** — the computed Einblicke sections cannot be
  „filled" — so it is the one built-in whose 🗑 always removes at once, with no confirm to click
  through. That makes it the target of choice for anything about removal and its undo.
- **Whether the undo leaves a `layout` behind is the assertion, not whether the section is back.**
  Undoing a removal on a template-following page (artists 1/3/4) must put `artists.layout` back to
  `NULL`; on a page with its own layout (artist 2) it must not. Both look identical on screen —
  the section returns either way — so read the column: `curl -s localhost:4317/api/artists/1`.
  Removing anything on a template-following page writes a layout *first*, which is what the undo
  then has to give back.
- **`TextInput` renders a bare `<input>` with no `type` attribute**, so `input[type="text"]`
  matches nothing anywhere in this app — not in the section picker, not in any `RecordFormModal`.
  Scope to the dialog and take `input` (`topDialog(page).locator('input')`).
- **A failed write is reachable without breaking the server**: `page.route('**/api/…', r =>
  r.abort('failed'))` is how the „konnte nicht" paths get driven at all. Filter the toast on
  `'konnte nicht'` rather than on the full sentence — the wording is per call site.
- **The link dialog's „Kategorie" is `type: 'pills'`, not a `<select>`** — `selectOption` finds
  nothing. The options are `[aria-pressed]` buttons and the current value is
  `[aria-pressed="true"]`; a second click on it clears the field.
- **Project 1's „Technik" group is the only *categorised* link group with two rows**, so it is the
  only place a within-category reorder is observable, and the group's `sort_order` values are
  *interleaved* with the other groups' (0, 5, 6, 7) — which is the case a per-group reorder must
  not disturb. The group headings are `span.rounded-full` inside the list's `div.space-y-4` and
  CSS-uppercased. WP-78's 29 links are all **uncategorised**, so they render as one „Ohne
  Kategorie" list per widget and every drop inside it is legal — useful for a long drag, useless
  for anything about `canDrop`.

### Field sizes: artist 5 and its two projects (WP-78)

Everything above is one row per branch. The WP-70 audit of a real installation found every branch
covered and every **magnitude** three to eight times too small, so `demo.ts` grew one artist with
two projects carrying the field's numbers. It is purely additive — no row, date, ordinal or layout
that existed before it moved — which is why the six entries below are all *new* handles rather than
corrections to the ones above.

- **`#/project/10` („EW1 · Festivalzentrum") is the field-sized page.** 45 tasks (the customer's
  busiest project has 46; the demo's had 11), 23 of them subtasks under 11 parents, ids 100–144.
  This is where to look at anything that changes with length: the grouping rail, a header-click
  sort, the ⠿ over a long list, the „mitverschoben" count of a move, and the **print sheet** —
  `#/print/project/10` prints 18 contacts and 30 open tasks in two status groups, which is the
  first demo sheet long enough to say anything about how paper handles a real list
  (`check:browser`'s N2 builds its own tuned fixture for the page break itself and does not touch
  this one).
- **Three things are deliberately absent on that page, and each is a measurement.** Not one row
  carries a **due date** (2 of the customer's 208 do, both stale by 18 months, and the built-in
  „Fällig" is switched off in all three of his seasons), not one carries a **colour** (0 in 208),
  and not one of its 26 links carries a **category** or a **note** (`category` is NULL on all 82 of
  his links and `notes` is empty on every row). So „Fällig" is a column of „—" here and „Ohne
  Kategorie" is the whole of every link list — which is what those surfaces look like in the field,
  and the opposite of every other page on the demo. What *is* present in field proportion is the
  **comment**: 36 of the 45 carry one, against 149 of 184 in the field.
- **Its stored layout has 16 entries, ten of them `cs<id>`** — the customer's biggest is 18, and 17
  of his 30 artist/project pages carry one at all, where the demo had two of 6 and 3. That is the
  page for „alles zurücksetzen", the arranger's drag rail and the picker at real length. The ten
  widgets are `custom_sections` 6–15; four of them are `links` widgets holding 26 documents between
  them (the customer hangs 30 of one season's 44 links off sections, and across his installation
  sections carry 41 % of every link he files; the demo had four).
- **`#/project/11` („EW2 · Nachwuchsreihe") is the unsorted, statusless page.** Its `status` is
  **NULL** — 8 of the customer's 10 projects have none, so „every project wears a status pill" was
  a demo artefact, and this is the page to check what a missing pill does to a header or a print
  sheet. And **every row that hangs off it sits at `sort_order = 0`** (6 tasks, 8 contacts, 2 live
  widgets, 3 links), because two of his three seasons are exactly that: one distinct ordinal in
  every table (bar a single task), zero — and even the season he works in daily has twelve groups
  of live tasks sharing one, the largest fourteen deep. List order there is the id tiebreak and
  nothing else, which is the state in
  which a list that has forgotten the tiebreak looks random on real data and perfectly ordered
  everywhere else on the demo. **A reorder assertion must not be driven here** — the ordinals carry
  no information to preserve.
- **There is an orphaned image, and it is 67 KB.** `images` holds two rows: the hall plan the notes
  reference, and `buehnenfoto.png` (623×505), which **nothing references at all**. The customer's
  file has exactly that — one insert-then-remove that is 24 % of the season's database and rides
  along in all 30 restore points. It is invisible in the UI by definition, so the seeder prints its
  size („Verwaistes Bild …"), and the only other way to see it is
  `SELECT token, byte_size FROM images`. It is generated at seed time from a fixed seed, so the
  bytes and the content token are the same on every rebuild.
- **One Papierkorb row can never expire.** `custom_sections` 18 („Frühere Sammlung", on project 11)
  is soft-deleted **33 days ago** — three days past `PURGE_AFTER_DAYS` — and survives every start
  because the live link 46 still points at it: `purgeExpired` skips any expired row a remaining row
  references (SDL-01). So the demo now shows both halves of that trade-off, widget 5 inside the
  window and this one past it, and „Endgültig löschen" is the only way this one ever leaves.
  Anything that counts Papierkorb rows has to expect **two** trashed sections, not one.
  Pinned since WP-78a by `check:browser`'s **AI2**, as an `/api/deleted` reading (`purge_at: null`,
  one dependent link) paired with the wording the row prints — „bleibt, bis abhängige Einträge
  entfernt sind" against a leaf row's „wird in … endgültig entfernt".
- **It is a HOME-only reading, and that is not a preference.** `copySeasonData` copies **live**
  rows only, so no fixture season carries section 18 at all — a case that took a copy first would
  find nothing and pass vacuously. The same goes for the *cause*: `purgeExpired` runs at server
  startup on the registry default, so the thing that makes „it survived the sweep" a caused outcome
  is the gate's own cold start over a freshly rebuilt `.demo`, not anything the case does.

## Narrow windows

Since WP-55 the window can go down to **624×560**, which is smaller than anything the interface
was designed against, and no check ever set a viewport — Playwright's default is 1280×720, so
nothing would have noticed. `check:browser`'s case L does now, over `#/dashboard`, `#/`,
`#/artist/1`, `#/project/1`, `#/archiv` and `#/einstellungen`; everything else at this width is
still by hand.

- **The viewport is not the window.** `useContentSize` is false, so `WINDOW_MINIMUM` is the outer
  size and the frame comes off before the renderer sees anything. Driving at 624×560 checks a
  window nobody has: the real pair is **610×498** (Windows 11, whose frame measures 14×62 — a
  customer's boot log shows a 1440-wide window reporting `innerWidth: 1426`) and **624×532**
  (macOS, no side frame). Check both; they differ by more than the numbers suggest, because
  Tailwind's `sm:` is exactly 640 and both must stay under it.
- **`launch({ viewport })`** in `~/.claude/tools/playwright/lib/drive.mjs` takes it; nothing else
  changes.
- **The assertion that catches real breakage is `documentElement.scrollWidth <=
  clientWidth`,** plus a sweep for elements whose `right` exceeds the viewport. Without the second
  half a card that is cut off is invisible — content clipped away never grows the document — and
  without the first, nothing catches a page that simply got wider.
- **The sweep's exemption is `auto|scroll`, never `hidden`.** The two are opposites for this
  question: a scrollable ancestor *offers* the overhang (which is what the task table does by
  design, WP-55), a `hidden` or `clip` one *cuts it off*, and a `Card className="overflow-hidden"`
  whose row grew past the window is exactly the defect a narrow-window check exists for. Take the
  verdict at the nearest ancestor that constrains the axis: `auto`/`scroll` → exempt; `hidden`/
  `clip` → report, unless the element fits inside that clipper (then the clipper is the offender
  and reports itself on its own turn). One blind spot remains and is worth knowing rather than
  papering over: CSS promotes a `visible` paired with a non-`visible` to `auto`, so any box with
  `overflow-y: auto` — every dialog, every popover with a vertical scroller — computes `auto` on
  x too and exempts its subtree.
- **Prove the sweep can still see something, with two probes rather than one.** A 3000 px `<div>`
  on `body` must grow the document *and* be reported; the same `<div>` inside an
  `overflow:hidden` box must **not** grow it and must still be reported. The second one is the
  control that fails if the `hidden` rule above is ever loosened back to an exemption — and it has
  to run through the shipped sweep, not through a copy of its loop pasted into the control.
- **`div.overflow-x-auto` has an inner `div.min-w-min` since WP-55**, holding the add row and the
  `<table>` together so the two are the same width. A selector written as
  `div.overflow-x-auto > div.flex` for the add row matched before that and matches nothing now.
- **Measure the add row with `offsetWidth`, not `scrollWidth`.** Its content is short; the
  question is how wide the box is, and `scrollWidth` answers the other one.
- **`#/project/1` needs `waitForSelector('div.overflow-x-auto table tbody tr')`.**
  `html[data-app-ready]` fires before the rows are laid out, and a table measured in that window
  reports a *narrower* preferred width than the one the user sees — the same run gave 758 and 1347
  for the same page.
- **The width sweep does not notice `min-w-min` going away**, which is worth knowing before
  writing a canary for it: the add row and the table both live inside `div.overflow-x-auto`, so
  removing the box leaves `documentElement.scrollWidth` at exactly the viewport and the sweep
  exempts everything under that scroller by design. The assertion that goes red is the pair —
  `addRow.offsetWidth === table.offsetWidth` — which reads 1347/1347 with the box and 562/1347
  (610 px viewport) or 576/1347 (624 px) without it. Assert alongside it that the table really
  does overhang its container at that width (`scroller.scrollWidth > scroller.clientWidth`), or
  the sweep's exemption is never exercised and the case proves less than it looks.
- **A `<select>` keeps the width of its *first* layout, and React fills its options in later.**
  This is what made `#/einstellungen` look like a page that overhangs one load in ten (WP-64b's
  reading), and it is neither the page being flaky nor the sweep: `TaskSortEditor`'s add row is a
  `<select>` beside „+ Hinzufügen", Chromium sizes it to its longest option — „Priorität
  (ausgeblendet – sortiert nur auf Seiten, die sie zeigen)", 465 px — and **does not re-measure
  when the columns query adds those options a moment later**. Whichever width the first layout
  took simply stays: after a `reload()` the box is 181 px in six loads out of six (and the row
  fits, whatever the CSS says), while a `goto` to the tab without a reload is 465 in six out of
  six. Waiting for `select option` to be there is therefore *not* enough to measure it — what
  re-runs the intrinsic sizing is a `change` on the select, i.e. what a user does before pressing
  „+ Hinzufügen": 24 loads out of 24. Use the select once, then measure.
  The row itself was fixed in WP-64c (`min-w-0`, so the flex item may shrink below its longest
  option); `#/einstellungen` is in `check:browser`'s narrow page set since.
- **At 624 px the same overhang is invisible to a window sweep, which is why the assertion is
  against the *card*.** The row's right edge does not move with the window — the page's left inset
  is the same at both widths and the row's content width is fixed by the select — so without the
  fix „+ Hinzufügen" ends at **617 px in both**: 7 px past a 610 px viewport, where the sweep
  reports it, and 7 px *inside* a 624 px one, where the sweep has nothing to say while the row
  still overhangs its card (600 px) by 17. „Does the row end inside its card" bites at both widths
  and is the honest question anyway — the card is where the content is cut off.
- **The season switcher's menu is `div.absolute.left-0.w-64`** — address it by its shape, not its
  layer. It moved off `z-40` onto the shared `POPOVER_LAYER` (`z-[55]`) with #175, so a selector
  keyed on the z-value silently matches nothing after that change; `.left-0.w-64` is the menu and
  not its `fixed inset-0` backdrop. What WP-55 pinned on it is the pair `overflow-y: auto` plus
  `max-height: min(24rem, 70vh)` — 348.6 px in a 498 px window. Assert those rather than „the menu
  fits", which is true on a short list whatever the CSS says: the demo has three seasons and a run's
  own fixtures only take it to eight.
- **A toast can cover a menu, and only at 624×532 (#175, case L2).** The toast stack is
  `pointer-events-none` but each card is `pointer-events-auto`, so „is the menu covered" is a
  pointer-events question, not a paint one: read it with `elementsFromPoint` at three x-fractions of
  every option (a menu covered only at its left edge is still broken), **not** by comparing z-index
  numbers — the toast column and the menu portal are separate `fixed` subtrees and do not share a
  stacking context. The bug is invisible at `WIDE`: the toast is bottom-centred and narrow there, and
  a menu only reaches its band when `useAnchoredPopover` caps it against a low viewport bottom. The
  undo toast lives 6 s and hovering does not pause it, so raise a fresh one (delete a task) whenever
  a loop over pills outlives it, and delete from the *bottom* so the top pills keep their indices.

## Asking the main process a question (WP-67b)

Some behaviour has no page to drive: a Dock click, what `activate` carries, what a window reports
about itself. Playwright cannot reach it and the real app must not be launched for it — but a
**bare Electron app in the scratchpad, started with the repository's own binary**, can:

```sh
mkdir -p "$SCRATCH/dockprobe"        # package.json: { "main": "main.cjs" }, plus main.cjs
./node_modules/.bin/electron "$SCRATCH/dockprobe"
```

No install (the binary is already in `node_modules`), no data directory of the app's, nothing on
the desktop but the probe's own windows. Put the **exact function that is going to ship** in the
probe (WP-67b copied `activatePlan` into a `plan.cjs` it required), so what gets driven is the
decision itself and not an approximation of it.

The traps, each of which cost a wrong reading once:

- **`hasVisibleWindows` is `true` while every window is minimized** (Electron 43.3.0, macOS 15.6).
  The flag AppKit hands to `activate` cannot tell „one window up" from „all of them in the Dock";
  it is honest only when there is no window at all. `DECISIONS.md` has the measurement. Nothing
  should branch on it — and no other event argument should be trusted before a probe has shown it.
- **Log the state at the event *and* again ~800 ms later.** macOS restores a window of its own
  somewhere after the click — in that probe it was already back in a sample taken 657 ms on, and
  when it happened inside that gap is not measured. A single snapshot shows macOS' work, not the
  code's.
- **`new Date().toISOString()` is UTC.** An hour off the wall clock is enough to read „nothing was
  logged since" from a log that is up to date. Note the offset in the probe or print local time.
- **Window `hide`/`show` fire on a Space switch too**, so a log full of them is usually the user
  walking away from the probe, not the app hiding.
- **`BrowserWindow.getAllWindows()` came back newest-first** in that probe. Nothing documents an
  order; do not build one into an assertion.

## Auditing a customer's data directory (WP-70)

A copy of a real installation — the Electron `userData` directory plus the backup folder — answers
questions no gate and no dev server can: what the schemas actually look like side by side, which
invariants hold on five weeks of real rows, what the magnitudes are. There is no page to drive and
no server to boot; the artifacts are SQLite files, JSONL and generated text, read with whichever
SQLite runtime the session can actually reach (second bullet). The WP-70 pass (2026-08-26) lost time
to each of the following.

**Nothing here is a licence to write.** Read-only, on a copy, and no name, address, note or profile
path from such a snapshot goes into a report, a commit or a doc — counts, lengths, ids and shapes
only. See `CLAUDE.md` on what the ignored data paths protect.

- **Work on a copy, and open it with `immutable=1`.** Opening a WAL-mode Auftakt database read-only
  can still create a 32 KiB `-shm` and a 0 B `-wal` beside it whenever the directory is writable,
  and **`?mode=ro` does not prevent that** — reproduced on a clean WAL file with python3's stdlib
  (SQLite 3.53.4): `mode=ro` creates both, and both are still there after the connection closes.
  (The Apple CLI's older SQLite — 3.43.2 — cannot bring up the `-shm` under `mode=ro` at all and
  fails instead; see the next bullet.) `file:…?mode=ro&immutable=1` creates nothing,
  because `immutable=1` promises SQLite the file cannot change and it skips the WAL machinery
  altogether. That promise is safe on a copy nothing else has open and **only** there; against a
  live database it is a lie whose price is stale reads. The WP-70 pass used plain `mode=ro` and
  added 32 files / 524,288 bytes to its own working copy before noticing — reconciling a file count
  afterwards then costs another pass. Restore-point databases are unaffected either way, being
  `journal_mode = delete`.
- **Exit 14 from the `sqlite3` CLI has two different causes, and only one of them is the sandbox.**
  The WP-70 pass read „unable to open database file (14)" as the harness blocking the binary
  outright and moved the whole audit to `python3` — a good fallback, but the diagnosis does not
  generalise: the CLI is *not* blocked in every session, and it reads databases under
  `/private/tmp` fine in some. The same error is also what SQLite itself reports when it cannot
  bring up a WAL database's `-shm`, and `-readonly` makes it *more* likely rather than less. On a
  directory the process may not write: `sqlite3 -readonly wal.db 'select …'` gives exactly
  `Error: in prepare, unable to open database file (14)`, a plain open gives
  `attempt to write a readonly database (8)`, and `sqlite3 'file:…?mode=ro&immutable=1'` reads the
  row without complaint. **Try the immutable URI before concluding anything about the sandbox.**
  And the two runtimes genuinely differ on this machine, independent of permissions: the CLI's
  SQLite (3.43.2) fails with exit 14 under plain `mode=ro` even on a writable directory and a
  pristine WAL file, where python3's stdlib (3.53.4) reads fine and creates the `-shm` — while on
  an unwritable directory python3's plain `mode=ro` fails too (as error 8, not 14). So „python3
  works and the CLI does not" can be a version difference or a permission difference; the
  `immutable=1` probe in *whichever* runtime is what separates the causes.
- **Never compare a backup to a live database by hash or by size.** Restore points are
  `VACUUM INTO` snapshots: compacted, `journal_mode = delete`, a different page count from their
  source, and never byte-equal to it. Compare **rows**, table for table. This nearly produced a
  false „the backups are stale" finding. The one entry in a restore point that *is* a byte copy is
  `seasons.json` (`copyFileSync`), and `MANIFEST.txt` is generated and has no live counterpart —
  three comparison rules inside one folder. `docs/DECISIONS.md`, „Backups are `VACUUM INTO`
  snapshots, not byte copies".
- **A season's `user_version` says when that season was last *opened*, not what the app is.**
  Migrations run only where `getDb()` or `createSeason()` opens a file, so a `0` means „no window
  has pinned this season since the stamp shipped", never „a legacy installation". Expect an
  installation to hold several schema generations at once and write every cross-season query to
  survive it — a column another season has may be absent here, and a declared column default may be
  older *or* newer than the current `SCHEMA` depending on whether the table was created or
  `ALTER`ed. `seasonStats` and `adoptLegacyBackupConfig` are the in-product examples of doing this
  right.
- **`task_sort` names built-in columns by `key`; only `tasks.custom_values` is keyed by
  `custom_columns.id`.** Two JSON structures in the same season, two different spellings. `colId`
  (`client/src/lib/taskColumns.ts`) yields a built-in's `key` — `status`, `priority`, `due` — or
  `custom:<id>` for a custom column, and that is the spelling `task_sort` and the WP-59
  `task_columns` override map both use. `tasks.custom_values` is the odd one out: a plain object
  keyed by bare column id (`server/src/lib/customValues.ts`). So validating `task_sort` entries
  against `custom_columns.id` returns **zero matches on a perfectly healthy database** — it is the
  first thing an id-shaped validation pass reports and it means nothing. The mirror mistake is
  quieter and worse: reading a `custom_values` key as a built-in `key` also finds nothing.
- **`sort_order = 0` on every row is a normal field state, not a corrupted one.** Two of the three
  audited seasons had exactly one distinct ordinal across artists, projects, contacts, events,
  links and sections — zero — and the third, which shows real dragging, still had twelve groups of
  live tasks sharing an ordinal, the largest fourteen deep. `demo.ts` inserts every entity with
  `sort_order: i` and so never produces this, which means a list that forgets its tiebreak looks
  correct on the demo and random on real data. **And the tiebreak is not the same column
  everywhere.** `sort_order ASC, id ASC`
  for projects, contacts, links, custom sections and custom columns
  (`server/src/routes/entities.ts`); `t.sort_order ASC, t.id ASC` for tasks (`TASK_ORDER` and
  `TASK_ORDER_DUE`, `server/src/lib/queries.ts`), with the client's `sortTasks` falling through to
  `a.sort_order - b.sort_order || a.id - b.id` (`TaskTable.tsx`) — but **artists order
  `sort_order ASC, name ASC`** (`entities.ts`, `routes/dashboard.ts`), so an all-zero artists table
  is alphabetical, not id-ordered — and **events have no `ORDER BY` at all** (their list route
  passes no `order` to the CRUD factory), the sharpest case of the rule. Read the query before
  predicting an order.
- **Never read a raw filesystem mtime from a transferred snapshot.** In the WP-70 snapshot every
  customer-written file carried an mtime exactly 9 h earlier than the instant its own contents
  recorded — three independent confirmations (a log whose mtime preceded its last line, a README
  one second shy of the boot-log entry that rewrote it, a season file landing between the two
  restore points whose hashes bracket its change) — while the transfer machine's own `.DS_Store`
  files were unshifted. Transfers can shift mtimes wholesale; the authoritative clocks are the
  contents: boot-/app-log `at` (UTC) and `fileStamp()` folder names (naive customer-local). Cross
  those two against each other and the timezone falls out for free; trust a bare `stat` and every
  conclusion inherits the shift.

## What is not verified this way

The Electron half — dialogs, relaunch, the packaged app against a real data directory — has its own
checklist in [BACKUP-TESTING.md](BACKUP-TESTING.md), to be run on macOS **and** Windows before a
release. It covers what no headless run can.
