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
anything, the ⠿ and its 2-px nudge, the dialog-scoped „Löschen", the toast filtered by its own
record, „gone" as a wait rather than a count, the two viewports a 624×560 window really produces,
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
    cadence this display has been seen to deliver; `drops` — a fifth of frames lost; `starved` —
    too few frames delivered).
  - `done` → the node is gone and `#root` is no longer `inert`.
- **Every boot files a report: `localStorage['auftakt-boot-report']`.** Written in the overlay's
  single exit path just after the node is removed, so it is the non-racy way to learn what a boot
  did after the fact: wait for `html[data-boot="done"]`, then read it — no need to catch
  attributes before the overlay vanishes. One JSON object, last boot wins (a warm reload
  overwrites it with `skip / warm`, which is also how you prove the reload happened). Fields:
  `outcome` (`play` | `cross` | `skip`), `why` (`done`, `deadline`, `click`, `app-failed`,
  `abort:<reason>`, `hold-max`, `gesture-max`, `warm`, `secondary`, `reduced-motion`, `no-prod`),
  `readyMs`/`startMs`/`endMs` on the same clock the 1200 ms deadline reads, and — when the
  gesture played — `frames` (judged deltas: `n`, `med`, `p95`, `worst`, `quick`, `drops`, plus
  `lead`, the release→first-callback gap, and `warm`/`warm2`, the two exempt head frames) and
  `tail` (deltas recorded unjudged during the reveal fade, with a retrospective `verdict`). A
  `tail.verdict` of `hitch` on a run with **no** `data-abort` is not a contradiction: the
  attribute still means the watchdog *changed the outcome*, the tail is record-only. Under
  Electron the same report goes out over the `bootSettled` bridge.
- **The report is versioned, and WP-61 made it `v: 2`.** Two head frames are exempt instead of
  one (so `frames.n` counts one delta fewer, and `warm2` joins `warm`) and `HITCH_MS` moved
  50 → 58. Nothing branches on `v` — a `v: 1` line stays readable field for field — but `n`,
  `why` and `tail.verdict` were produced under the old rules, so a log holding both generations
  must not be compared across the boundary. Old lines are *stricter*: a `tail.verdict` of
  `hitch` needed only 50 ms there. `grep '"v":2'` separates them.
- **Under Electron the reports accumulate: `boot-log.jsonl` in userData.** One line per settle —
  including warm reloads (a season switch writes `skip / warm`; that line is the reload proving
  itself, not noise) — wrapped by the main process with `at` (ISO time, main's clock, so a
  renderer cannot spoof it) and `app` (version). Capped at 64 KB, then trimmed to the last 100
  lines. A launch whose renderer never reported still gets a line, through one of two doors: a
  crashed or wedged renderer that lives past 8 s gets `{"outcome":"no-report","why":"fallback-8s"}`
  from the chores fallback, and a launch *quit* before the overlay settled — Cmd-Q or Ctrl-C
  during the hold or the gesture; on macOS the 8 s timer dies with the process — gets
  `{"outcome":"no-report","why":"quit"}` from the before-quit/SIGINT hooks. An empty log after a
  launch therefore always means the diagnostics did not run, never that the boot was merely
  short-lived. Read it with
  `tail -n 5 ~/Library/Application\ Support/Auftakt/boot-log.jsonl | jq .` (Windows:
  `%APPDATA%\Auftakt\boot-log.jsonl`). Dev mode writes nothing, matching the overlay it reports
  on. The writer is `electron/bootLog.ts`, electron-import-free so `check:unit` covers it.
- **Since WP-54 the customer can reach it too**, which is the point of the file: Einstellungen →
  „Programm & Hilfe" → „Feedback senden…" writes the whole log into a bundle on the desktop and
  asks them to attach it. `summarizeBootLog`'s five-line digest is now the **fallback** — it rides
  in the mail body only when no bundle was written (a Wunsch, the browser build, or a failed
  write), so a mail that carries the file carries no digest at all. Do not verify the digest by
  reading the dialog; read the summary itself under `check:unit`, where the four record species
  and the untrusted-`why` case are pinned.
- **A Fehler writes `Auftakt-Diagnose-<ref>.txt` to the desktop — on „Weiter", and nothing else
  happens** (WP-66; it used to reveal the file in the Finder and launch a mail client too).
  Four things follow for anyone verifying it. It is a *real file on the desktop of whoever runs
  the app*, so never drive the unstubbed path from a script — the browser stub in `lib/drive.mjs`
  records `saveDiagnostics`'s arguments into `window.__saved` and the assertion belongs on the
  filename the handover then names. **The write is on „Weiter", not on the last button, and the
  handover waits for it**, so a script that only clicks „Weiter" has already produced the file,
  one that waits for it after „Fertig" waits for ever, and one that expects the second dialog to
  appear in the same tick as the click is racing an IPC round trip (`collectSystemFacts` awaits
  the GPU calls). The file persists between runs, so a manual pass that does not delete
  it is reading a stale bundle a minute later — the reference in it is the tell. And **dev writes
  no boot log**, so a bundle built in dev holds the machine section and „noch keinen Start
  protokolliert" under the log heading; that is the branch, not a truncated file. A Wunsch writes
  nothing at all.
- **Going „Zurück", editing an answer and pressing „Weiter" again writes a *second* bundle, and
  the handover then names `…-2.txt`.** The file carries the report text, so the first one would
  otherwise be the version the customer attaches; `uniqueBundleName` (`electron/diagnostics.ts`)
  gives the second its own name and main returns it. Three consequences for a driving script.
  **The dialog remembers report text → name**, so a text already on the desktop — an unchanged
  one, or an edit taken back again — names that bundle without writing a third: `window.__saved`
  stays where it was, which is also what makes the Escape-and-back-again case a 1. Only the
  *taken-back* edit tests that, though: everywhere else the remembered name and the predictable
  one are the same string, so a guess passes as well as a lookup. **A stub that always answers
  `Auftakt-Diagnose-${ref}.txt` cannot see any of this** — it makes the one name the handover
  must never predict indistinguishable from the one it may — so both stubs emulate the suffix
  (second save of a reference → `…-2.txt`). And **`window.__holdSave = true` parks the next save**
  until `window.__finishSave()`: while it is parked the handover must not be on screen at all,
  which is how „it waits for the write instead of guessing the name" is asserted rather than
  assumed. During that wait the primary button is disabled **and reads „Speichert…"**, so
  `getByRole('button', { name: 'Weiter' })` matches nothing for as long as the save is held — up
  to two seconds in the real app, where `collectSystemFacts` races `getGPUInfo` against its own
  timeout.
- **Nothing on this path opens anything by itself (WP-66).** „E-Mail öffnen" is gone: a script
  that waits for it, or that expects `window.__external` to fill after „Weiter", hangs. The
  `mailto:` now sits at the bottom of the handover as the link „E-Mail-Programm öffnen"
  (`getByRole('link', …)`, not `button`), and it is the *only* thing that ever reaches
  `openExternal` from this dialog — which makes the recording stub the instrument for the
  promise as well: after „Weiter", `window.__external` must still be empty.
- **The handover's three copy buttons need clipboard permission, and they really use it.** „An",
  „Betreff" and „Text" are `navigator.clipboard.writeText` — no bridge involved, and the loopback
  origin the packaged app runs on is a secure context, as is the dev server. To assert on them,
  `context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: UI })` — a *context*
  permission, so it may be granted at any point, before or after the page is open — then read
  back with `page.evaluate(() => navigator.clipboard.readText())`; both work headless. The write
  also needs the page focused, so `bringToFront()` it when earlier cases left pages open. Without
  the grant the write rejects, the dialog shows a „Kopieren hat nicht geklappt" toast and the
  button keeps its label — which reads as „the copy button is broken". Two tells. On success the
  label says „Kopiert ✓" for 2.5 s, so a second assertion inside that window is looking for a
  button that no longer has the name it clicked; and a failed **„Text kopieren"** reveals the
  body in a `<pre>` inside the handover, since that row shows a description rather than the text
  and „von Hand markieren" would otherwise point at nothing.
- **The text boxes stop at the mail's budget, not at their `maxLength`.** `maxLength` is 300 per
  field, but every keystroke goes through `fitFeedbackAnswer` first, so three boxes filled to 300
  with German come back holding fewer — the last one typed is the short one, and „Die E-Mail ist
  voll" appears under the fields. A script that types 300 characters into each and asserts on the
  value, or that expects its own string back out of the third box, is asserting on a cap that is
  not the one in force. `fill()` counts as one paste: it lands cut, not refused. What the preview
  shows is `feedbackMailBody`, i.e. the body *after* the composer's truncation ladder — with a fat
  boot summary and no attachment, the block in the preview is shorter than the one
  `get-diagnostics` returned, and that is correct rather than a stale render.
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
  the watchdog judges rolling 200 ms windows to the last frame, not just the opening one. There are
  two exceptions. The first is the **head of the gesture**: the first two measured deltas after
  `data-boot="play"` are exempt from every test (WP-61 — the first schedules the svg's first
  raster, the second waits for it), so a block landing there does not abort and shows up as
  `frames.warm` / `frames.warm2` instead. That is also the handle for driving it: `start()` sets
  `data-boot="play"` and calls `watchFrames()` inside one task, and a `MutationObserver` callback
  is a microtask, so an observer on that attribute is registered *after* the watchdog's first rAF
  and runs after it in every frame from then on — blocking inside your own rAF callback *k*
  therefore inflates measured delta *k*, where delta 1 is `warm`. Slot-addressable injection with
  no polling and no rAF patching: 150 ms at slot 1 stays a clean `play`/`done`, the same 150 ms at
  slot 3 is `cross`/`abort:hitch`. Before WP-61 slot 2 aborted, which is the whole bug.
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
  often not a dialog at all.** A `Modal` opened out of another one is rendered *inside* it (the
  feedback dialog's „So schickst du es ab"), so document order puts the topmost last — a
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
  „E-Mail-Programm öffnen" link produces one, and the dialog stays open behind it, so the recorder
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
- **„Weiter" opens a dialog rather than closing one, it is the click that writes the file, and it
  waits for that write.** It stacks the handover („So schickst du es ab") on the form once main
  has answered, so `dialogs(page)` counts **2** from there on — scope to `topDialog(page)`, or a
  bare `getByRole('button', {name: 'Zurück'})` matches nothing useful. Its footer ends in
  „Fertig", which closes both and sends the toast
  naming the bundle; nothing in the dialog claims the mail was sent, because the app cannot know.
  Escape and the backdrop peel off the handover only; the filled-in form is still behind it,
  which is also how to check that a „Zurück" kept the typed answers.
- **The handover has body tabbables, so focus does *not* land on „Zurück".** WP-42's „a confirm
  focuses the footer's safe answer" holds for dialogs whose body has nothing to focus; this one's
  first stop is „Adresse kopieren" (`tabStop` index 1), because `Modal` prefers the body's first
  tabbable over the footer's. Enter on arrival copies the address — the first step, and nothing
  that cannot be taken back.
- **The dialog asks nothing until a kind is picked, and the questions differ per kind.** „Was ist
  passiert?" exists only under Fehler — a script keyed on it hangs on a Wunsch, where the same
  first box reads „Was möchtest du tun können?". Click `getByRole('button', {name: /^Fehler/})`
  first, then the area, then fill `locator('textarea').nth(0)` by position rather than by label
  (the `getByLabel` trap below applies here too). The subject is
  `[AF-<10 digits>] Auftakt-(Fehler|Wunsch): <Bereich>`, and the reference is stamped once when
  the dialog opens — the same value appears in the preview, in the subject, in the body's stamp
  line („Fehler · Künstler · Kennung: AF-…", in the technical block, not at the top) and in the
  diagnostics filename, which is what to assert they agree on. With a bundle written the body's
  first line is `!! BITTE NOCH ANHÄNGEN: …`; without one it starts straight in on `--- <heading>`.
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

- **Only two contact lists have more than one row**, so they are the only two a reorder can be
  tried on: project 1 („NQ1 · Eröffnungskonzert") has three contacts and artist 1 („Nordlicht
  Quartett") has two. Their `sort_order` values are interleaved with the other parents' (0, 6, 7
  and 1, 8), which is the case a reorder must not disturb. Artist 3 deliberately keeps its single
  contact — the dependent-count fixture below leans on it.
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
  is the odd rank there, and it is odd by *status* now, not by priority.
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
  „bleibt, bis abhängige Einträge entfernt sind".
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
- **Artist 2 and project 3 ship their own `layout`; artists 1/3/4 and every other project are
  `NULL`** and follow the `artist_layout`/`project_layout` template (WP-25). So the two states are
  both on the demo — and a check that arranges one artist must assert against a *different* one,
  because asserting against artist 2 proves nothing. Artist 2 also un-hides `stats` **and
  tombstones `aufmerksamkeit`** (`hidden: true`, WP-45) — so its „+ Bereich" picker starts with
  „Braucht Aufmerksamkeit" on offer, and `aufmerksamkeit` is *not* in its `[data-section]` list.
- **The project split (WP-48) is in two states on the demo, and project 3 is the appended one.**
  Projects with `layout: NULL` render `kontakte` and `links` as separate half sections side by
  side (spec order); project 3's stored layout predates the split, so its `links` auto-appends
  **last** in its `[data-section]` list at `data-width="half"`. A check that the two sections act
  independently (🗑 one, keep the other) belongs on a `NULL`-layout project, not on project 3.
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
- **A layout assertion reads `[data-section]`/`[data-width]`, not the headings** — the arranger
  stamps both on every rendered section, and in arrange mode the in-card heading is hidden anyway.
- **The demo seeds `artist_layout_saved` but leaves `artist_layout` unset** (both unset under
  `AUFTAKT_DEMO_FRESH`), so „Gespeichertes Layout anwenden" is live from the first run while
  „Auf Standard zurücksetzen" starts disabled.
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
  whose accessible name is the German colour („Rot", „Blau", …) and whose face is a letter A, and
  „Standard" removes the colour. There is **no backdrop**, deliberately: a click outside closes the
  menu *and* does what it was aimed at, so a script must not wait for a `.fixed.inset-0` to appear
  or expect one to swallow its next click.
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
- **Project 1's „Technik" group is the only link group with two rows**, so it is the only place a
  reorder is observable, and the group's `sort_order` values are *interleaved* with the other
  groups' (0, 5, 6, 7) — which is the case a per-group reorder must not disturb. The group
  headings are `span.rounded-full` inside the list's `div.space-y-4` and CSS-uppercased.

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
- **The season switcher's menu is `div.absolute.z-40`**, and what WP-55 pinned on it is the pair
  `overflow-y: auto` plus `max-height: min(24rem, 70vh)` — 348.6 px in a 498 px window. Assert
  those rather than „the menu fits", which is true on a short list whatever the CSS says: the demo
  has three seasons and a run's own fixtures only take it to eight.

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

## What is not verified this way

The Electron half — dialogs, relaunch, the packaged app against a real data directory — has its own
checklist in [BACKUP-TESTING.md](BACKUP-TESTING.md), to be run on macOS **and** Windows before a
release. It covers what no headless run can.
