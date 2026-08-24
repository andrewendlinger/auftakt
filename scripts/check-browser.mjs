/**
 * Regression guard for the paths that only exist once a browser has laid the page out — the
 * class of defect `npm run typecheck`, `check:unit` and the three API gates all structurally
 * cannot see. It boots the real stack against the demo dataset and drives it with Chromium.
 *
 *   npm run check:browser
 *
 * It is deliberately **not** part of `npm run check`: that must stay runnable on any machine at
 * any moment, and this needs a browser binary plus a free :5317. CI runs it as its own `browser`
 * job on every pull request, the way `check:package` runs in the build job.
 *
 * Two halves, both lifted from work that was previously verified from a throwaway scratchpad:
 * the two-window season matrix (a window is a *page in one context* — BroadcastChannel is
 * partitioned per context, season pins live in per-page sessionStorage), and the core paths the
 * manual Windows hour walks anyway (create and complete a task, show and hide a column, save the
 * editor). WP-64a added the record delete with its Papierkorb and undo, and reordering by the ⠿
 * (I–K); WP-64b the two pure render assurances that had no automated check at all (L–N2) — the
 * smallest window the app allows, and the print sheets, which are asserted against the bytes of
 * `page.pdf()` because their defects exist only on paper.
 *
 * **The proof that this gate bites**: revert `client/src/main.tsx`'s focus listener to
 * `handleFocus(true)` (the #54 latch) and case A must fail. That case asserts the *second* focus
 * refetches, because the defect's failure mode is silence — a check that watches the first focus
 * passes against the bug.
 *
 * Every wait and selector here is a trap out of `docs/VERIFYING.md`; each produced a wrong
 * verification result at least once. That file stays the specification — a new trap is written
 * down there first and encoded here second.
 *
 * Two things it does to the working tree, both by design: it **rebuilds `.demo`** (so whatever
 * you were looking at is gone), and it refuses to start while :5317 or :4325 are taken, since a
 * running `npm run demo` would otherwise have its database replaced underneath it.
 */
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 4317 is the dev server, 4319/4321/4323 belong to check:backup/check:dates/check:api. The
// client cannot move: ALLOWED_ORIGINS is built from CLIENT_DEV_PORT = 5317, so a Vite on any
// other port makes every write fail with a bare 403 that reads exactly like a broken feature.
const PORT = 4325;
const UI = 'http://localhost:5317';
const API = `http://localhost:${PORT}/api`;

const RUN = Date.now().toString(36).slice(-5);
/** Every fixture season carries this prefix, so `finally` can sweep leftovers of a killed run. */
const FIXTURE = 'check:browser';

let failures = 0;
let checks = 0;
function check(name, ok, detail = '') {
  checks++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
  return ok;
}

// ---------------------------------------------------------------------------- the server

/**
 * `Response.json()` is typed `Promise<unknown>` and every assertion below reads a field off the
 * result; narrowing each would mean restating the API's response shape inside the script whose
 * job is to catch the server disagreeing with it.
 * @returns {Promise<any>}
 */
async function api(path, init) {
  const res = await fetch(`${API}${path}`, init);
  return res.json().catch(() => ({}));
}

/**
 * Bind an API path to one season, for the fixture seasons the cases below work in.
 *
 * `?season=` is the header's twin — the middleware takes either, and a bare `fetch` has no header
 * to send. One factory rather than one closure per case: the two differ only in the id, and a
 * second copy is how the query-vs-`?` branch would start disagreeing with itself.
 */
const scoped = (id) => (path) => `${path}${path.includes('?') ? '&' : '?'}season=${id}`;

/** @returns {Promise<{ status: number, body: any }>} */
async function send(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/**
 * Is anything listening there? Asked per address, because that is where the trap is.
 *
 * Express binds `127.0.0.1` explicitly, but **Vite binds `[::1]` and only that** — it passes the
 * bare hostname `localhost` to `listen`, and on macOS Node resolves that to `::1` first. A probe
 * on `127.0.0.1:5317` therefore binds happily *while a dev server is running on the same port*
 * and reports it free, which is the one answer this guard must never give. `EADDRNOTAVAIL` means
 * the family is not configured (a runner without IPv6) — that is a free port, not a busy one.
 */
async function busy(port, host) {
  const probe = createServer();
  try {
    await /** @type {Promise<void>} */ (
      new Promise((res, rej) => {
        probe.once('error', rej);
        probe.listen(port, host, () => res());
      })
    );
  } catch (err) {
    if (err?.code === 'EADDRINUSE') return true;
    if (err?.code === 'EADDRNOTAVAIL' || err?.code === 'EAFNOSUPPORT') return false;
    throw err;
  }
  await new Promise((res) => probe.close(res));
  return false;
}

/**
 * Refuse to run while anything holds either port — **before the stack is spawned**, because
 * spawning it is already the destructive act: `demo.mjs`'s first move is `demo:seed`, which
 * `rmSync`s `.demo`. A guard that runs afterwards only races the rebuild it exists to prevent.
 *
 * Not politeness: this rebuilds `.demo` from nothing, so starting beside a running `npm run demo`
 * would leave that session's server answering from a deleted inode — the trap `docs/VERIFYING.md`
 * records as costing a full verification run. And the second stack would not even be the one under
 * test: Vite's port is `strictPort`, so it exits rather than sliding to 5318 where every write
 * would 403 on the origin check.
 */
async function requireFreePorts() {
  for (const port of [PORT, 5317]) {
    for (const host of ['127.0.0.1', '::1']) {
      if (!(await busy(port, host))) continue;
      console.error(
        `FAIL  Port ${port} ist belegt (${host}) — vermutlich ein laufendes \`npm run demo\` oder\n` +
          `      ein übrig gebliebener Server. Dieser Lauf würde dessen Datenbank neu aufbauen.\n` +
          `      Beenden mit:  lsof -ti tcp:4325 -ti tcp:5317 | xargs kill\n` +
          `      (das -i muss wiederholt werden — macOS' lsof liest das zweite tcp: sonst als Datei)`,
      );
      process.exit(1);
    }
  }
}

/**
 * The stack is `scripts/demo.mjs`, not a hand-rolled spawn pair: it already rebuilds `.demo`
 * before starting, already runs the two dev servers in their own process group and already
 * reaps that group. `AUFTAKT_PORT` reaches both halves — the server binds it and Vite proxies
 * `/api` to it (client/vite.config.ts) — and `server/src/demo.ts` pins `AUFTAKT_DATA_DIR` to
 * `<repo>/.demo` itself and refuses an inherited one, so this cannot touch `.data/`.
 */
/** @type {import('node:child_process').ChildProcess | null} */
let stack = null;
/** Last ~8 KB of the stack's output, dumped when it fails to come up or a case explodes. */
let stackLog = '';

function startStack() {
  stack = spawn(process.execPath, [join(root, 'scripts', 'demo.mjs')], {
    cwd: root,
    env: { ...process.env, AUFTAKT_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  for (const s of [stack.stdout, stack.stderr]) {
    s.setEncoding('utf8');
    s.on('data', (chunk) => {
      stackLog = (stackLog + chunk).slice(-8000);
    });
  }
}

function killStack() {
  if (!stack?.pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(stack.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      process.kill(-stack.pid, 'SIGTERM'); // negative pid = the whole process group
    }
  } catch {
    /* already gone */
  }
}

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  killStack();
}
process.on('exit', cleanup);

async function shutdown(code) {
  killStack();
  if (stack) await Promise.race([once(stack, 'exit'), new Promise((r) => setTimeout(r, 3000))]);
  cleanup();
  process.exit(code);
}

// A run takes a minute, so Ctrl-C during it is normal. Without a listener Node terminates via
// the default signal action, never emits 'exit', and leaves the whole dev tree behind.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void shutdown(130);
  });
}

/**
 * Both halves have to answer: the API on :4325 and Vite on :5317.
 *
 * A dead stack ends the wait immediately rather than at the deadline — `demo.mjs` exits within a
 * second when the seed fails, and two minutes of polling a process that is gone reports „kam nicht
 * hoch" for what is really a seeding error sitting in `stackLog`.
 */
async function waitForStack() {
  const deadline = Date.now() + 120_000;
  let apiUp = false;
  while (Date.now() < deadline) {
    if (stack?.exitCode != null) {
      throw new Error(`Stack ist beendet (Code ${stack.exitCode})\n${stackLog}`);
    }
    try {
      if (!apiUp) apiUp = (await fetch(`${API}/health`)).ok;
      if (apiUp && (await fetch(UI)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Stack kam nicht hoch (API ${apiUp ? 'ok' : 'stumm'})\n${stackLog}`);
}

/**
 * Believe nothing until the server is the *demo* server. A stale process answering from a
 * deleted inode passes both documented confirmations, so this is the cheap third one.
 */
async function assertDemo() {
  const reg = await api('/seasons');
  if (!String(reg.activeFile ?? '').includes(`${'/'}.demo/`)) {
    throw new Error(`Server auf :${PORT} ist nicht der Demo-Server (activeFile=${reg.activeFile})`);
  }
  return reg;
}

// ---------------------------------------------------------------------------- the browser

/** The window every case but L runs in — comfortably wider than anything the app needs. */
const WIDE = { width: 1400, height: 1000 };

/**
 * The two viewports the smallest window the app allows really produces (WP-55, case L).
 *
 * `MINIMUM` is 624×560, but that is the *window*: `useContentSize` is false, so the frame comes
 * off before the renderer sees anything. Driving at 624×560 checks a window nobody has.
 */
const NARROW = [
  // Windows 11, whose frame a customer's boot log measures at 14×62.
  { label: 'Windows', width: 610, height: 498 },
  // macOS takes nothing off the sides.
  { label: 'macOS', width: 624, height: 532 },
];

/**
 * The width `TaskSortEditor`'s `<select>` has while it still holds nothing but „Spalte wählen…" —
 * measured at both narrow viewports. It is the *stuck* state case L must not measure in, and the
 * reference the precondition there asks to have been left behind; the healthy width is a layout
 * number (412 px at 610, 424 at 624) and deliberately not asserted.
 */
const PLACEHOLDER_SELECT_PX = 181;

/**
 * One context per window *size*. `reducedMotion: 'reduce'` is the documented escape hatch: it
 * removes the boot overlay outright (DECISIONS.md) instead of racing its phases. The overlay does
 * not exist on the dev server anyway, but row animations do.
 *
 * A second context is only ever *wrong* for the cross-window cases — see `windows`, where the
 * whole point is that BroadcastChannel is partitioned per context. A viewport is the one thing
 * that cannot be shared, and `setViewportSize` on a page laid out at 1400 measures a reflow
 * rather than a first layout, which is not the state a user's window is ever in.
 */
const windowContext = (browser, viewport) =>
  browser.newContext({ reducedMotion: 'reduce', viewport });

async function launch() {
  const browser = await chromium.launch();
  return { browser, context: await windowContext(browser, WIDE) };
}

/** Interactive, not `networkidle` — which lies when a query 500s or hangs. */
const ready = (page, timeout = 20_000) =>
  page.waitForSelector('html[data-app-ready]', { timeout }).then(() => page);

/**
 * `#/dashboard` is Übersicht; bare `#/` is the season landing page — different screens.
 *
 * `prepare` runs on the fresh page *before* the first navigation, which is the only moment an
 * init script can be installed — `stubElectron` below has to be in place before the renderer
 * looks for `window.auftakt`, and a page that has already loaded cannot be given one.
 */
async function open(context, hashPath = '/dashboard', prepare) {
  const page = await context.newPage();
  page.on('pageerror', (e) => check(`no page error (${hashPath})`, false, e.message));
  if (prepare) await prepare(page);
  await page.goto(`${UI}/#${hashPath}`);
  return ready(page);
}

/**
 * Several Electron-shaped windows: one context, N pages. Never `newContext()` twice —
 * BroadcastChannel is partitioned per context, so a cross-window check against two contexts
 * passes vacuously, nothing having been delivered and nothing expected.
 */
async function windows(context, n = 2, hashPath = '/dashboard') {
  const pages = [];
  for (let i = 0; i < n; i++) pages.push(await open(context, hashPath));
  return pages;
}

/**
 * Pin a window to a season. The pin — and the fresh QueryClient that goes with it — apply only
 * with a *document* reload; a hash `goto` after setting it renders the old season's cache and
 * reads as "pinning is broken" against working code.
 */
async function pin(page, id, hashPath = '/dashboard') {
  await page.evaluate((v) => sessionStorage.setItem('auftakt-season', v), String(id));
  await page.goto(`${UI}/#${hashPath}`);
  await page.reload();
  return ready(page);
}

const seasonPin = (page) => page.evaluate(() => sessionStorage.getItem('auftakt-season'));

/** The header switcher's chip, minus its ▾. */
const chip = async (page) =>
  (await page.locator('button[title$="wechseln"]').first().innerText()).replace('▾', '').trim();

/**
 * Toasts stack and hold 6 s, so filter by the text under test — never `.first()`, never a sleep.
 *
 * Six seconds is also a *deadline*: `ToastProvider` dismisses on a plain `setTimeout` and hovering
 * does not pause it, so anything that has to click a toast's own button must do so before the
 * assertions that merely read the state it announced.
 */
const toast = (page, re) => page.locator('.pointer-events-auto').filter({ hasText: re });

/**
 * A card, addressed by text it contains — `Card` is the app's `div.rounded-2xl`, and the headings
 * inside it are CSS-uppercased, so `hasText` (case-insensitive, substring) is the handle that
 * survives that. Every selector inside a settings card goes through this rather than through the
 * page: „Speichern", `input[type="number"]` and `<select>` are all ambiguous on a tab that holds
 * four cards.
 */
const cardWith = (page, text) => page.locator('div.rounded-2xl').filter({ hasText: text });

/**
 * The topmost dialog. Every `Modal` is a `div.fixed.inset-0` and the newest is the last of them.
 *
 * Scoping to it is not tidiness: the task table's row 🗑 carries `title="Löschen"`, so a page-wide
 * button selector is ambiguous on any page that has tasks on it — and this is also what makes
 * „Löschen" addressable inside *two stacked* dialogs.
 */
const topDialog = (page) => page.locator('.fixed.inset-0').last();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * „It is there" — and the reason it is a wait rather than a `count()`.
 *
 * `ready()` resolves on `html[data-app-ready]`, which `BootReady` also sets from an
 * **unconditional** 700 ms budget (`DATA_BUDGET_MS`, the escape hatch for a first load whose query
 * is retrying), so a page can be „ready" with its queries still in flight. A one-shot count taken
 * straight after `reload()` therefore reads 0 against working code on a slow runner. Wait for the
 * node, then count it.
 */
const shown = (locator, timeout = 10_000) =>
  locator
    .first()
    .waitFor({ timeout })
    .then(() => true)
    .catch(() => false);

/**
 * „It is gone", as a wait rather than as a count.
 *
 * An undo toast commits a React round *before* the unmount it announces — the toast's setState
 * and TanStack's cache notification land in different batches — so a `count()` read the moment
 * the toast is on screen races the second batch and fails against working code. A locator that
 * matches nothing satisfies `detached` immediately, which is why every caller below asserts the
 * node was there *first*.
 */
const gone = (locator, timeout = 10_000) =>
  locator
    .first()
    .waitFor({ state: 'detached', timeout })
    .then(() => true)
    .catch(() => false);

/**
 * Poll `read()` until `ok` accepts the answer, then hand the last value back — the *caller* still
 * makes the assertion, so a run that never reaches the expected state fails with the value that
 * was really there instead of with a bare timeout.
 *
 * Every drag and every undo below is one request behind the gesture that triggered it, and a
 * fixed sleep there is a coin toss in both directions (the scratchpad scripts this gate lifts
 * slept 600 ms after each drag and 200 ms × 20 after an undo).
 *
 * @template T
 * @param {() => Promise<T>} read
 * @param {(v: T) => boolean} ok
 * @returns {Promise<T>}
 */
async function until(read, ok, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let last = await read();
  while (!ok(last) && Date.now() < deadline) {
    await sleep(150);
    last = await read();
  }
  return last;
}

/**
 * Press and hold the primary button on a row's ⠿ — the first half of a drag, and the half that
 * decides whether there is one at all.
 *
 * Every reorderer runs `useDragReorder` in `mode: 'armed'`, so the row is not `draggable` until a
 * primary-button `pointerdown` lands on its handle: `locator.dragTo()` on the row body is a
 * silent no-op that reads as „reordering is broken". Match the title with `^=`, never `=` — in a
 * link list *with* categories the tooltip carries the qualifier and an exact match finds nothing.
 */
async function grabHandle(page, row) {
  await row.scrollIntoViewIfNeeded();
  await row.hover(); // the handle is `opacity-40` at rest (WP-35) and hit-testable either way
  const h = await row.locator('[title^="Zum Verschieben ziehen"]').first().boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
}

/**
 * Carry a held pointer onto `target`: interpolated steps, then a 2-px nudge.
 *
 * Both halves are load-bearing. Chromium only turns a press into a native drag once the pointer
 * has actually travelled, so a single `mouse.move` to the destination starts nothing; and the
 * last `dragover` before the release is what sets the drop target, so a move that ends exactly on
 * the previous coordinate can leave `overKey` where the run before it was.
 */
async function dragOver(page, target) {
  const t = await target.boundingBox();
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 25 });
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2 + 2, { steps: 5 });
}

/** The whole gesture: grab the ⠿, carry, release. */
async function dragHandleOnto(page, source, target) {
  await grabHandle(page, source);
  await dragOver(page, target);
  await page.mouse.up();
}

// ---------------------------------------------------------------------------- the bridge, stubbed
//
// Two of the app's surfaces only exist when `window.auftakt` does — the update card (WP-60) and
// the diagnostics half of the feedback dialog (WP-54) — and neither may be driven for real: the
// real `saveDiagnostics` writes a file to the desktop of whoever runs this, and the real
// `installUpdate` downloads a release. So the preload bridge is replaced by one that **records**
// instead — which is also the instrument for WP-66's promise that nothing opens by itself: a call
// that no longer happens is a recorder that stays empty.
//
// Ported from `~/.claude/tools/playwright/lib/drive.mjs` rather than imported: that module is the
// ad-hoc runtime's, it imports `playwright` (this gate has only `playwright-core`) and it points at
// :4317. The pattern is the shared part and it stays documented there; this is its committed copy.

/**
 * Install the recording bridge. Must run before the first navigation — see `open`'s `prepare`.
 *
 * `opts.platform` and the two update answers are parameters because the card branches on them and
 * each branch fails *silently* on the wrong value: without `canInstall` the „Herunterladen &
 * installieren" button is simply not in the DOM and the click waits out its timeout.
 *
 * @param {import('playwright-core').Page} page
 * @param {{ platform?: string, silent?: unknown, manual?: unknown }} opts
 */
const stubElectron = (page, opts = {}) =>
  page.addInitScript((o) => {
    const w = /** @type {any} */ (window);
    // Recorders, not spies: a `mailto:` is fire-and-forget, so the URL handed to `openExternal`
    // is the only observable the feedback dialog produces at all.
    w.__external = [];
    w.__saved = [];
    // Replaced by the real subscriber and the real resolver as soon as the update card mounts and
    // its button is clicked; no-ops until then, so a script may call them unconditionally.
    w.__updateProgress = () => {};
    w.__finishUpdate = () => {};
    // Off by default: every save answers at once unless a case asks to hold one open.
    w.__holdSave = false;
    w.__finishSave = () => {};
    w.auftakt = {
      exportDatabase() {},
      importDatabase() {},
      chooseBackupDir() {},
      openExternal(url) {
        w.__external.push(url);
      },
      getVersion: () => Promise.resolve('0.0.0-test'),
      // `refresh` is the card's own distinction: false is the cached silent startup check it
      // reads on mount, true the one „Nach Updates suchen" asks for.
      checkForUpdates: (refresh) => Promise.resolve((refresh ? o.manual : o.silent) ?? null),
      // The percentage is *pushed* from main, so a bridge whose members only answer questions
      // leaves the card frozen in its first frame — which is exactly the frame the WP-60 defect
      // left it in for ever, i.e. a stub that cannot drive this proves nothing about the fix.
      installUpdate: () =>
        new Promise((resolve) => {
          w.__finishUpdate = resolve;
        }),
      onUpdateProgress: (cb) => {
        w.__updateProgress = cb;
        return () => {
          w.__updateProgress = () => {};
        };
      },
      getDiagnostics: () =>
        Promise.resolve({
          summary:
            'Startdiagnose — 2 Einträge (Zeit in UTC):\n' +
            '2026-08-11 12:00 · v0.0.0-test · play/done · bereit 420 · Ende 2100 ms\n' +
            '2026-08-11 12:03 · v0.0.0-test · cross/abort:hitch · bereit 430 · Ende 1800 ms',
          hasLog: true,
          file: '/tmp/Auftakt/boot-log.jsonl',
          system: 'macOS 15.6 · 1728×1117 @2×',
        }),
      // Two things the naive stub got wrong and the dialog depends on (WP-66). It **emulates
      // `uniqueBundleName`**: main never overwrites a bundle already lying on the desktop, so
      // the second save of one reference comes back `…-2.txt` — a stub that always answers
      // `…​.txt` makes the one name the handover must not predict indistinguishable from the
      // one it may. And it can be **held**, like `installUpdate`: with `__holdSave` set the
      // promise parks until `__finishSave()`, which is the only way to observe that „Weiter"
      // waits for the write instead of opening a handover naming a guess.
      saveDiagnostics: (ref, report) => {
        w.__saved.push({ ref, report });
        const n = w.__saved.filter((s) => s.ref === ref).length;
        const name = `Auftakt-Diagnose-${ref}${n > 1 ? `-${n}` : ''}.txt`;
        if (!w.__holdSave) return Promise.resolve({ ok: true, name });
        return new Promise((resolve) => {
          w.__finishSave = () => resolve({ ok: true, name });
        });
      },
      bootSettled: () => Promise.resolve(),
      onBackupConfigChanged: () => () => {},
      platform: o.platform ?? 'darwin',
    };
  }, opts);

// ---------------------------------------------------------------------------- focus

/**
 * Where the focus sits **in the topmost dialog's own tab order** — the index into exactly the list
 * `Modal`'s trap walks, so the WP-42 promises can be asserted as positions instead of as element
 * names that a re-worded button would break.
 *
 * `at: -1` is the answer that matters: focus is on `<body>`, on the page behind the backdrop, or
 * in a portal — all three are „the trap let go", and the first is the state the focus effect
 * exists to prevent. Index 0 is always the header's ✕, so „the dialog focused its first *field*"
 * is `at === 1` and „the forward wrap skipped the ✕" is a walk that never returns to 0.
 *
 * The filter is `tabbables()`'s from `client/src/components/fields.tsx`: a positive `tabIndex`
 * exists nowhere in this app, `[inert]` drops the form while „Änderungen verwerfen?" is up, a
 * disabled „Speichern" would otherwise make the cycle wrap one element early, and
 * `getClientRects()` drops what is rendered but not shown.
 */
const tabStop = (page) =>
  page.evaluate(() => {
    // The **last** card, not the first: a Modal opened out of another one is rendered inside it
    // (the feedback dialog's „So schickst du es ab"), so document order puts the topmost last. A
    // `PillSelect` menu's click-away layer is a `.fixed.inset-0` with no card in it and never
    // matches here.
    const card = [...document.querySelectorAll('.fixed.inset-0 > div')].pop() ?? null;
    const items = card
      ? Array.from(
          card.querySelectorAll(
            'a[href], button, input, select, textarea, [contenteditable="true"], [tabindex]',
          ),
        ).filter(
          (el) =>
            /** @type {HTMLElement} */ (el).tabIndex >= 0 &&
            !el.hasAttribute('disabled') &&
            !el.closest('[inert]') &&
            el.getClientRects().length > 0,
        )
      : [];
    const at = items.indexOf(document.activeElement);
    const el = items[at];
    return {
      at,
      n: items.length,
      tag: el?.tagName ?? document.activeElement?.tagName ?? 'BODY',
      text: (el?.textContent ?? '').trim().slice(0, 24),
    };
  });

/**
 * „Is anything on this page out of reach at this width?" — evaluated inside the page, so both
 * halves sample one layout. Serialised to Chromium by `page.evaluate`, so it may close over
 * nothing but the DOM.
 *
 * The first half is `documentElement.scrollWidth <= clientWidth`. On its own it is not enough:
 * an element that overhangs inside a box that *clips* never grows the document at all, so a page
 * would pass while a card row is cut off and unreachable — which is the WP-55 defect class this
 * case exists for.
 *
 * The second half is the sweep, and what it has to get right is **why** a box may be wider than
 * the window. Three verdicts, taken at the nearest ancestor that constrains the horizontal axis:
 *
 * - `auto` / `scroll` → the content is reachable by scrolling, which is exactly what the task
 *   table does by design (WP-55). Exempt. Note that a box with `overflow-y: auto` and nothing set
 *   on x computes to `auto` on x as well (CSS: a `visible` paired with a non-`visible` becomes
 *   `auto`), so every dialog and popover with a vertical scroller exempts its subtree too. That
 *   is still „reachable by scrolling", but it is the sweep's blind spot and worth knowing.
 * - `hidden` / `clip` → the box cuts the content off instead of offering it. Reported, but only
 *   when the element really is cut: an element that fits *inside* its clipper is fine, and if the
 *   clipper itself overhangs the window then the clipper is the offender and reports itself on
 *   its own turn through the loop.
 * - nothing at all → the element is simply wider than the page. Reported.
 */
function overflowReport() {
  const de = document.documentElement;
  const vw = de.clientWidth;
  /** @type {string[]} */
  const offenders = [];
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const r = el.getBoundingClientRect();
    // A zero box is `hidden`, a collapsed wrapper or an unmounted portal — never an overhang.
    if (r.width === 0 || r.height === 0) continue;
    // One pixel of slack: a fractional layout width rounds up against an integer viewport.
    if (r.right <= vw + 1) continue;
    let verdict = 'page';
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'visible') continue;
      if (ox === 'auto' || ox === 'scroll' || ox === 'overlay') {
        verdict = 'scrollbar';
        break;
      }
      verdict = r.right <= p.getBoundingClientRect().right + 1 ? 'inside' : 'cut';
      break;
    }
    if (verdict === 'scrollbar' || verdict === 'inside') continue;
    const id = el.id ? `#${el.id}` : '';
    const cls =
      typeof el.className === 'string' && el.className
        ? `.${el.className.split(' ').slice(0, 2).join('.')}`
        : '';
    offenders.push(
      `${el.tagName.toLowerCase()}${id}${cls} bis ${Math.round(r.right)}${verdict === 'cut' ? ' (abgeschnitten)' : ''}`,
    );
  }
  return { scrollWidth: de.scrollWidth, clientWidth: vw, offenders };
}

/**
 * Hang a probe off `body`, measure it with **the shipped sweep**, take it away again.
 *
 * The measurement has to go through `overflowReport` itself rather than through a second copy of
 * its loop: a control that re-implements the thing it is controlling validates the copy. The
 * function closes over nothing, so `page.evaluate` can serialise it as it stands.
 */
async function sweepWithProbe(page, markup) {
  await page.evaluate((html) => {
    const host = document.createElement('div');
    host.id = 'auftakt-probe-host';
    host.innerHTML = html;
    document.body.appendChild(host);
  }, markup);
  const report = await page.evaluate(overflowReport);
  await page.evaluate(() => document.getElementById('auftakt-probe-host')?.remove());
  return report;
}

/** `staleTime: 5_000` — a focus inside five seconds of the last fetch legitimately refetches nothing. */
const STALE_MS = 5_000;

// ---------------------------------------------------------------------------- the PDF
//
// The print sheets are the one surface whose defects exist *only on paper*: `page.pdf()`'s
// default `printBackground: false` is itself the SHL-11 repro, and a screenshot can never show
// that class of bug because screenshots always paint backgrounds. So the print cases assert
// against the PDF's own bytes.
//
// Chromium writes a plain PDF 1.4 — classic `n 0 obj` bodies, an xref table, no object streams —
// with FlateDecode content streams, so `node:zlib` is the whole of what is needed to read one and
// no dependency is added for it. Text is hex glyph ids against a subset font, which is why
// nothing below reads *words*: paging assertions are made on paint order and on fill colours,
// both of which survive without the font's ToUnicode map (docs/VERIFYING.md says the same about
// pdfjs-dist, which is the other way and is a dependency).

/** Object `num`'s dictionary as latin1 — it stops at `stream`, so it never carries binary. */
function pdfDict(raw, num) {
  const at = raw.indexOf(`\n${num} 0 obj`);
  if (at < 0) return '';
  const end = raw.indexOf('endobj', at);
  const stream = raw.indexOf('stream', at);
  return raw.slice(at, stream >= 0 && stream < end ? stream : end);
}

/**
 * Object `num`'s stream, inflated when the dictionary says FlateDecode.
 *
 * Sliced by the dictionary's own `/Length` rather than by searching for `endstream`: a compressed
 * stream is arbitrary bytes and may well contain that word, and a regex over the whole file would
 * then hand back a truncated — or a spliced — stream that inflates to nothing.
 */
function pdfStream(raw, buf, num) {
  const at = raw.indexOf(`\n${num} 0 obj`);
  const m = /stream\r?\n/.exec(raw.slice(at));
  if (at < 0 || !m) return '';
  const dict = pdfDict(raw, num);
  const start = at + m.index + m[0].length;
  const bytes = buf.subarray(start, start + Number(/\/Length (\d+)/.exec(dict)?.[1] ?? 0));
  if (!/FlateDecode/.test(dict)) return bytes.toString('latin1');
  try {
    return inflateSync(bytes).toString('latin1');
  } catch {
    return '';
  }
}

/**
 * The decoded content stream of every page, **in page order** — which is the `/Kids` array's
 * order, not the order the objects happen to be written in.
 */
function pdfPages(buf) {
  const raw = buf.toString('latin1');
  const kids = /\/Type\s*\/Pages[^>]*\/Kids\s*\[([^\]]*)\]/.exec(raw);
  if (!kids) throw new Error('kein /Pages-Knoten im PDF');
  return [...kids[1].matchAll(/(\d+) 0 R/g)]
    .map((m) => pdfDict(raw, Number(m[1])))
    .map((dict) => {
      const one = /\/Contents (\d+) 0 R/.exec(dict);
      const many = /\/Contents \[([^\]]*)\]/.exec(dict);
      const refs = one
        ? [Number(one[1])]
        : [...(many?.[1] ?? '').matchAll(/(\d+) 0 R/g)].map((r) => Number(r[1]));
      return refs.map((r) => pdfStream(raw, buf, r)).join('\n');
    });
}

/** `rgb(11, 95, 233)` → `[11, 95, 233]`, so the expectation can be read off the page itself. */
const rgbOf = (css) => (css.match(/\d+/g) ?? []).slice(0, 3).map(Number);

/** Skia rounds its own way, and a `.7255 .1098 .1098 rg` is 185,28,28 only to within a unit. */
const nearRgb = (a, b) => a.length === 3 && b.length === 3 && a.every((v, i) => Math.abs(v - b[i]) <= 2);

/** Every non-stroking fill a content stream sets, as `[r,g,b]` 0..255, in paint order. */
const pdfFills = (content) =>
  [...content.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) rg/g)].map((m) => ({
    rgb: [Math.round(Number(m[1]) * 255), Math.round(Number(m[2]) * 255), Math.round(Number(m[3]) * 255)],
    at: m.index ?? 0,
  }));

/** One parse per PDF: the pages, and every fill on all of them. */
function sheet(buf) {
  const pages = pdfPages(buf);
  return { buf, pages, fills: pages.flatMap((p) => pdfFills(p)) };
}

const painted = (s, css) => s.fills.some((f) => nearRgb(f.rgb, rgbOf(css)));

/** How often the sheet fills in that colour — „once" is what pins a fill to one element. */
const paintedTimes = (s, css) => s.fills.filter((f) => nearRgb(f.rgb, rgbOf(css))).length;

/**
 * Where a colour is painted in the sheet, and how much text sits before and after it *on that
 * page*. Both counts are of text-showing operators, not of words: one `Tj` is one glyph run, and
 * how many glyphs a run holds is a property of the font, not of the layout — so the numbers are
 * only ever compared against another measurement of the same document, never against a constant.
 */
function paintedAt(s, css) {
  const want = rgbOf(css);
  for (let i = 0; i < s.pages.length; i++) {
    const hit = pdfFills(s.pages[i]).find((f) => nearRgb(f.rgb, want));
    if (!hit) continue;
    const text = [...s.pages[i].matchAll(/T[jJ]/g)].map((m) => m.index ?? 0);
    return {
      page: i + 1,
      pages: s.pages.length,
      before: text.filter((t) => t < hit.at).length,
      after: text.filter((t) => t > hit.at).length,
    };
  }
  return { page: 0, pages: s.pages.length, before: 0, after: 0 };
}

const where = (p) => `Seite ${p.page}/${p.pages}, ${p.before} Textläufe davor, ${p.after} danach`;

/**
 * A4, not `page.pdf()`'s default Letter. The print block's numbers are A4's — „A4 inside the
 * 14 mm @page margins leaves ~269 mm" is what the image cap is derived from — and the customer's
 * printer is a German one, so Letter would measure a page nobody prints.
 *
 * `printBackground` is left at its default `false` **on purpose**: that is the SHL-11 repro, and
 * passing `true` would make every colour assertion below pass against the defect.
 */
const printPdf = (page) => page.pdf({ format: 'A4' });

/**
 * Take a second PDF with one print rule overridden, and hand back both — the in-run proof that a
 * paper assertion is about the rule under test rather than about something Chromium does anyway.
 *
 * The override is `!important` inside `@media print`, which beats index.css on cascade rather
 * than on order, and the tag is removed again so the page is the shipped one afterwards.
 */
async function withoutPrintRule(page, css) {
  const tag = await page.addStyleTag({ content: `@media print { ${css} }` });
  const buf = await printPdf(page);
  await tag.evaluate((el) => {
    el.parentNode?.removeChild(el);
  });
  return sheet(buf);
}

// ---------------------------------------------------------------------------- the run

await requireFreePorts();
startStack();
await waitForStack();
const registry = await assertDemo();
const HOME = registry.activeId; // the demo's own default season; every case returns to it

console.log(`\ndemo auf :${PORT}, Saison ${HOME} — ${registry.seasons.length} Saisons\n`);

/** @type {import('playwright-core').Browser | null} */
let browser = null;

async function makeSeason(what, copy = false) {
  const body = { label: `${FIXTURE} ${RUN} ${what}` };
  if (copy) {
    Object.assign(body, {
      copyFrom: HOME,
      includeArtists: true,
      includeContacts: true,
      includeEvents: true,
      includeProjects: true,
      includeTasks: true,
      includeColumns: true,
      includeSettings: true,
    });
  }
  const { status, body: season } = await send('POST', '/seasons', body);
  if (status !== 201) throw new Error(`Saison „${what}“ nicht angelegt: ${JSON.stringify(season)}`);
  return season;
}

/**
 * How many tasks the first status group starts with, and the lengths case N2 tries around it.
 *
 * The offsets are symmetric, and that is the point: the boundary can drift in **either**
 * direction — a Chromium that changes a metric, or one line more or less of sheet chrome — and a
 * search that only ever grows the list would report „keine Wirkung" on a perfectly good build,
 * reading exactly like the regression it guards. Nearest first, so the normal run stops at 0.
 */
const PAGE_BREAK_FIRST = 56;
const PAGE_BREAK_TRIES = [0, 1, -1, 2, -2, 3, -3];

/**
 * The project sheet's page-break fixture: one project whose open tasks fall into two status
 * groups, the first sized so the second group's header lands on a page boundary.
 *
 * Built over the API into a fresh season rather than into `server/src/demo.ts`, for two reasons.
 * Sixty-odd rows named „Aufgabe 07" are not a fixture anybody wants to scroll past on every
 * `npm run demo`, and — more to the point — the sheet's geometry has to be *predictable* for the
 * boundary to sit where it does: no description, no contacts, no events, nothing that wraps. Every
 * line height on this sheet is an explicit Tailwind value, so the page a row lands on is the same
 * on a runner with different fonts, which is what lets a tuned count survive CI at all.
 *
 * The project deliberately carries **no status**: `ProjectStatusPill` would then paint the header
 * in the same shade as the „In Progress" group heading, and the case finds that heading in the PDF
 * by its colour.
 */
async function fillPageBreakFixture(seasonId) {
  const q = scoped(seasonId);
  // Never the literals: the group headings, their colours and the values a task must carry are
  // all the Status column's options, which the user may rename or reorder.
  const columns = await api(q('/custom-columns'));
  const status = columns.find((c) => c.kind === 'builtin' && c.key === 'status');
  const open = JSON.parse(status?.options ?? '[]').filter((o) => !o.done);
  if (open.length < 2) throw new Error(`Statusspalte hat keine zwei offenen Optionen: ${status?.options}`);

  const artist = (await send('POST', q('/artists'), { name: 'Druckbogen', color: '#0b5fe9' })).body;
  const project = (
    await send('POST', q('/projects'), { artist_id: artist.id, code: 'DB1', name: 'Seitenumbruch' })
  ).body;
  const add = (title, value) => send('POST', q('/tasks'), { project_id: project.id, title, status: value });
  /** @type {number[]} */
  const firstGroup = [];
  for (let i = 0; i < PAGE_BREAK_FIRST; i++) {
    firstGroup.push((await add(`Aufgabe ${String(i + 1).padStart(2, '0')}`, open[0].value)).body.id);
  }
  // The second group is the one under test, and it is small: a header stranded above six rows is
  // the shape the customer met, and a long group would be split by the page break anyway.
  for (let i = 0; i < 6; i++) await add(`Nachlauf ${i + 1}`, open[1].value);

  /**
   * Take the first group to exactly `n` rows, in whichever direction that is. Shrinking is a soft
   * delete, which is what the sheet's own query filters on, so it is the same fixture either way.
   */
  const resize = async (n) => {
    while (firstGroup.length > n) {
      await send('DELETE', q(`/tasks/${firstGroup.pop()}`));
    }
    while (firstGroup.length < n) {
      firstGroup.push((await add(`Aufgabe ${String(firstGroup.length + 1).padStart(2, '0')}`, open[0].value)).body.id);
    }
    return firstGroup.length;
  };
  return { seasonId, project, resize };
}

try {
  const { browser: chrome, context } = await launch();
  browser = chrome;

  const data = await makeSeason('Daten', true);
  // Copied **here**, before any case has written anything, though they are not used until I and
  // J. The delete case asserts on the dependent counts docs/VERIFYING.md pins („3 Aufgaben" for
  // project 2, „14 Aufgaben" for artist 3), and case F creates a task on project 2 of the demo's
  // own season while case H edits that project's description — a copy taken afterwards inherits
  // both and reads „4 Aufgaben", which is the fixture drifting, not a defect.
  const trash = await makeSeason('Löschen', true);
  const sorted = await makeSeason('Reihenfolge', true);
  // Case N prints demo rows and needs one of them changed (project 1 loses its status pill, see
  // there), so it gets a copy like the cases above — taken here, before anything has written.
  const sheets = await makeSeason('Bögen', true);
  // Case N2's page-break fixture is the one season that is **not** a copy: its whole point is a
  // task list of a tuned length, and a copy would bring the demo's along. Built here with the
  // others all the same, so a season this run created is never a season an earlier case wrote to.
  const printed = await makeSeason('Druck');
  // Cases O–R2 *rewrite* settings — the sort hierarchy, the option lists, the two windows — so they
  // work in a copy of their own rather than in the demo every other case reads. Taken here with the
  // rest: the assertions below start from the seeded values („eine Regel: Status", four event
  // types), and a copy taken later would carry whatever an earlier case had left behind.
  const config = await makeSeason('Einstellungen', true);
  // Cases X–Z create, complete and delete inside the demo's own subtask tree, so they need a copy
  // like the cases above — taken here, before anything has written, because the counts they assert
  // („1/3" live children, „4 Unteraufgaben" including the archived one) are fixture facts of the
  // demo as seeded. Case W needs no copy: folding a group writes nothing at all.
  const subtree = await makeSeason('Unteraufgaben', true);
  // Cases AA–AC type into two notes and save them — project 2's description and task 30's
  // comment, the two the demo plants for exactly this (`docs/VERIFYING.md`, „a short, plain note
  // to colour and un-colour"). A copy for the same reason as the others, and taken here: case H
  // edits that very description in the demo's own season, so a copy made later would start from
  // its „Nachtrag" and the assertions below would be reading an earlier case's fixture.
  const toolbox = await makeSeason('Werkzeugleiste', true);
  // Cases AD–AG put a picture into project 2's description, paste two more beside it, save artist
  // 1's note and bin a project — so, like the copies above, a season of their own, taken before
  // anything has written. It has to be a *different* one from `toolbox`: AA–AC grow their runs in
  // the same short note, and a picture in it would move every offset they count.
  const pictures = await makeSeason('Bilder', true);
  // Cases AJ–AK build three tasks around the archive cutoff, and this season is deliberately **not**
  // a copy: the boundary is only legible when the whole task list is those three rows, and a copy
  // would bring the demo's five archived ones along. Created here with the rest all the same.
  const agedSeason = await makeSeason('Grenze');
  // Cases AL–AO build four project-scoped columns of their own on project 2, write values into
  // them and then hide three of the demo's global ones on that page — so a copy of their own,
  // taken here before anything has written, like every other one. Project 2 is the page that makes
  // the polls below honest: three open tasks, no subtasks, and `custom_values` empty on all three,
  // so nothing a case waits for can be satisfied by a value the demo already planted.
  const columnsSeason = await makeSeason('Typen', true);
  const pageBreak = await fillPageBreakFixture(printed.id);

  // ======================================================================== A · the #54 canary
  //
  // The focus listener behind `refetchOnWindowFocus` is the backstop under the cross-window
  // broadcast. `handleFocus(true)` routed it through query-core's `setFocused`, a no-op once
  // `#focused` already holds that value — and two windows side by side are both permanently
  // visible, so `visibilitychange` never resets it. The backstop fired once per window lifetime
  // and was silent afterwards (#54).
  //
  // Which is why the assertion is on the SECOND focus. A case that only watches the first one
  // passes against the defect.
  console.log('A · Fokus-Refetch (#54)');
  const [a, b] = await windows(context, 2);

  /** @type {string[]} */
  let seen = [];
  a.on('request', (r) => {
    if (r.url().includes('/api/')) seen.push(r.url());
  });

  // The window must be the visible one: query-core falls back to `document.visibilityState`
  // when no boolean was ever set, and a background tab legitimately refetches nothing.
  await a.bringToFront();
  check(
    'canary precondition: the window is visible',
    (await a.evaluate(() => document.visibilityState)) === 'visible',
  );

  const focusRound = async () => {
    await sleep(STALE_MS + 500); // everything on screen is stale again
    seen = [];
    await a.evaluate(() => window.dispatchEvent(new Event('focus')));
    await sleep(1500);
    return seen.length;
  };

  const first = await focusRound();
  const again = await focusRound();
  check('the first focus refetches', first > 0, `${first} Anfragen`);
  check('the SECOND focus refetches too (#54)', again > 0, `${again} Anfragen`);

  // ======================================================================== B · the broadcast
  //
  // Only a window's own write path posts the invalidate (`useInvalidateAll`), so the negative
  // control is as load-bearing as the positive one — and it is asserted twice, because "the row
  // never showed up" also passes when the selector is simply wrong.
  console.log('\nB · Broadcast zwischen zwei Fenstern');
  await pin(a, data.id);
  await pin(b, data.id);

  const typed = `Broadcast ${RUN}`;
  await a.locator('input[placeholder^="Neue allgemeine Aufgabe"]').fill(typed);
  await a.locator('input[placeholder^="Neue allgemeine Aufgabe"]').press('Enter');
  await check(
    'the UI write reaches the other window',
    await b
      .locator('td', { hasText: typed })
      .first()
      .waitFor({ timeout: 8000 })
      .then(() => true)
      .catch(() => false),
  );

  const quiet = `Curl ${RUN}`;
  // `?season=` is the header's twin — the middleware takes either, and a bare fetch has no
  // header to send.
  await send('POST', `/tasks?season=${data.id}`, { title: quiet });
  await sleep(900); // longer than the 150 ms coalescer plus a refetch
  check(
    'a write that bypasses the UI does not broadcast',
    (await b.locator('td', { hasText: quiet }).count()) === 0,
  );
  await b.reload();
  await ready(b);
  check(
    '…and it was really there (the control is not vacuous)',
    (await b.locator('td', { hasText: quiet }).count()) > 0,
  );

  // ======================================================================== C · the switch
  //
  // Season switching is window-local: repin and reload *this* window, move the registry default
  // for future windows best-effort, and leave every other window alone.
  console.log('\nC · Saisonwechsel ist fensterlokal');
  const target = await makeSeason('Wechselziel');
  // A season created over the API broadcasts nothing, so the switcher menu of a window that was
  // already open does not list it — the click would wait out its timeout on a button that is not
  // there. Only a reload makes a curl-created season visible.
  await a.reload();
  await ready(a);
  const chipBefore = await chip(b);

  // The old document re-renders with the new chip before the reload lands, so wait for the
  // document change — URL and readiness are already true.
  await Promise.all([
    a.waitForEvent('domcontentloaded', { timeout: 15_000 }),
    (async () => {
      await a.locator('button[title$="wechseln"]').first().click();
      await a.locator('button', { hasText: target.label }).last().click();
    })(),
  ]);
  await a.waitForURL(/#\/dashboard/, { timeout: 15_000 });
  await ready(a);

  check('the switching window follows', (await chip(a)) === target.label, await chip(a));
  check('…and repins', (await seasonPin(a)) === String(target.id));
  await sleep(600);
  check('the other window stays where it was', (await chip(b)) === chipBefore, chipBefore);
  check(
    'the registry default follows the switch',
    (await api('/seasons')).activeId === target.id,
    String((await api('/seasons')).activeId),
  );

  // Back to the demo's own season, so the fixtures above are deletable again: deleteSeason
  // refuses the registry default, by design.
  await send('POST', `/seasons/${HOME}/activate`);

  // ======================================================================== D · 410 recovery
  //
  // The delete has to be out of band. Deleting through another window's UI broadcasts an
  // invalidate, and the pinned window then heals *before* the step under test — the repro
  // silently stops reproducing.
  console.log('\nD · Saison unter einem Fenster gelöscht');
  const doomed = await makeSeason('Opfer');
  const c = await open(context, '/dashboard');
  await pin(c, doomed.id);
  check('the third window sits on the doomed season', (await chip(c)) === doomed.label);

  const del = await send('DELETE', `/seasons/${doomed.id}`);
  check('the season is gone server-side', del.status === 200, `HTTP ${del.status}`);

  // Any request from that window now answers 410. A focus is the honest trigger: no navigation,
  // no reload, exactly what a user coming back to the window does.
  await sleep(STALE_MS + 500);
  await c.evaluate(() => window.dispatchEvent(new Event('focus')));

  await c.waitForURL(/#\/$/, { timeout: 15_000 });
  await ready(c);
  check(
    'the window recovers to the landing page',
    (await c.evaluate(() => location.hash)) === '#/',
    await c.evaluate(() => location.hash),
  );
  await check(
    'and says so',
    await toast(c, /gelöscht/)
      .first()
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false),
  );
  check('the dead pin is dropped', (await seasonPin(c)) !== String(doomed.id));

  // ======================================================================== D2 · the term
  //
  // The toast waits for `['seasons']` before naming the season, so it lands one query after the
  // page — that wait is the whole point of the case (PR50-13).
  console.log('\nD2 · Der Hinweis nennt den umbenannten Begriff');
  await send('PATCH', '/seasons/terms', { season: 'Festival' });
  const doomed2 = await makeSeason('Opfer 2');
  await pin(c, doomed2.id);
  await send('DELETE', `/seasons/${doomed2.id}`);
  await sleep(STALE_MS + 500);
  await c.evaluate(() => window.dispatchEvent(new Event('focus')));
  await c.waitForURL(/#\/$/, { timeout: 15_000 });
  await check(
    'the toast uses „Festival“',
    await toast(c, /Festival/)
      .first()
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false),
  );
  await send('PATCH', '/seasons/terms', { season: null });

  // ======================================================================== E · the export
  //
  // The .xlsx export is a button that fetches through api/client, not an `<a href>`: only that
  // layer sends the season header, and only it recovers from the 410 that answers a deleted
  // season — as a navigation that 410 renders as raw JSON and strands the window (PR50-04).
  console.log('\nE · Excel-Export trägt die Saison');
  await pin(a, data.id, '/project/1');
  /** @type {string[]} */
  const exportSeasons = [];
  a.on('request', (r) => {
    if (r.url().includes('.xlsx')) exportSeasons.push(r.headers()['x-auftakt-season'] ?? '');
  });
  const [download] = await Promise.all([
    a.waitForEvent('download', { timeout: 20_000 }),
    a.getByRole('button', { name: '⬇ Excel' }).first().click(),
  ]);
  check('the export downloads a file', download.suggestedFilename().endsWith('.xlsx'), download.suggestedFilename());
  check(
    'the export request carries this window’s season',
    exportSeasons.includes(String(data.id)),
    exportSeasons.join(','),
  );

  const doomed3 = await makeSeason('Opfer 3', true);
  await pin(c, doomed3.id, '/project/1');
  await send('DELETE', `/seasons/${doomed3.id}`);
  await c.getByRole('button', { name: '⬇ Excel' }).first().click();
  await c.waitForURL(/#\/$/, { timeout: 15_000 });
  await ready(c);
  check('a dead pin does not strand the export', (await c.locator('pre').count()) === 0);

  // ======================================================================== F · a task
  console.log('\nF · Aufgabe anlegen und erledigen');
  const d = await open(context, '/project/2');
  const title = `Aufgabe ${RUN}`;
  // `input[placeholder*="Aufgabe"]` matches the global search box first, and it comes earlier in
  // the DOM — so `.first()` types into the header and the table never changes.
  await d.locator('input[placeholder^="Neue Aufgabe"]').fill(title);
  await d.locator('input[placeholder^="Neue Aufgabe"]').press('Enter');
  await d.locator('td', { hasText: title }).first().waitFor({ timeout: 8000 });

  const tasksAfter = await api('/tasks?project_id=2');
  const created = tasksAfter.find((t) => t.title === title);
  check('the task exists server-side', !!created, created ? `#${created.id}` : 'nicht gefunden');
  // A new row is stamped one below its list's minimum so it lands on top. Assert the relative
  // order, never a literal ordinal.
  check(
    'and it sorts to the top of its list',
    !!created && Math.min(...tasksAfter.map((t) => t.sort_order)) === created.sort_order,
  );

  // „Erledigt" is not a literal anywhere: the done value is whichever Status option carries the
  // `done` flag, which is what greys the row out, sinks it and eventually archives it.
  const columns = await api('/custom-columns');
  const status = columns.find((c) => c.kind === 'builtin' && c.key === 'status');
  const doneValue = JSON.parse(status?.options ?? '[]').find((o) => o.done)?.value ?? 'done';
  const row = d.locator(`[data-task-id="${created.id}"]`);
  // Two `listbox` triggers per row (Status and Bereich); the first is Status.
  const statusCell = row.locator('button[aria-haspopup="listbox"]').first();
  await statusCell.scrollIntoViewIfNeeded(); // useAnchoredPopover closes on an outside scroll
  await statusCell.click();
  const doneOption = d.locator(`[role="option"][data-value="${doneValue}"]`).first();
  await doneOption.waitFor({ timeout: 5000 });
  await doneOption.click();

  // A status change re-sorts the table, so `.first()` addresses a different row afterwards:
  // assert the write, not the label.
  await sleep(600);
  const reread = (await api('/tasks?project_id=2')).find((t) => t.id === created.id);
  check('the task is done server-side', reread?.status === doneValue, String(reread?.status));

  // ======================================================================== G · a column
  console.log('\nG · Spalte ein- und ausblenden');
  await d.goto(`${UI}/#/artist/1`);
  await d.reload(); // `goto` to a different hash keeps data-app-ready — it says nothing about the route
  await ready(d);

  const before = (await api('/artists/1')).task_columns;
  const headers = () =>
    d.locator('table thead th').allInnerTexts().then((t) => t.join('|').toLowerCase());
  check('the season default is in force on this page', before === null, String(before));
  check('…and Fällig is on screen', (await headers()).includes('fällig'));

  await d.getByRole('button', { name: /Spalten/ }).first().click();
  // Scoped to the topmost dialog for the reason `topDialog` gives — and this page in particular
  // has tasks on it, so page-wide button selectors are ambiguous here.
  const dialog = topDialog(d);
  // Two `[data-column-row]` lists live in this dialog since WP-59: „Globale Spalten" first, then
  // this page's own scope. The attribute carries no id, so address the row by its name — and not
  // the first row either, which is the locked Status column and has no toggle at all.
  const faellig = dialog.locator('[data-column-row]').filter({ hasText: 'Fällig' }).first();
  await faellig.locator('button[title="Ausblenden"]').click();
  await sleep(800);
  const after = JSON.parse((await api('/artists/1')).task_columns ?? 'null');
  check('hiding a global column here writes the page, not the column', after?.due === false, JSON.stringify(after));
  check('…and the header is gone', !(await headers()).includes('fällig'));
  check(
    'the column itself stays enabled for everyone else',
    (await api('/custom-columns')).find((c) => c.key === 'due')?.enabled === 1,
  );

  await faellig.locator('button[title="Einblenden"]').click();
  await sleep(800);
  check(
    'showing it again drops the override rather than storing a true',
    (await api('/artists/1')).task_columns === before,
    String((await api('/artists/1')).task_columns),
  );
  await d.keyboard.press('Escape');

  // ======================================================================== H · the editor
  console.log('\nH · Der Editor speichert');
  await d.goto(`${UI}/#/project/2`);
  await d.reload();
  await ready(d);

  const note = d.locator('.prose-md').first();
  await note.waitFor({ timeout: 8000 });
  // Click a text run, never the box: its centre may be a link or an image. And opening and
  // closing stores nothing — `commit` returns early when the draft equals the prop — so the
  // case needs a real keystroke.
  await note.locator('p').first().click();
  await d.locator('.rte-content.ProseMirror-focused').waitFor({ timeout: 8000 });
  const suffix = ` Nachtrag ${RUN}.`;
  await d.keyboard.press('End');
  await d.keyboard.type(suffix);
  // ⌘↵ / Ctrl+↵ is the editor's own save: it blurs itself, and blur is what commits (WP-49).
  // Clicking some neutral spot instead would make the case depend on what that spot is.
  await d.keyboard.press('ControlOrMeta+Enter');
  // The commit is asynchronous, and the wait has to be on the **editor going away** — the
  // editable node's own class list carries `prose-md`, so waiting for that is satisfied by the
  // surface already on screen and the read below races a PATCH that has not been sent yet.
  // `InlineNotes` leaves edit mode only once the write resolved (RTE-01), which is what makes
  // `.rte-root` detaching the honest signal here. The comment half below cannot use it:
  // `CommentCell` unmounts first and commits afterwards.
  await gone(d.locator('.rte-root'), 10_000);
  check(
    'a typed note is persisted on blur',
    String((await api('/projects/2')).description ?? '').includes(suffix.trim()),
  );

  // …and once more through the door React's delegated onBlur cannot see: an editor whose node is
  // already detached never receives that event, so the task table's Kommentar rides an unmount
  // effect instead (TTU-38). Navigating away mid-edit is how a user reaches it. `InlineNotes`
  // above deliberately has no such effect — its draft is meant to survive a *failed save*, not a
  // navigation — so this case belongs on the cell that does.
  const comment = `Kommentar ${RUN}`;
  const commentRow = d.locator(`[data-task-id="${created.id}"]`);
  await commentRow.scrollIntoViewIfNeeded();
  await commentRow.locator('button', { hasText: '+ Kommentar' }).first().click();
  await d.locator('.rte-content.ProseMirror-focused').waitFor({ timeout: 8000 });
  await d.keyboard.type(comment);
  await d.goto(`${UI}/#/dashboard`); // a hash navigation unmounts the editor without a reload
  await ready(d);
  await sleep(800);
  check(
    'a comment left by navigating away still commits',
    String((await api(`/tasks/${created.id}`)).comment ?? '').includes(comment),
  );

  // ======================================================================== I · the delete path
  //
  // Every case below runs in a *copied* season, which keeps the row ids (`copyRows` carries `id`)
  // and so keeps the fixture facts docs/VERIFYING.md pins — while leaving the shared demo the
  // other cases read untouched. The copy drops soft-deleted rows, so this season's Papierkorb
  // starts empty and `/deleted` names exactly what this case put there.
  //
  // **How the page was reached is part of the case.** „Daten konnten nicht aktualisiert werden.
  // (not found)" after a delete reproduces when the page was reached by a client-side navigation
  // and *not* after a `page.goto` to it: `navigate()` is a React Router transition, so the
  // unmount races a DELETE that takes ~2 ms against localhost, and the two routes in lose that
  // race at different rates. So this case clicks its way in — Übersicht → Künstlerkarte →
  // Projektkarte — which is what makes the „no error toast" assertion below mean anything, and
  // what a script that `goto`s the page under test can never assert (it reports the bug fixed
  // while a user hits it on the first click).
  //
  // The delete itself is WP-34's path: „✎ Bearbeiten" → „Löschen" → a nested confirm → „In den
  // Papierkorb". There is no 🗑 next to the print link, and `getByRole('button', { name:
  // 'Löschen' })` is ambiguous on any page with tasks on it — the task table's row 🗑 carries
  // `title="Löschen"` too — so every dialog button here is scoped to the topmost `.fixed.inset-0`.
  console.log('\nI · Löschen, Papierkorb, Rückgängig');
  const T = scoped(trash.id);
  const e = await open(context, '/dashboard');
  await pin(e, trash.id, '/dashboard');
  // A locator is a query, not a snapshot, so this one `.last()` re-resolves on every use — it is
  // the edit dialog while that is topmost and the confirm once it stacks on top.
  const top = topDialog(e);

  await e.locator('[data-section="artists"] a[href="#/artist/1"]').first().click();
  await e.waitForURL(/#\/artist\/1$/, { timeout: 15_000 });
  // The URL changes with the transition, one query before the projects are on screen — a
  // `count()` read straight after it is 0 against a page that renders the card a moment later.
  const card = e.locator('[data-project-card="2"]');
  check('the project is a card on its artist’s page', (await shown(card)) && (await card.count()) === 1);
  await card.click();
  await e.waitForURL(/#\/project\/2$/, { timeout: 15_000 });

  await e.getByRole('button', { name: '✎ Bearbeiten' }).click();
  const editHeading = e.getByRole('heading', { name: 'Projekt bearbeiten' });
  await editHeading.waitFor({ timeout: 8000 });
  check('the edit dialog carries the delete button (WP-34)', await top.getByRole('button', { name: 'Löschen' }).isVisible());

  await top.getByRole('button', { name: 'Löschen' }).click();
  await e.getByRole('heading', { name: 'Projekt löschen' }).waitFor({ timeout: 8000 });
  // The dependent count is fetched when the *confirm* opens, so „Wird geprüft, was mitgeht …" is
  // what is on screen first — reading the dialog straight away asserts against the pending state.
  await top.getByText(/Mit dabei:/).waitFor({ timeout: 8000 });
  const confirmBody = await top.innerText();
  check("the confirm counts the project's tasks", /3 Aufgaben/.test(confirmBody), confirmBody.replace(/\n/g, ' | '));
  check('…and points at the Archiv', /Gelöschte Einträge/.test(confirmBody));

  // Escape closes the question and leaves the form standing — the case `ModalDepthCtx` exists for.
  await e.keyboard.press('Escape');
  await e.getByRole('heading', { name: 'Projekt löschen' }).waitFor({ state: 'detached', timeout: 8000 });
  check('Escape closes the confirm only, the form stays', await editHeading.isVisible());
  check('…and nothing was deleted', (await send('GET', T('/projects/2'))).status === 200);

  await top.getByRole('button', { name: 'Löschen' }).click();
  await top.getByRole('button', { name: 'In den Papierkorb' }).click();
  await e.waitForURL(/#\/artist\/1$/, { timeout: 15_000 });
  check('the delete lands on the parent page', (await e.evaluate(() => location.hash)) === '#/artist/1');
  check('the row is soft-deleted', (await send('GET', T('/projects/2'))).status === 404);

  // Scoped to the toast that names *this* record: toasts stack and hold six seconds, so in a
  // script an earlier step's „Rückgängig" is still on screen and `.first()` reverts the wrong row.
  check('an undo toast names the deleted project', await shown(toast(e, /Schulworkshop/)));
  // The assertion the clicked route above exists for: `useUndoableDelete`'s `gone` marks the
  // deleted row's own keys stale instead of refetching them, so the page still mounted under the
  // redirect does not ask for a row that is in the Papierkorb, 404, and get told something is
  // wrong when nothing is. Read after the „gelöscht" toast, which lands once the delete settled.
  check('…and no „nicht aktualisiert" error toast beside it', (await toast(e, /nicht aktualisiert/).count()) === 0);
  check('the project card disappears from the artist page', await gone(card));

  // A bookmark to the deleted row must render the LoadError panel, not a spinner and not a
  // record served out of the cache (PGS-05).
  await e.goto(`${UI}/#/project/2`);
  await e.reload(); // a `goto` to a different hash keeps data-app-ready — it says nothing about the route
  await ready(e);
  check(
    'a bookmark to the deleted project shows „nicht gefunden“ (PGS-05)',
    await shown(e.getByText('Projekt nicht gefunden')),
  );

  await e.goto(`${UI}/#/archiv`);
  await e.reload();
  await ready(e);
  const trashRow = e.locator('div.divide-y > div').filter({ hasText: 'Schulworkshop' });
  check('the Papierkorb lists the project', (await shown(trashRow)) && (await trashRow.count()) === 1);
  await trashRow.getByRole('button', { name: 'Wiederherstellen' }).click();
  const restoredProject = await until(
    () => send('GET', T('/projects/2')).then((r) => r.status),
    (s) => s === 200,
  );
  check('restoring brings it back', restoredProject === 200, `HTTP ${restoredProject}`);

  // ======================================================================== I2 · a dirty form
  //
  // The delete does **not** ask „Änderungen verwerfen?" — asking about unsaved edits to a record
  // on its way to the Papierkorb is a question with no meaningful answer (WP-34) — and the edit
  // must be dropped rather than written on the way out. Artist 3 is the count fixture: it reaches
  // 2 projects, 1 contact, 14 tasks and 1 event, which is what proves the number walks *through*
  // its projects rather than stopping at them.
  console.log('\nI2 · Löschen aus einem geänderten Formular');
  await e.goto(`${UI}/#/dashboard`);
  await e.reload();
  await ready(e);
  const artistCard = e.locator('[data-section="artists"] a[href="#/artist/3"]');
  check('the artist is a card on the Übersicht', (await shown(artistCard)) && (await artistCard.count()) === 1);
  await artistCard.first().click();
  await e.waitForURL(/#\/artist\/3$/, { timeout: 15_000 });

  await e.getByRole('button', { name: '✎ Bearbeiten' }).click();
  await e.getByRole('heading', { name: /bearbeiten$/ }).waitFor({ timeout: 8000 });
  // `TextInput` renders no `type` — except in a `RecordFormModal`, whose text branch passes
  // `type="text"` explicitly. So this matches Name and not the colour field's untyped hex box,
  // which is the *only* other input in this dialog.
  await top.locator('input[type="text"]').first().fill(`Wird eh gelöscht ${RUN}`);
  await top.getByRole('button', { name: 'Löschen' }).click();
  await top.getByText(/Mit dabei:/).waitFor({ timeout: 8000 });
  const cascade = await top.innerText();
  check(
    'the confirm counts through the projects, not up to them',
    /\b2 Projekte\b/.test(cascade) &&
      /\b1 Kontakt\b/.test(cascade) &&
      /\b14 Aufgaben\b/.test(cascade) &&
      /\b1 Termin\b/.test(cascade),
    cascade.replace(/\n/g, ' | '),
  );

  await top.getByRole('button', { name: 'In den Papierkorb' }).click();
  await e.waitForURL(/#\/dashboard$/, { timeout: 15_000 });

  // Everything about the deleted state is **read** here and asserted after the undo, because the
  // toast carrying that button is dismissed by a plain 6 s `setTimeout` that hovering does not
  // pause. Five round trips plus an unbounded `gone()` between the delete and the click is how a
  // run that is green on this machine goes red on a slower one — and the failure would read as
  // „undo is broken" rather than „the script was too slow to press it". The reads themselves
  // cannot be moved *after* the click: every one of them describes a row the undo brings back.
  const discardPrompt = await e.getByText('Änderungen verwerfen?').count();
  const cardGone = await gone(artistCard, 4000);
  const deletedStatus = (await send('GET', T('/artists/3'))).status;
  const binned = (await api(T('/deleted'))).find((d) => d.type === 'artist');
  const hits = await api(T(`/search?q=${encodeURIComponent('Klanginstallation')}`));

  // `click()` waits for the button; a `count()` here would race the toast's own render.
  await toast(e, /Kollektiv Halbton/).getByRole('button', { name: 'Rückgängig' }).first().click();
  const restoredArtist = await until(
    () => send('GET', T('/artists/3')).then((r) => r.status),
    (s) => s === 200,
  );

  check('a dirty form deletes without asking about the edits', discardPrompt === 0);
  check('the artist is soft-deleted', deletedStatus === 404, `HTTP ${deletedStatus}`);
  check('the artist card disappears from the Übersicht', cardGone);
  check('…and the unsaved edit was dropped, not written', binned?.label === 'Kollektiv Halbton', String(binned?.label));
  // SDL-01: an entry with live children never auto-purges, so „alles wiederherstellbar" holds
  // indefinitely rather than for 30 days.
  check('…and the entry will not auto-purge while children hang off it', binned?.purge_at === null, String(binned?.purge_at));
  check(
    'a deleted artist takes its projects out of the search',
    hits.projects.filter((p) => p.artist_id === 3).length === 0,
    JSON.stringify(hits.projects),
  );
  check('undo restores the artist', restoredArtist === 200, `HTTP ${restoredArtist}`);

  // ======================================================================== J · reordering rows
  //
  // Drag is the most fragile interaction in the program — eight call sites, four of them
  // responsive grids — and two hard-won details keep it working: the payload is a private MIME
  // type, because `text/plain` made every drag a native *text* drag that any editable element
  // accepts, so releasing a row over the search field or an inline editor typed the raw row id
  // into it and the commit-on-blur saved it (CCL-15); and the arm is released from the *window*,
  // because a grab that ends anywhere but on the ⠿ never fires the handle's own `pointerup` and
  // left the row `draggable` for good (CCL-19).
  //
  // The interleaving is the point of the contact cases, not decoration. Project 1's three
  // contacts carry `sort_order` 0, 6, 7 and artist 1's two carry 1, 8, so a reorder that
  // renumbered by hand — or renumbered the wrong parent's list — reshuffles rows on a page nobody
  // was looking at. Each half of this case therefore asserts the *other* parent stayed put.
  console.log('\nJ · Umsortieren per ⠿ — Kontakte und Karten');
  const S = scoped(sorted.id);
  const f = await open(context, '/project/1');
  await pin(f, sorted.id, '/project/1');

  const contactsOf = (query) => api(S(`/contacts?${query}`));
  const stamps = (rows) => rows.map((c) => `${c.name}:${c.sort_order}`).join(' | ');
  const projectContacts = f.locator('[data-section="kontakte"] li');
  const artistBefore = stamps(await contactsOf('artist_id=1'));
  const projectBefore = (await contactsOf('project_id=1')).map((c) => c.name);

  await dragHandleOnto(
    f,
    projectContacts.filter({ hasText: 'Wanda Groß' }).first(),
    projectContacts.filter({ hasText: 'Merle Dahlke' }).first(),
  );
  const moved = await until(() => contactsOf('project_id=1'), (r) => r[0]?.name === 'Wanda Groß');
  check('the third contact moved to the top', moved[0]?.name === 'Wanda Groß', stamps(moved));
  check(
    '…and nothing else changed its relative order',
    JSON.stringify(moved.slice(1).map((c) => c.name)) ===
      JSON.stringify(projectBefore.filter((n) => n !== 'Wanda Groß')),
    stamps(moved),
  );
  // The renumbering covers the whole of *this* parent's list, which is what makes the interleave
  // safe: every row the reorder may touch is in the payload, so the sequence restarts at 0.
  check(
    'sort_order is renumbered 0..n-1',
    JSON.stringify(moved.map((c) => c.sort_order)) === '[0,1,2]',
    stamps(moved),
  );
  check(
    'the other parent’s interleaved rows are untouched',
    stamps(await contactsOf('artist_id=1')) === artistBefore,
    artistBefore,
  );

  await f.goto(`${UI}/#/artist/1`);
  await f.reload();
  await ready(f);
  const artistContacts = f.locator('[data-section="kontakte"] li');
  await dragHandleOnto(
    f,
    artistContacts.filter({ hasText: 'Sven Ostermann' }).first(),
    artistContacts.filter({ hasText: 'Piet Aalders' }).first(),
  );
  const movedArtist = await until(() => contactsOf('artist_id=1'), (r) => r[0]?.name === 'Sven Ostermann');
  check('contacts reorder on the artist page too', movedArtist[0]?.name === 'Sven Ostermann', stamps(movedArtist));
  check(
    '…and this time it is the project’s rows that stay put',
    stamps(await contactsOf('project_id=1')) === stamps(moved),
    stamps(moved),
  );

  await f.goto(`${UI}/#/dashboard`);
  await f.reload();
  await ready(f);
  const cardsBefore = (await api(S('/artists'))).map((a) => a.name);
  await dragHandleOnto(
    f,
    f.locator('[data-section="artists"] a[href="#/artist/4"]').first(),
    f.locator('[data-section="artists"] a[href="#/artist/1"]').first(),
  );
  const cardsAfter = await until(
    () => api(S('/artists')).then((r) => r.map((a) => a.name)),
    (names) => names[0] === 'Jonas Wehrmann',
  );
  check('the last artist card moved to the front', cardsAfter[0] === 'Jonas Wehrmann', cardsAfter.join(' | '));
  check(
    '…and the others kept their relative order',
    JSON.stringify(cardsAfter.slice(1)) === JSON.stringify(cardsBefore.filter((n) => n !== 'Jonas Wehrmann')),
    cardsAfter.join(' | '),
  );
  await f.reload();
  await ready(f);
  // Polled, not sampled: `ready()` can arrive on the 700 ms budget with the artists query still
  // in flight, and an `evaluateAll` taken then returns `[]` against a page that is fine.
  const hrefs = await until(
    () =>
      f
        .locator('[data-section="artists"] a[href^="#/artist/"]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('href'))),
    (list) => list.length >= 4,
  );
  check('the persisted order survives a reload', hrefs[0] === '#/artist/4', hrefs.slice(0, 4).join(' '));

  // ======================================================================== K · the drag’s limit
  //
  // Links are one flat `sort_order` sequence rendered in groups, so a drop across a category
  // would move a row under a heading that contradicts it — `canDrop` refuses those pairings.
  // Project 1's „Technik" is the only link group with two rows, which makes it the only place a
  // reorder is observable at all, and its `sort_order` values (0, 6) are interleaved with the
  // other groups' (5, 7) — the same trap as the contacts above.
  //
  // A refused drop used to be silent: the row simply snapped back, and a rule nobody can see
  // reads as a broken feature (WP-35). So the refusal is asserted three ways — the handle's own
  // tooltip names the limit, the foreign groups dim *mid-flight*, and the release changes
  // nothing.
  console.log('\nK · Links sortieren nur innerhalb ihrer Kategorie');
  await f.goto(`${UI}/#/project/1`);
  await f.reload();
  await ready(f);

  const links = () => api(S('/links?project_id=1')).then((r) => r.map((l) => l.label));
  const linkRows = f.locator('[data-section="links"] li');
  const rider = linkRows.filter({ hasText: 'Technikrider' }).first();
  const plan = linkRows.filter({ hasText: 'Bühnenplan' }).first();
  const vertrag = linkRows.filter({ hasText: 'Vertrag (unterschrieben)' }).first();
  const linksBefore = await links();

  await dragHandleOnto(f, plan, rider);
  const linksAfter = await until(links, (l) => l.indexOf('Bühnenplan') < l.indexOf('Technikrider (PDF)'));
  check(
    'a link leads its category group after the drag',
    linksAfter.indexOf('Bühnenplan') < linksAfter.indexOf('Technikrider (PDF)'),
    linksAfter.join(' | '),
  );
  // Passing the *whole* list to `arrayMoveTo` rather than the group's rows is what leaves the
  // other groups alone: lifting one item out and re-inserting it elsewhere keeps every other
  // item's relative position, so renumbering all of them afterwards rewrites nothing else.
  const others = (l) => l !== 'Bühnenplan';
  check(
    'every link outside the group kept its relative order',
    JSON.stringify(linksAfter.filter(others)) === JSON.stringify(linksBefore.filter(others)),
    linksAfter.filter(others).join(' | '),
  );

  const tooltip = await plan.locator('[title^="Zum Verschieben ziehen"]').first().getAttribute('title');
  check('the handle names the limit', tooltip === 'Zum Verschieben ziehen (innerhalb der Kategorie)', String(tooltip));

  // Hold the drag over the foreign group and read the dimming before releasing. It is a CSS
  // transition, so a sample taken the instant the pointer arrives still reads ~0.99 — poll for
  // it instead of guessing at a sleep, and require the dragged row's own group to stay lit,
  // which is the half that fails if the dimming is simply applied to everything.
  const groups = () =>
    f
      .locator('[data-section="links"] div.transition-opacity')
      .evaluateAll((els) =>
        els.map((el) => [el.querySelector('span')?.textContent?.trim() ?? '', getComputedStyle(el).opacity]),
      );
  await grabHandle(f, plan);
  await dragOver(f, vertrag);
  const dimmed = await until(
    groups,
    (gs) => gs.some(([name, o]) => !/technik/i.test(name) && Number(o) < 0.6),
    5000,
  );
  check(
    'mid-flight the foreign groups dim and the source group stays lit',
    dimmed.length > 1 &&
      dimmed.every(([name, o]) => (/technik/i.test(name) ? Number(o) === 1 : Number(o) < 0.6)) &&
      dimmed.some(([name]) => /vertrag/i.test(name)),
    JSON.stringify(dimmed),
  );
  await f.mouse.up();

  // A refused drop issues no request at all, so there is nothing to poll for — the honest shape
  // is a beat longer than the reorder above took, then the same read.
  await sleep(800);
  // One read for both the verdict and the detail — two fetches can sample different moments, and
  // the log would then contradict its own verdict on exactly the run that needs reading.
  const refused = await links();
  check(
    'the refused drop across the category border changed nothing',
    JSON.stringify(refused) === JSON.stringify(linksAfter),
    refused.join(' | '),
  );

  // The ⠿ used to be invisible until the row was hovered (WP-35). Reload with the pointer parked
  // off every row, so nothing is hovered and the resting state is what is measured.
  await f.mouse.move(1390, 990);
  await f.reload();
  await ready(f);
  const rest = await f
    .locator('[data-section="links"] [title^="Zum Verschieben ziehen"]')
    .first()
    .evaluate((el) => getComputedStyle(el).opacity);
  check('a handle nobody is hovering is still visible', Number(rest) > 0.2, `opacity ${rest}`);

  // ======================================================================== L · the smallest window
  //
  // WP-55 took the window minimum from 1024×680 to 624×560 so two of them fit side by side, and
  // shipped that promise with nothing checking it: not one case above sets a viewport, and
  // Playwright's default is 1280×720.
  //
  // **The viewport is not the window.** `useContentSize` is false, so `MINIMUM` is the outer size
  // and the frame comes off before the renderer sees anything — driving at 624×560 checks a
  // window nobody has. The real pair is the two `NARROW` viewports above. Both are under
  // Tailwind's `sm:`, which is exactly 640, so both stay in the one-column layout; they are still
  // checked separately, because 14 px of width and 34 of height is what a wrap decision is made
  // of.
  //
  // What the two assertions per page are, and why neither is enough alone, is on
  // `overflowReport`. They are followed here by a control that injects an overhanging element and
  // requires the sweep to see it — otherwise „no offenders" is also what a sweep that silently
  // matches nothing reports, which is the failure mode the whole file exists to avoid.
  console.log('\nL · Das kleinste Fenster (WP-55)');
  // Every page the WP-55 pass covered: the header search and the season switcher are on all of
  // them, the task table is on three, and „Archiv" is where `SectionTitle` meets a w-64 search box.
  //
  // `#/einstellungen` joined the list in WP-64c, together with the fix that made it pass: the add
  // row of `TaskSortEditor` is a `<select>` beside „+ Hinzufügen", and a `<select>`'s automatic
  // minimum width is its longest option — 465 px here — so as a flex item it refused to shrink and
  // pushed the button 7 px past a 610 px window. `min-w-0` lets it shrink again. Why the overhang
  // looked intermittent (WP-64b measured it 2 in 12), and what this page therefore needs before it
  // can be measured at all, is on the precondition below.
  const NARROW_PAGES = ['/dashboard', '/', '/artist/1', '/project/1', '/archiv', '/einstellungen'];
  const WITH_TABLE = new Set(['/dashboard', '/artist/1', '/project/1']);

  for (const vp of NARROW) {
    const ctx = await windowContext(chrome, vp);
    const n = await open(ctx, NARROW_PAGES[0]);
    for (const hash of NARROW_PAGES) {
      if (hash !== NARROW_PAGES[0]) {
        await n.goto(`${UI}/#${hash}`);
        await n.reload(); // a `goto` to a different hash keeps data-app-ready — see `ready`
        await ready(n);
      }
      // Measured only once a row is laid out. `data-app-ready` also arrives from BootReady's
      // unconditional 700 ms budget, and a table measured in that window reports a *narrower*
      // preferred width than the one the user sees — the same run gave 758 and 1347 for
      // `#/project/1`.
      /** Geometry of the sort editor's add row — filled in below, on the one page that has one. */
      let addRule = { options: 0, rowRight: 0, cardRight: 0 };
      if (WITH_TABLE.has(hash)) {
        check(
          `${hash} hat eine Aufgabentabelle, bevor gemessen wird`,
          await shown(n.locator('div.overflow-x-auto table tbody tr')),
        );
      }
      // The same rule for the same reason, one layer down — and with a twist that is the whole
      // reason this page looked flaky. The sort editor's `<select>` is `PLACEHOLDER_SELECT_PX` wide
      // while it holds nothing but „Spalte wählen…", and **Chromium does not re-measure it when
      // React fills the options in**: the width is decided at the select's first layout and then
      // simply stays, whichever value it took. Waiting for the options is therefore not enough —
      // measured after a `reload()` the box is 181 px in six loads out of six, and the page is
      // clean whatever the CSS says. What does re-run the intrinsic sizing is a `change` on the
      // select, i.e. the thing a user does before pressing „+ Hinzufügen": 24 of 24 (WP-64c).
      //
      // Everything here is scoped to the sort card. A page-wide `select` is one element today and
      // a strict-mode violation the day this tab grows a second one — thrown from inside the
      // check, past `check()` (which does not throw) and into the outer catch, i.e. every case
      // after L silently skipped.
      if (hash === '/einstellungen') {
        const sortRow = cardWith(n, 'Automatische Aufgaben-Sortierung').locator('select');
        const options = await until(() => sortRow.locator('option').count(), (c) => c > 1);
        // Guarded, because `check` does not throw and `selectOption` does: a page that no longer
        // renders this editor at all would abort the whole run instead of failing one assertion.
        let sized = 0;
        if (options > 1) {
          await sortRow.selectOption({ index: 1 });
          // „It grew past the placeholder", not „it is at least N px": the healthy width is a
          // layout number (412 px at 610, 424 at 624) and would have to be re-tuned by anyone who
          // changes the card's padding, while the invariant under test is only that the box
          // re-measured itself at all.
          sized = await until(
            () => sortRow.evaluate((el) => Math.round(el.getBoundingClientRect().width)),
            (w) => w > PLACEHOLDER_SELECT_PX + 50,
            5000,
          );
          addRule = await sortRow.evaluate((el) => {
            const select = /** @type {HTMLSelectElement} */ (el);
            const button = select.parentElement?.querySelector('button') ?? null;
            const card = select.closest('div.rounded-2xl');
            return {
              options: select.options.length,
              rowRight: Math.round(button?.getBoundingClientRect().right ?? 0),
              cardRight: Math.round(card?.getBoundingClientRect().right ?? 0),
            };
          });
        }
        check(
          `${hash}: die Spaltenauswahl ist gefüllt und vermessen, bevor die Seite gemessen wird`,
          options > 1 && sized > PLACEHOLDER_SELECT_PX + 50,
          `${options} Optionen, Auswahl ${sized} px breit`,
        );
      }
      const m = await n.evaluate(overflowReport);
      const at = `${vp.label} ${vp.width}×${vp.height} ${hash}`;
      check(
        `${at}: das Dokument ist nicht breiter als das Fenster`,
        m.scrollWidth <= m.clientWidth,
        `scrollWidth ${m.scrollWidth}, clientWidth ${m.clientWidth}`,
      );
      check(
        `${at}: nichts ragt außerhalb eines Scroll-Containers hinaus`,
        m.offenders.length === 0,
        m.offenders.slice(0, 4).join(' · '),
      );
      // …and the same row against its *card* rather than against the window, because the window
      // question is only asked in one of the two: without `min-w-0` the row ends at 617 px in
      // **both** — 7 px past a 610 px viewport, where the sweep reports it, and 7 px inside a
      // 624 px one, where the sweep has nothing to say while the row still overhangs its card
      // (600 px) by 17. The card is where the content is actually cut off, so this is the
      // assertion that bites at both widths (WP-64c).
      if (hash === '/einstellungen') {
        check(
          `${at}: die Sortier-Regel-Zeile endet in ihrer Karte`,
          addRule.rowRight > 0 && addRule.rowRight <= addRule.cardRight + 1,
          `„+ Hinzufügen“ bis ${addRule.rowRight}, Karte bis ${addRule.cardRight}, ${addRule.options} Optionen`,
        );
      }
    }

    // WP-55's third fix, and the one a width sweep cannot see: the add row and the `<table>` sit
    // in one `min-w-min` box, so „Neue Aufgabe" and its bottom border are as wide as the table
    // instead of ending in mid-air as soon as the table is scrolled. `offsetWidth`, never
    // `scrollWidth` — the add row's content is short, and the question is how wide its *box* is.
    await n.goto(`${UI}/#/project/1`);
    await n.reload();
    await ready(n);
    await shown(n.locator('div.overflow-x-auto table tbody tr'));
    const box = await n.evaluate(() => {
      const scroller = /** @type {HTMLElement | null} */ (document.querySelector('div.overflow-x-auto'));
      const table = /** @type {HTMLElement | null} */ (scroller?.querySelector('table') ?? null);
      const addRow = /** @type {HTMLElement | null} */ (scroller?.querySelector('div.flex.items-center') ?? null);
      return {
        addRow: addRow?.offsetWidth ?? 0,
        table: table?.offsetWidth ?? 0,
        client: scroller?.clientWidth ?? 0,
        scroll: scroller?.scrollWidth ?? 0,
      };
    });
    check(
      `${vp.label}: die Neue-Aufgabe-Zeile ist so breit wie die Tabelle`,
      box.addRow > 0 && box.addRow === box.table,
      `Zeile ${box.addRow}, Tabelle ${box.table}`,
    );
    // …and the case is not vacuous: at this width the table really does overhang its container,
    // which is what makes the sweep's exemption above load-bearing rather than theoretical.
    check(
      `${vp.label}: die Tabelle scrollt wirklich in ihrem Container`,
      box.scroll > box.client + 1,
      `${box.scroll} in ${box.client}`,
    );
    await n.close();
    await ctx.close();
  }

  // The sweep's own control, one probe per verdict it has to reach — „0 offenders" is also what a
  // sweep that has quietly stopped matching anything reports.
  const probe = await windowContext(chrome, NARROW[0]);
  const g = await open(probe, '/dashboard');

  const wide = await sweepWithProbe(g, '<div id="probe-weit" style="width:3000px;height:8px"></div>');
  check(
    'das breite Kontrollelement wächst das Dokument über den Viewport',
    wide.scrollWidth > wide.clientWidth,
    `${wide.scrollWidth} bei ${wide.clientWidth}`,
  );
  check(
    '…und der Sweep meldet es',
    wide.offenders.some((o) => o.includes('probe-weit')),
    wide.offenders.join(' · '),
  );

  // The second one is the case the first half structurally cannot see, and the reason the sweep
  // reports a `hidden` ancestor rather than exempting it: content cut off by a clipping box never
  // grows the document, so `scrollWidth` stays exactly at the viewport while a row of a card is
  // out of reach.
  const cut = await sweepWithProbe(
    g,
    '<div style="overflow:hidden;width:100px"><div id="probe-abgeschnitten" style="width:3000px;height:8px"></div></div>',
  );
  check(
    'ein abgeschnittenes Kontrollelement wächst das Dokument gerade nicht',
    cut.scrollWidth <= cut.clientWidth,
    `${cut.scrollWidth} bei ${cut.clientWidth}`,
  );
  check(
    '…und genau deshalb muss der Sweep es melden',
    cut.offenders.some((o) => o.includes('probe-abgeschnitten')),
    cut.offenders.join(' · '),
  );

  // The season switcher is the one popover that does not go through `useAnchoredPopover`, which
  // is what flips and caps the others against the viewport. It hangs off the *sticky* header, so
  // an overlong list cannot be reached by scrolling the document either — in the smallest window
  // its last entries were simply unreachable before WP-55 capped and scrolled it.
  await g.locator('button[title$="wechseln"]').first().click();
  const menu = g.locator('div.absolute.z-40').first();
  check('der Saison-Umschalter öffnet im schmalen Fenster', await shown(menu));
  const cap = await menu.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      overflowY: cs.overflowY,
      maxHeight: parseFloat(cs.maxHeight),
      bottom: Math.round(el.getBoundingClientRect().bottom),
      inner: window.innerHeight,
    };
  });
  check('…seine Liste scrollt', cap.overflowY === 'auto', cap.overflowY);
  check(
    '…seine Höhe ist gegen den Viewport gedeckelt',
    cap.maxHeight <= cap.inner * 0.7 + 1,
    `max-height ${cap.maxHeight} bei ${cap.inner}`,
  );
  check('…und sie endet im Fenster', cap.bottom <= cap.inner, `Unterkante ${cap.bottom} bei ${cap.inner}`);
  await g.keyboard.press('Escape');
  await g.close();
  await probe.close();

  // ======================================================================== M · a done row
  //
  // WP-58: a done task was only half marked as done. `text-neutral-400` on the `<tr>` is pure
  // inheritance, so every cell carrying a `text-*` of its own stayed black, and `line-through` on
  // the `<tr>` reaches no cell at all — text-decoration does not propagate into atomic inline
  // boxes, and nearly every leaf here is a `<button>` or an `inline-flex`.
  //
  // Which is why the naive assertion — read `text-decoration-line` off the `<p>` the Markdown
  // renderer emits — fails against working code. The property is not inherited: the decoration
  // propagates *visually* into in-flow block boxes while the computed value on every one of them
  // stays `none`. So the strike is asserted on the element that carries the class, and the
  // *precondition* that propagation relies on — `display: block`, `float: none`,
  // `position: static` on the descendant — is asserted separately. An `inline-block` there would
  // silently stop the strike.
  //
  // The colour half is WP-62's pair, and it has to be a pair: on the done row alone „grey wins"
  // also passes on a build that never paints the colour at all.
  console.log('\nM · Erledigte Zeilen: Strich, Grau und Farbe (WP-58, WP-62)');
  const statusCol = (await api('/custom-columns')).find((c) => c.kind === 'builtin' && c.key === 'status');
  const done = JSON.parse(statusCol?.options ?? '[]').find((o) => o.done)?.value ?? 'done';
  const seven = await api('/tasks?project_id=7');
  // Picked by their fixture properties rather than by id, so a renumbered demo fails loudly here
  // instead of asserting about whatever row happens to carry that number.
  const doneRow = seven.find((t) => t.status === done && (t.comment ?? '').includes('tc-'));
  const openRow = seven.find((t) => t.status !== done && (t.comment ?? '').includes('tc-'));
  const emptyRow = seven.find((t) => t.status === done && !t.due_date);
  check(
    'die Fixture-Zeilen stehen auf #/project/7 (WP-58)',
    !!doneRow && !!openRow && !!emptyRow,
    `erledigt ${doneRow?.id}, offen ${openRow?.id}, ohne Datum ${emptyRow?.id}`,
  );
  // Nothing below dereferences those rows, and the reason is that `check` does not throw: a demo
  // whose fixture has drifted would raise a TypeError here, the outer catch would swallow it as
  // one opaque „run completed" failure, and N/N2 would never run at all. Missing ids fall through
  // to selectors that match nothing, so every assertion below reports what it really found.
  const doneId = doneRow?.id ?? 0;
  const doneTitle = doneRow?.title ?? '';

  const h = await open(context, '/project/7');
  await shown(h.locator('div.overflow-x-auto table tbody tr'));
  // One evaluate for every reading: two round trips can straddle a background refetch's
  // re-render and compare styles from different commits.
  const marks = await h.evaluate(
    ([dId, oId, eId, title]) => {
      const row = (id) => document.querySelector(`[data-task-id="${id}"]`);
      const cs = (el) => (el ? getComputedStyle(el) : null);
      const titleBtn = Array.from(row(dId)?.querySelectorAll('button') ?? []).find(
        (b) => b.textContent?.trim() === title,
      );
      const commentBox = row(dId)?.querySelector('div.cursor-text');
      const para = commentBox?.querySelector('.prose-md p');
      const quote = commentBox?.querySelector('.prose-md blockquote');
      const doneSpan = commentBox?.querySelector('[class*="tc-"]');
      const openSpan = row(oId)?.querySelector('div.cursor-text [class*="tc-"]');
      const pill = row(dId)?.querySelector('button[aria-haspopup="listbox"]');
      const dashes = Array.from(row(eId)?.querySelectorAll('td span') ?? [])
        .filter((s) => s.textContent?.trim() === '—')
        .map((s) => cs(s)?.textDecorationLine);
      return {
        title: { found: !!titleBtn, deco: cs(titleBtn)?.textDecorationLine },
        box: { deco: cs(commentBox)?.textDecorationLine, color: cs(commentBox)?.color },
        para: {
          deco: cs(para)?.textDecorationLine,
          display: cs(para)?.display,
          float: cs(para)?.float,
          position: cs(para)?.position,
        },
        quote: quote ? cs(quote)?.color : null,
        doneSpan: doneSpan ? cs(doneSpan)?.color : null,
        openSpan: openSpan ? cs(openSpan)?.color : null,
        openColour: cs(row(oId)?.querySelector('div.cursor-text'))?.color,
        pill: pill ? { filter: cs(pill)?.filter, opacity: cs(pill)?.opacity } : null,
        dashes,
      };
    },
    [doneId, openRow?.id ?? 0, emptyRow?.id ?? 0, doneTitle],
  );

  check('der Titel der erledigten Zeile ist durchgestrichen', marks.title.found && marks.title.deco === 'line-through', String(marks.title.deco));
  check('ihr Kommentar auch', marks.box.deco === 'line-through', String(marks.box.deco));
  check(
    '…und das gerenderte <p> darunter meldet erwartungsgemäß „none“',
    marks.para.deco === 'none',
    String(marks.para.deco),
  );
  check(
    '…weil der Strich per Blockfluss dorthin wandert — die Bedingung dafür steht',
    marks.para.display === 'block' && marks.para.float === 'none' && marks.para.position === 'static',
    `${marks.para.display} / ${marks.para.float} / ${marks.para.position}`,
  );
  // `.prose-md blockquote` sets a colour of its own, so a Zitat in einem erledigten Kommentar sat
  // visibly darker than the rest of the row until `.prose-md--done` beat that rule.
  check(
    'das Zitat im erledigten Kommentar nimmt das Grau der Zeile',
    marks.quote === marks.box.color,
    `Zitat ${marks.quote}, Zelle ${marks.box.color}`,
  );
  // Tailwind v4 serialises `text-neutral-400` as `oklch(0.708 0 none)`, so the honest assertion is
  // the comparison itself and never a hardcoded rgb.
  check(
    'der farbige Lauf der erledigten Zeile ebenso (WP-62)',
    marks.doneSpan === marks.box.color,
    `Lauf ${marks.doneSpan}, Zelle ${marks.box.color}`,
  );
  check(
    '…und der der offenen Zeile bleibt rot — das Paar ist die Zusicherung',
    marks.openSpan === 'rgb(185, 28, 28)' && marks.openSpan !== marks.openColour,
    String(marks.openSpan),
  );
  check(
    'die Status-Pille ist entfärbt statt durchgestrichen',
    !!marks.pill && /grayscale/.test(marks.pill.filter ?? '') && Number(marks.pill.opacity) < 1,
    JSON.stringify(marks.pill),
  );
  // A line through an em dash reads as a second dash, which is what `doneCell`'s `filled`
  // argument exists for.
  check(
    'die „—“-Platzhalter der erledigten Zeile bleiben ungestrichen',
    marks.dashes.length > 0 && marks.dashes.every((d) => d === 'none'),
    marks.dashes.join(' | '),
  );
  await h.close();

  // ======================================================================== N · the print sheets
  //
  // Everything here is asserted against the PDF's bytes rather than against the DOM, because the
  // defects only exist on paper. `page.pdf()`'s default `printBackground: false` **is** the
  // SHL-11 repro — Chromium's „Hintergrundgrafiken" is off by default in the browser and in
  // Electron's `window.print()` — and a screenshot can never show it, because screenshots always
  // paint backgrounds. The fix was `print-color-adjust: exact` scoped to `.print-page`.
  //
  // So the case takes a second PDF with that property overridden back to `economy` and requires
  // the group headings to vanish from it. Without that control the case would also pass on a
  // Chromium that simply prints backgrounds regardless — i.e. it would assert nothing about the
  // fix. Measured: the `.print-page` colours are 19 with the fix and 18 without.
  //
  // Two things decide *which* colour may carry that assertion, and both rule out the obvious one.
  // The project-code badge is out because the header's `border-b-4` carries the same accent and a
  // border prints under `economy` too. And the status-group pills are only unambiguous once the
  // project has **no status**: `ProjectStatusPill` paints „In Progress" in exactly the shade its
  // group heading uses (`DEFAULT_STATUS_OPTIONS`), and demo project 1 carries that status — so on
  // the demo, half of this assertion is satisfiable by a pill in the header while the group
  // heading prints white on white. Hence the copied season and the one PATCH: in it each group
  // colour is painted **exactly once**, which pins the fill to the heading rather than merely
  // finding it somewhere on the sheet.
  console.log('\nN · Druckbögen als PDF (SHL-11, WP-62)');
  const P = scoped(sheets.id);
  const stripped = await send('PATCH', P('/projects/1'), { status: null });
  check('das Fixture-Projekt trägt keine Status-Pille mehr', stripped.body?.status === null, `HTTP ${stripped.status}`);

  const p1 = await open(context, '/dashboard');
  await pin(p1, sheets.id, '/print/project/1');
  await p1.locator('.print-group-head').first().waitFor({ timeout: 10_000 });
  const ink = await p1.evaluate(() => ({
    groups: Array.from(document.querySelectorAll('.print-group-head span')).map(
      (s) => getComputedStyle(s).backgroundColor,
    ),
    // Optional-chained on purpose: a fixture that lost its coloured runs must fail the one check
    // written for it, not throw out of the case and take N2 with it.
    rot: document.querySelector('.print-page .tc-rot')
      ? getComputedStyle(document.querySelector('.print-page .tc-rot')).color
      : '',
    gruen: document.querySelector('.print-page .tc-gruen')
      ? getComputedStyle(document.querySelector('.print-page .tc-gruen')).color
      : '',
    statusPill: document.querySelectorAll('.print-page header .rounded-full').length,
  }));
  check(
    'der Projektbogen hat zwei Statusgruppen und farbigen Text',
    ink.groups.length === 2 && !!ink.rot && !!ink.gruen && ink.statusPill === 0,
    JSON.stringify(ink),
  );

  const paper = sheet(await printPdf(p1));
  check('der Bogen wird zu einem PDF', paper.pages.length > 0, `${paper.pages.length} Seiten`);
  check(
    'die Hintergründe der Gruppenköpfe stehen auf dem Papier — je genau einmal (SHL-11)',
    ink.groups.length > 0 && ink.groups.every((c) => paintedTimes(paper, c) === 1),
    ink.groups.map((c) => `${c} ×${paintedTimes(paper, c)}`).join(' | '),
  );
  // WP-62's document-sized fixture is project 1's description: a `tc-gruen` list item and a
  // `**<u><span class="tc-rot">…</span></u>**` run, i.e. the nesting the serializer produces.
  check('die Schriftfarben auch (WP-62)', painted(paper, ink.rot) && painted(paper, ink.gruen), `${ink.rot} / ${ink.gruen}`);

  const economy = await withoutPrintRule(
    p1,
    '.print-page { -webkit-print-color-adjust: economy !important; print-color-adjust: economy !important; }',
  );
  check(
    '…und ohne print-color-adjust: exact wären sie weg — die Zusicherung ist nicht vakuum',
    ink.groups.every((c) => !painted(economy, c)),
    ink.groups.filter((c) => painted(economy, c)).join(' | '),
  );
  check(
    '…während die Schriftfarbe bleibt: Vordergrund druckt Chromium ohnehin',
    painted(economy, ink.rot),
  );
  await p1.close();

  // The artist sheet's image, which is **not** an avatar: no demo artist sets `artists.image`, so
  // what prints here are the two pictures in artist 1's note (WP-37 — one in a Zitat, one wrapped
  // in a link), rendered inside `<header>` because `PrintHeader` takes the note as its children.
  //
  // „It printed" is asserted as an image XObject of the *stored* dimensions plus a `Do` that draws
  // it. Both halves are needed and neither may be loosened: a bare `/Subtype /Image` count is 4 on
  // a sheet with **no** picture at all, because Skia embeds colour emoji as bitmaps (📍 in the
  // events, 🚐 in the note), and `DCTDecode` would pin the assertion to this fixture being a JPEG.
  // The dimensions come from the DOM, so the check follows the fixture rather than repeating it.
  const p2 = await open(context, '/print/artist/1');
  await p2.locator('.print-page table').first().waitFor({ timeout: 10_000 });
  // An `<img>` that has not arrived yet leaves the layout intact and the paper empty, and
  // `printToPDF` will happily snapshot that — the one-run-in-ten failure mode this gate must not
  // have. Wait for the bytes, not for the element.
  const loaded = await p2
    .waitForFunction(
      () =>
        Array.from(document.querySelectorAll('.print-page img')).every(
          (i) => /** @type {HTMLImageElement} */ (i).complete && /** @type {HTMLImageElement} */ (i).naturalWidth > 0,
        ),
      { timeout: 10_000 },
    )
    .then(() => true)
    .catch(() => false);
  const shot = await p2.evaluate(() => {
    const img = /** @type {HTMLImageElement | null} */ (document.querySelector('.print-page img'));
    return img ? { w: img.naturalWidth, h: img.naturalHeight, inHeader: !!img.closest('header') } : null;
  });
  const artistPaper = sheet(await printPdf(p2));
  check('das Bild aus der Notiz ist geladen, bevor gedruckt wird', loaded && !!shot, JSON.stringify(shot));
  check(
    '…und es steht mit seinen Maßen im PDF (WP-37)',
    !!shot &&
      new RegExp(`/Subtype\\s*/Image\\s*/Width ${shot.w}\\s*/Height ${shot.h}\\b`).test(
        artistPaper.buf.toString('latin1'),
      ) &&
      artistPaper.pages.some((c) => /\/X\d+ Do/.test(c)),
    shot ? `${shot.w}×${shot.h}, ${artistPaper.pages.length} Seiten` : 'kein Bild',
  );
  await p2.close();

  // Both sheets omit done tasks and say so in the heading, which is the reason WP-58's strike is
  // asserted on the table above and not here: a done row never reaches paper at all. Read from the
  // same copied season the sheet is pinned to, so the count and the sheet cannot disagree about
  // which database they are describing.
  const p3 = await open(context, '/dashboard');
  await pin(p3, sheets.id, '/print/project/7');
  await p3.locator('.print-page table').first().waitFor({ timeout: 10_000 });
  // Section headings are CSS-uppercased, so `innerText` says „AUFGABEN (1 OFFEN)" — a
  // case-sensitive match here finds nothing on a sheet that is counting correctly.
  const sheetText = (await p3.locator('.print-page').innerText()).toLowerCase();
  const openCount = (await api(P('/tasks?project_id=7'))).filter((t) => t.status !== done).length;
  check(
    `der Bogen zählt „(${openCount} offen)“`,
    sheetText.includes(`(${openCount} offen)`),
    sheetText.split('\n').find((l) => l.includes('offen)')) ?? '',
  );
  check(
    '…und die erledigte Aufgabe steht nicht darauf',
    !!doneTitle && !sheetText.includes(doneTitle.toLowerCase()),
    doneTitle || 'kein Fixture',
  );
  await p3.close();

  // ======================================================================== N2 · a group header at a page break
  //
  // `.print-group-head` is a `<tr><td colSpan>`, so neither `tr { break-inside: avoid }` nor the
  // heading rule beside it reached it, and „In Arbeit (7)" could print alone as the last line of a
  // page. `break-after: avoid` on that class is the fix.
  //
  // The fixture is tuned to a page boundary and neighbouring counts silently miss it, which is
  // exactly how this case would come to assert nothing. So it does not trust the number: it takes
  // a second PDF with the rule overridden and requires the two to *differ*. If a runner's metrics
  // move the boundary, the list is resized around the tuned length — three rows either way,
  // nearest first — until they do; and with the rule gone from index.css no length differs at all,
  // which is what makes this a gate rather than a fixture.
  //
  // The heading is found in the PDF by the colour of its own pill, and „is it stranded" is read as
  // paint order: content is emitted in DOM order, so „nothing before it on its page" means it
  // heads that page, and „n text runs after it" is how much of its group came along.
  console.log('\nN2 · Der Gruppenkopf am Seitenumbruch');
  const p4 = await open(context, '/dashboard');
  await pin(p4, pageBreak.seasonId, `/print/project/${pageBreak.project.id}`);
  await p4.locator('.print-group-head').first().waitFor({ timeout: 10_000 });
  const heads = await p4.evaluate(() =>
    Array.from(document.querySelectorAll('.print-group-head span')).map((s) => ({
      text: s.textContent ?? '',
      colour: getComputedStyle(s).backgroundColor,
    })),
  );
  check(
    `das Fixture hat zwei Gruppen, die erste mit ${PAGE_BREAK_FIRST} Aufgaben`,
    heads.length === 2 && heads[0].text.includes(String(PAGE_BREAK_FIRST)),
    heads.map((x) => x.text).join(' | '),
  );

  let boundary = null;
  let last = null;
  for (const offset of PAGE_BREAK_TRIES) {
    if (boundary) break;
    const rows = PAGE_BREAK_FIRST + offset;
    if (offset !== 0) {
      await pageBreak.resize(rows);
      await p4.reload();
      await ready(p4);
      await p4.locator('.print-group-head').first().waitFor({ timeout: 10_000 });
    }
    const kept = paintedAt(sheet(await printPdf(p4)), heads[1]?.colour ?? '');
    const split = paintedAt(
      await withoutPrintRule(p4, '.print-group-head { break-after: auto !important; }'),
      heads[1]?.colour ?? '',
    );
    last = { kept, split };
    console.log(`      ${rows} Aufgaben — mit Regel: ${where(kept)} | ohne: ${where(split)}`);
    if (kept.page > split.page) boundary = { rows, kept, split };
  }

  // Read the pill's colour back out of the PDF before anything is concluded from where it sits:
  // „not found" and „found on page 1" are the same zero otherwise.
  check('der Gruppenkopf ist im PDF wiederzufinden', (last?.kept.page ?? 0) > 0, where(last?.kept ?? { page: 0, pages: 0, before: 0, after: 0 }));
  check(
    'break-after: avoid schiebt den Gruppenkopf über den Umbruch',
    !!boundary,
    boundary ? `bei ${boundary.rows} Aufgaben` : `in ${PAGE_BREAK_TRIES.length} Längen keine Wirkung`,
  );
  if (boundary) {
    check('…er steht dann als Erstes auf seiner Seite', boundary.kept.before === 0, where(boundary.kept));
    check(
      '…und nimmt mehr von seiner Gruppe mit als ohne die Regel',
      boundary.kept.after > boundary.split.after,
      `${boundary.kept.after} statt ${boundary.split.after}`,
    );
  }
  await p4.close();

  // ======================================================================== O · the four tabs
  //
  // Einstellungen is four *routes*, each behind a `NavLink`, and not four buttons — so
  // `getByRole('button', { name: 'Kategorien' })` waits out its timeout against a page that is
  // working perfectly (docs/VERIFYING.md). The slugs are the half that survives: WP-54 renamed all
  // four labels and moved two cards between the tabs, and every script keyed on a slug came
  // through that untouched while every script keyed on a label did not.
  //
  // Each tab is then asserted by a card only that tab renders. „The link marks itself current" on
  // its own is satisfied by a router that changed the URL and rendered nothing into the `<Outlet>`.
  console.log('\nO · Die vier Reiter der Einstellungen');
  const C = scoped(config.id);
  const tabLink = (page, slug) => page.locator(`a[href="#/einstellungen/${slug}"]`);

  const s = await open(context, '/dashboard');
  await pin(s, config.id, '/einstellungen/kategorien');
  // The redirect is asserted as a navigation, not as „the URL is this after a reload": `#/einstellungen`
  // has no page of its own, it is an index route that sends the window on to the first tab.
  await s.goto(`${UI}/#/einstellungen`);
  const landed = await s
    .waitForURL(/#\/einstellungen\/aufgaben$/, { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  check('#/einstellungen leitet auf „Aufgaben & Übersicht“ weiter', landed, await s.evaluate(() => location.hash));

  const tabs = s.locator('a[href^="#/einstellungen/"]');
  check(
    'die vier Reiter sind Links',
    (await shown(tabs)) && (await tabs.count()) === 4,
    `${await tabs.count()} Links`,
  );
  check(
    '…und keine Buttons — genau daran wartet sich ein `getByRole("button")` tot',
    (await s.getByRole('button', { name: 'Programm & Hilfe' }).count()) === 0,
  );

  for (const tab of [
    { slug: 'aufgaben', card: 'Automatische Aufgaben-Sortierung' },
    { slug: 'kategorien', card: 'Dokument-Kategorien' },
    { slug: 'daten', card: 'Datenbank & Backups' },
    { slug: 'hilfe', card: 'Feedback & Diagnose' },
  ]) {
    await tabLink(s, tab.slug).click();
    await s.waitForURL(new RegExp(`#/einstellungen/${tab.slug}$`), { timeout: 10_000 });
    // `aria-current` is set on render, which is a commit later than the URL change.
    const current = await until(() => tabLink(s, tab.slug).getAttribute('aria-current'), (v) => v === 'page', 5000);
    check(`„${tab.slug}“ markiert sich als aktiver Reiter`, current === 'page', String(current));
    check(`…und rendert „${tab.card}“`, await shown(cardWith(s, tab.card)));
  }
  // „Programm & Hilfe" is the one tab whose contents depend on there being an Electron bridge, and
  // this window has none: `UpdateCard` sits behind `hasElectron` while the feedback card
  // deliberately does not (a `mailto:` needs no bridge, and a card that vanished in browser mode
  // would be a card no driving script could ever see). Case U asserts the other half against the
  // stub — the pair is the assertion, „the card is there" alone says nothing about the branch.
  check(
    'ohne Bridge fehlt die Update-Karte auf diesem Reiter',
    (await cardWith(s, 'Version & Updates').count()) === 0,
  );

  // ======================================================================== P · the editors write
  //
  // Three editors share „Aufgaben & Übersicht" and all three write through the same guarded PATCH,
  // so the assertion that means anything for each of them is the **stored** value: an editor that
  // renders its change and never sends it looks identical on screen, which is exactly the state
  // PGS-09 left the user in.
  //
  // `TaskSortEditor` has no „Speichern" — it writes on every interaction — so each step is polled
  // for rather than slept on. The two „Zeitfenster" fields are asserted as a *pair*: they have sat
  // on one tab since WP-54, they look alike, and each has to write its own key. „Both cards save"
  // is also true of a page that writes one key twice.
  console.log('\nP · Die Editoren auf „Aufgaben & Übersicht“ schreiben wirklich');
  await tabLink(s, 'aufgaben').click();
  await s.waitForURL(/#\/einstellungen\/aufgaben$/, { timeout: 10_000 });

  const sortCard = cardWith(s, 'Automatische Aufgaben-Sortierung');
  const rules = () => api(C('/settings')).then((v) => v.task_sort ?? []);
  const ruleText = (v) => v.map((r) => `${r.id}:${r.dir}`).join(' | ');
  // The option list arrives with the columns query; „Fällig" is not selectable before it does.
  const options = await until(() => sortCard.locator('select option').count(), (c) => c > 1);
  check('die Spaltenauswahl ist gefüllt', options > 1, `${options} Optionen`);
  const rulesBefore = await rules();
  check('die Saison startet mit genau einer Regel', ruleText(rulesBefore) === 'status:asc', ruleText(rulesBefore));

  await sortCard.locator('select').selectOption('due');
  await sortCard.getByRole('button', { name: '+ Hinzufügen' }).click();
  const added = await until(rules, (v) => v.length === 2);
  check('eine hinzugefügte Regel steht in den Einstellungen', ruleText(added) === 'status:asc | due:asc', ruleText(added));

  const secondRule = sortCard.locator('[data-rule-row]').nth(1);
  await secondRule.getByRole('button', { name: 'Absteigend' }).click();
  const turned = await until(rules, (v) => v[1]?.dir === 'desc');
  check('…die Richtung wird mitgeschrieben', ruleText(turned) === 'status:asc | due:desc', ruleText(turned));

  await secondRule.locator('[data-arrow="up"]').click();
  const reordered = await until(rules, (v) => v[0]?.id === 'due');
  check('…und ▲ schreibt die neue Reihenfolge', ruleText(reordered) === 'due:desc | status:asc', ruleText(reordered));
  // RTE-14: the focus goes with the rule, or the second ↑ undoes the first — focus would sit on
  // the position the rule left, which now holds the rule it swapped with. The restore runs off the
  // *server* array, so it lands a render after the write; polled for that reason (docs/VERIFYING.md).
  const carried = await until(
    () =>
      s.evaluate(() => {
        const row = document.activeElement?.closest('[data-rule-row]');
        return {
          row: row ? Array.from(document.querySelectorAll('[data-rule-row]')).indexOf(row) : -1,
          arrow: document.activeElement?.getAttribute('data-arrow') ?? '',
        };
      }),
    (v) => v.row === 0,
    5000,
  );
  check('der Fokus wandert mit der verschobenen Regel (RTE-14)', carried.row === 0 && !!carried.arrow, JSON.stringify(carried));

  await sortCard.locator('[data-rule-row]').first().getByRole('button', { name: 'Entfernen' }).click();
  const dropped = await until(rules, (v) => v.length === 1);
  check('…und ✕ nimmt sie wieder heraus', ruleText(dropped) === 'status:asc', ruleText(dropped));

  // Both „Zeitfenster" boxes are `type="number"` on this one tab since WP-54, which is why every
  // selector here is scoped to its card — a bare `input[type="number"]` is ambiguous and so is
  // „Speichern".
  //
  // The gesture is „leeren, dann tippen", and that is the whole point of it: the draft is a
  // *string*, clamped on blur and on save rather than per keystroke, because clamping each
  // keystroke wrote the empty field back as a 1 and the next digits appended to it — so emptying
  // the box and typing 60 stored 160, with no validation message (PGS-04). Select-all-and-type
  // never empties the field and passes against that defect.
  const attentionCard = cardWith(s, 'Aufgaben-Übersicht');
  const eventCard = cardWith(s, 'Termine in der Übersicht');
  check('beide Zeitfenster-Felder liegen auf diesem Reiter (WP-54)', (await s.locator('input[type="number"]').count()) === 2);

  await attentionCard.getByRole('button', { name: 'Bald fällig' }).click();
  const attentionBox = attentionCard.locator('input[type="number"]');
  await attentionBox.click();
  await attentionBox.press('ControlOrMeta+a');
  await attentionBox.press('Backspace');
  await attentionBox.type('60');
  await attentionCard.getByRole('button', { name: 'Speichern' }).click();
  const savedWindow = await until(() => api(C('/settings')), (v) => v.attention_window_days === '60', 8000);
  check(
    'die Übersichts-Karte schreibt Fenster und Kennzahlen in einem Zug',
    savedWindow.attention_window_days === '60' && JSON.stringify(savedWindow.task_stats ?? []).includes('baldfaellig'),
    `${savedWindow.attention_window_days} Tage, ${JSON.stringify(savedWindow.task_stats ?? [])}`,
  );
  check('…und der Knopf ist danach wieder stumpf', !(await attentionCard.getByRole('button', { name: 'Speichern' }).isEnabled()));

  const eventBox = eventCard.locator('input[type="number"]');
  await eventBox.click();
  await eventBox.press('ControlOrMeta+a');
  await eventBox.press('Backspace');
  await eventBox.type('21');
  await eventCard.getByRole('button', { name: 'Speichern' }).click();
  const both = await until(() => api(C('/settings')), (v) => v.event_window_days === '21', 8000);
  check(
    '…die Termin-Karte schreibt ihren eigenen Schlüssel und lässt den anderen stehen',
    both.event_window_days === '21' && both.attention_window_days === '60',
    `Termine ${both.event_window_days}, Aufmerksamkeit ${both.attention_window_days}`,
  );

  // ======================================================================== Q · the option lists
  //
  // „Kategorien" is three `OptionsEditor`s over one settings key each. The interesting half is not
  // that a save lands but that a *refused* one does not: `validateOptions` is shared with the
  // column manager because the invariants belong to the option list rather than to the screen
  // editing it — bolted onto one call site, the other silently discarded the row (RTE-12).
  console.log('\nQ · Die Optionslisten auf „Kategorien“');
  await tabLink(s, 'kategorien').click();
  await s.waitForURL(/#\/einstellungen\/kategorien$/, { timeout: 10_000 });
  // Reloaded before anything is typed, and again after the save below. Every write on this page
  // ends in a blanket invalidate, each refetch of `['settings']` reseeds this editor's draft, and
  // more than one refetch can be in flight — case P has just made two writes. A reload starts a
  // fresh cache with nothing pending, which is the only way this case can be sure the draft it
  // types into is the draft it saves.
  await s.reload();
  await ready(s);

  const typeCard = cardWith(s, 'Termin-Typen');
  const types = () => api(C('/settings')).then((v) => v.event_types ?? []);
  const typeText = (v) => v.map((o) => o.label).join(' | ');
  check('alle drei Listen stehen auf dem Reiter', (await shown(typeCard)) && (await s.locator('div.rounded-2xl:has([data-option-row])').count()) === 3);
  const typesBefore = await types();
  check('die Termin-Typen der Demo stehen darin', typesBefore.length === 4, typeText(typesBefore));

  // Everything below reads the draft's own labels off the inputs (`el.value`, a *property* — React
  // never writes the attribute) rather than trusting a position, and checks them **before** every
  // save. The reason is the reseed: `OptionsEditor` re-seeds its draft from the server list on any
  // `['settings']` refetch, so a row that is being typed can vanish under the script — and „the
  // last row" is then a *demo* category, which a save would rename or delete for real. Read as
  // assertions these are „what the user typed is in the draft and nothing else moved"; read as
  // guards they are what keeps a red check from becoming a damaged fixture.
  const optionRows = typeCard.locator('[data-option-row]');
  const draftLabels = () =>
    typeCard
      .locator('[data-option-label]')
      .evaluateAll((els) => els.map((el) => /** @type {HTMLInputElement} */ (el).value));
  const demoLabels = typeText(typesBefore);
  const newType = `Probe ${RUN}`;
  const saveTypes = typeCard.getByRole('button', { name: 'Speichern' });
  /**
   * Click „Speichern", bounded. The button is `disabled` while the draft equals the stored list,
   * so a reseed landing between the read above and this click leaves a dead button — and the
   * default 30 s actionability wait would end the *run* rather than the case. The message travels
   * into the next check's detail instead.
   */
  const saveTypesNow = () =>
    saveTypes
      .click({ timeout: 8000 })
      .then(() => '')
      .catch((e) => ` — Speichern: ${String(e.message).split('\n')[0]}`);

  // A row with no name is refused *before* it can be saved, and the refusal is the button rather
  // than a message afterwards: `normalizeOptions` ends in `.filter(o => o.label)`, so a blank row
  // saved would be silently dropped and read as a failed save (RTE-12).
  await typeCard.getByRole('button', { name: '+ Typ' }).click();
  await until(draftLabels, (v) => v.length === 5, 5000);
  const problem = await until(() => typeCard.locator('.text-amber-700').innerText().catch(() => ''), (t) => t.length > 0, 5000);
  check('eine namenlose Zeile wird benannt statt gespeichert', /keine Bezeichnung/.test(problem), problem.replace(/\n/g, ' '));
  check('…und „Speichern“ ist so lange stumpf', !(await saveTypes.isEnabled()));

  await typeCard.locator('[data-option-label]').last().fill(newType);
  const named = await until(draftLabels, (v) => v[4] === newType, 5000);
  const namedOk = named.length === 5 && named[4] === newType && named.slice(0, 4).join(' | ') === demoLabels;
  check('die getippte Zeile steht neben den unveränderten Demo-Kategorien', namedOk, named.join(' | '));
  const savedAdd = namedOk ? await saveTypesNow() : ' — nicht gespeichert';
  const typesAfter = await until(types, (v) => v.some((o) => o.label === newType), 8000);
  check(
    'ein benannter Typ wird gespeichert',
    typesAfter.some((o) => o.label === newType),
    `${typeText(typesAfter)}${savedAdd}`,
  );
  await s.reload();
  await ready(s);
  const seeded = await until(draftLabels, (v) => v.length === 5 && v[4] === newType, 8000);
  check('…und steht nach einem Neuladen im Editor', seeded.join(' | ') === `${demoLabels} | ${newType}`, seeded.join(' | '));

  // One row, one click: the rows are keyed by index, so two clicks on „das letzte ✕" inside one
  // render address the same position twice — and the second would take a demo category with it.
  await optionRows.last().getByRole('button', { name: 'Entfernen' }).click();
  const shrunk = await until(draftLabels, (v) => v.length === 4, 5000);
  check('…und ✕ nimmt sie wieder heraus', shrunk.join(' | ') === demoLabels, shrunk.join(' | '));
  const savedRemoval = shrunk.join(' | ') === demoLabels ? await saveTypesNow() : ' — nicht gespeichert';
  const typesRestored = await until(types, (v) => v.length === 4, 8000);
  check(
    'die gespeicherte Liste steht wieder wie zuvor',
    typeText(typesRestored) === demoLabels,
    `${typeText(typesRestored)}${savedRemoval}`,
  );
  // Removing a category *nothing uses* saves straight away; the reassignment dialog belongs to the
  // other branch. Asserted rather than assumed, and cleared if it is there — its backdrop would
  // otherwise swallow the next case's clicks and turn one red check into an aborted run.
  const openDialogs = await s.locator('.fixed.inset-0').count();
  check('ein unbenutzter Typ geht ohne Zuordnungs-Dialog', openDialogs === 0, `${openDialogs} Dialoge`);
  if (openDialogs > 0) {
    await s.keyboard.press('Escape');
    await gone(s.locator('.fixed.inset-0'));
  }

  // ======================================================================== R · seasons and backups
  //
  // The data tab holds the only *irreversible* delete in the app — a season is a file, not a row:
  // no `deleted_at`, no Papierkorb, no undo (DECISIONS.md) — and the backup card, which is the
  // one card that renders differently for having no Electron bridge. This page has none, so the
  // browser half is asserted here and its stubbed twin in case U.
  console.log('\nR · Saisons löschen und die Backup-Karte ohne Bridge');
  await tabLink(s, 'daten').click();
  await s.waitForURL(/#\/einstellungen\/daten$/, { timeout: 10_000 });

  const backupCard = cardWith(s, 'Datenbank & Backups');
  check('ohne Bridge ist der Backup-Ordner nicht wählbar', !(await backupCard.getByRole('button', { name: 'Wählen…' }).isEnabled()));
  check('…und die Karte sagt, warum', /nur in der Desktop-App/.test(await backupCard.innerText()));

  // Scoped to the season card by the sentence only it carries: `li` is a page-wide selector, and
  // the day anything else on this tab renders a list the rows below stop being the seasons.
  const homeLabel = registry.seasons.find((x) => x.id === HOME)?.label ?? '';
  const seasonRows = cardWith(s, 'Anlegen und Umbenennen').locator('li');
  const defaultRow = seasonRows.filter({ hasText: 'Standard' });
  check(
    'die Standard-Saison ist als solche markiert',
    (await shown(defaultRow)) && (await defaultRow.innerText()).includes(homeLabel),
    (await defaultRow.count()) ? (await defaultRow.innerText()).replace(/\n/g, ' ') : 'keine Zeile',
  );
  check('…und trägt keinen Löschknopf, weil der Server sie ohnehin verweigert', (await defaultRow.locator('button[title="Löschen"]').count()) === 0);

  // Reloaded rather than waited for: a season created over the API broadcasts nothing, so this
  // window keeps rendering the list it has (docs/VERIFYING.md). That is a fact about the script's
  // own fixture, not a promise of the app — `refetchOnWindowFocus` is on, so „it is not on screen
  // yet" is a state a stray focus event may end at any moment, and asserting it would be asserting
  // cache staleness as if it were an invariant.
  const doomedSeason = await makeSeason('Löschziel');
  await s.reload();
  await ready(s);
  const doomedRow = seasonRows.filter({ hasText: doomedSeason.label });
  check('eine neu angelegte Saison steht nach dem Neuladen in der Liste', await shown(doomedRow));

  await doomedRow.locator('button[title="Löschen"]').click();
  await s.getByRole('heading', { name: /endgültig löschen$/ }).waitFor({ timeout: 8000 });
  const confirmText = await topDialog(s).innerText();
  check(
    'die Rückfrage nennt die Saison und sagt, dass es keinen Weg zurück gibt',
    confirmText.includes(doomedSeason.label) && /nicht rückgängig/.test(confirmText),
    confirmText.replace(/\n/g, ' | '),
  );
  // WP-42: a confirm dialog has no tabbable in its body, so the focus effect falls through to the
  // footer's first button — and that is „Abbrechen". The keystroke that reaches the question
  // answers it, and the safe answer is the one it lands on.
  // Polled, like every other transition here: `Modal` places focus from a passive effect, so a
  // one-shot read taken the moment the heading is on screen can precede it.
  const confirmFocus = await until(() => tabStop(s), (v) => v.at >= 0, 5000);
  check('der Fokus liegt auf „Abbrechen“ (WP-42)', confirmFocus.text === 'Abbrechen', JSON.stringify(confirmFocus));
  await s.keyboard.press('Enter');
  const afterEnter = await gone(s.locator('.fixed.inset-0'));
  check('Enter beantwortet sie damit — der Dialog geht zu', afterEnter, `${await s.locator('.fixed.inset-0').count()} Dialoge`);
  check('…und die Saison steht noch da', (await api('/seasons')).seasons.some((x) => x.id === doomedSeason.id));
  // Leave nothing standing if that assertion failed: the delete below clicks the same 🗑, and a
  // confirm still up would turn one red check into an aborted run that never reaches R2 or S.
  if ((await s.locator('.fixed.inset-0').count()) > 0) {
    await s.keyboard.press('Escape');
    await gone(s.locator('.fixed.inset-0'));
  }

  await doomedRow.locator('button[title="Löschen"]').click();
  await topDialog(s).getByRole('button', { name: 'Endgültig löschen' }).click();
  const remaining = await until(
    () => api('/seasons').then((r) => (r.seasons ?? []).map((x) => x.id)),
    (ids) => !ids.includes(doomedSeason.id),
  );
  check('„Endgültig löschen“ löscht sie wirklich', !remaining.includes(doomedSeason.id), `${remaining.length} Saisons übrig`);
  check('…und der Hinweis nennt sie', await shown(toast(s, new RegExp(doomedSeason.label))));

  // ======================================================================== R2 · the term
  //
  // „Saison" is a word the user owns: it is stored registry-wide in seasons.json, not per season,
  // and every screen composes its headings from it. The tab's own label is the shortest proof that
  // the word travels — `SettingsPage` builds it from `useSeasonTerm`, so a card that saved into
  // the wrong store would leave the tab reading „Saison & Daten" beside a renamed everything else.
  console.log('\nR2 · Die Bezeichnung trägt bis in den Reiter');
  const termCard = cardWith(s, 'Bezeichnung');
  await termCard.locator('input').nth(0).fill('Festival');
  await termCard.locator('input').nth(1).fill('Festivals');
  await termCard.getByRole('button', { name: 'Speichern' }).click();
  const terms = await until(() => api('/seasons').then((r) => r.terms ?? {}), (t) => t.season === 'Festival', 8000);
  check('die Bezeichnung wird registryweit gespeichert', terms.season === 'Festival' && terms.seasonPlural === 'Festivals', JSON.stringify(terms));
  const renamedTab = await until(() => tabLink(s, 'daten').innerText(), (t) => t.includes('Festival'), 5000);
  check('…und der Reiter heißt danach', renamedTab.trim() === 'Festival & Daten', renamedTab.trim());

  await termCard.locator('input').nth(0).fill('');
  await termCard.locator('input').nth(1).fill('');
  await termCard.getByRole('button', { name: 'Speichern' }).click();
  const reset = await until(() => api('/seasons').then((r) => r.terms ?? {}), (t) => !t.season, 8000);
  check('leer lassen setzt sie zurück', !reset.season, JSON.stringify(reset));
  const plainTab = await until(() => tabLink(s, 'daten').innerText(), (t) => t.includes('Saison'), 5000);
  check('…und der Reiter heißt wieder wie ab Werk', plainTab.trim() === 'Saison & Daten', plainTab.trim());
  await s.close();

  // ======================================================================== S · the keyboard
  //
  // WP-42 gave every `Modal` three duties, and all three are about where the caret is rather than
  // about what is on screen: place focus on open, keep Tab inside the card, hand focus back to the
  // opener on close. Focus left behind the backdrop meant the next Enter pressed the button that
  // had opened the dialog — and opened it a second time.
  //
  // Every assertion below is a *position in the dialog's own tab order* (`tabStop`), never a count
  // of keystrokes: a `type="date"` is three tab stops, so a fixed-length walk silently ends inside
  // a picker and reads as a broken tab order (docs/VERIFYING.md). Index 0 is the header's ✕, so
  // „the first field of the body" is 1 — which is the rule WP-42 states, and the ✕ keeps its place
  // in the natural order rather than being the first thing anyone lands on.
  console.log('\nS · Tastatur: Fokus setzen, halten, zurückgeben (WP-42)');
  const k = await open(context, '/artist/1');
  await k.getByRole('button', { name: '✎ Bearbeiten' }).first().click();
  await k.getByRole('heading', { name: /bearbeiten$/ }).waitFor({ timeout: 8000 });

  // Polled: the focus effect is passive, so a read taken as the heading appears can precede it.
  const opened = await until(() => tabStop(k), (v) => v.at >= 0, 5000);
  check(
    'der Dialog setzt den Fokus auf das erste Feld des Rumpfes, nicht auf das ✕ (WP-42)',
    opened.at === 1 && opened.tag === 'INPUT',
    JSON.stringify(opened),
  );
  /** @type {{ at: number, n: number, tag: string, text: string }[]} */
  const walk = [];
  for (let i = 0; i < Math.max(opened.n - 1, 1); i++) {
    await k.keyboard.press('Tab');
    walk.push(await tabStop(k));
  }
  check(
    'Tab bleibt im Dialog',
    walk.length > 1 && walk.every((w) => w.at >= 0),
    walk.map((w) => `${w.at}`).join(' '),
  );
  check(
    '…läuft im Kreis und kommt am ersten Feld heraus, nicht am ✕',
    walk[walk.length - 1]?.at === opened.at && !walk.some((w) => w.at === 0),
    walk.map((w) => `${w.at}:${w.tag}`).join(' '),
  );
  // Backwards the ✕ *is* in the way, deliberately: it keeps its natural place, and only the wrap
  // off it goes to the end of the dialog rather than to the page behind the backdrop.
  await k.keyboard.press('Shift+Tab');
  const onClose = await tabStop(k);
  check('Shift+Tab vom ersten Feld erreicht das ✕', onClose.at === 0, JSON.stringify(onClose));
  await k.keyboard.press('Shift+Tab');
  const wrapped = await tabStop(k);
  check('…und von dort springt es ans Ende des Dialogs', wrapped.at === wrapped.n - 1, JSON.stringify(wrapped));

  // Read before the dialog goes: „focus is on the opener afterwards" is also true of a dialog that
  // never took focus in the first place, which is precisely the state the effect above prevents.
  const beforeClose = await tabStop(k);
  await k.keyboard.press('Escape');
  const shut = await gone(k.locator('.fixed.inset-0'));
  check('Escape schließt den ungeänderten Dialog', shut, `${await k.locator('.fixed.inset-0').count()} Dialoge`);
  // Identity, not a substring: focus dropped to `<body>` answers `document.activeElement` with the
  // body, and *its* `textContent` is the whole page — „✎ Bearbeiten" included. A check that asks
  // whether the text contains the button's label is therefore green on precisely the regression it
  // guards, which is loose focus.
  const handedBack = await until(
    () =>
      k.evaluate(() => {
        const el = document.activeElement;
        return { tag: el?.tagName ?? 'BODY', text: (el?.textContent ?? '').trim() };
      }),
    (v) => v.tag === 'BUTTON' && v.text === '✎ Bearbeiten',
    5000,
  );
  check(
    '…und der Fokus kommt aus dem Dialog zurück auf den Knopf, der ihn geöffnet hat (WP-42)',
    beforeClose.at >= 0 && handedBack.tag === 'BUTTON' && handedBack.text === '✎ Bearbeiten',
    `${JSON.stringify(beforeClose)} → ${JSON.stringify(handedBack)}`,
  );

  // ======================================================================== S2 · the exception
  //
  // `PillSelect`'s option menu is the one place the trap deliberately lets go: it portals to
  // `document.body` and runs the listbox contract with *real* focus on the options (RTE-11), so
  // pulling focus back into the card would break the field it serves.
  //
  // The menu also brings its own click-away layer — another `div.fixed.inset-0`, appended to the
  // end of the body — so `topDialog()` stops being the dialog the moment it opens. Everything
  // below therefore addresses the Modal as the *first* one.
  console.log('\nS2 · Das portalte Menü ist die Ausnahme (RTE-11)');
  await k.getByRole('button', { name: '+ Termin' }).first().click();
  await k.getByRole('heading', { name: 'Neuer Termin' }).waitFor({ timeout: 8000 });
  const eventDialog = k.locator('.fixed.inset-0').first();
  await eventDialog.locator('button[aria-haspopup="listbox"]').first().click();
  check('das Menü öffnet', await shown(k.locator('[role="listbox"]')));
  const portaled = await k.evaluate(() => {
    const card = document.querySelector('.fixed.inset-0 > div');
    const menu = document.querySelector('[role="listbox"]');
    return {
      role: document.activeElement?.getAttribute('role') ?? '',
      option: (document.activeElement?.textContent ?? '').trim(),
      inCard: !!card && card.contains(document.activeElement),
      atBody: menu?.parentElement === document.body,
      layers: document.querySelectorAll('.fixed.inset-0').length,
    };
  });
  check(
    'der Fokus steht auf einer Option außerhalb der Dialogkarte (RTE-11)',
    portaled.role === 'option' && !portaled.inCard && portaled.atBody,
    JSON.stringify(portaled),
  );
  check('…und das Menü legt eine zweite .fixed.inset-0 über den Dialog', portaled.layers === 2, `${portaled.layers} Schichten`);
  await k.keyboard.press('ArrowDown');
  const stepped = await until(
    () => k.evaluate(() => ({ text: (document.activeElement?.textContent ?? '').trim(), role: document.activeElement?.getAttribute('role') ?? '' })),
    (v) => v.text !== portaled.option,
    3000,
  );
  check('dort bewegt ↓ den Fokus weiter, nicht Tab', stepped.role === 'option' && stepped.text !== portaled.option, `${portaled.option} → ${stepped.text}`);
  await k.keyboard.press('Escape');
  const returnedToPill = await until(
    () =>
      k.evaluate(() => {
        const card = document.querySelector('.fixed.inset-0 > div');
        return {
          haspopup: document.activeElement?.getAttribute('aria-haspopup') ?? '',
          inCard: !!card && card.contains(document.activeElement),
          menus: document.querySelectorAll('[role="listbox"]').length,
        };
      }),
    (v) => v.menus === 0,
    5000,
  );
  check('Escape schließt nur das Menü und gibt den Fokus an die Pille zurück', returnedToPill.haspopup === 'listbox' && returnedToPill.inCard, JSON.stringify(returnedToPill));
  // ✕ and „Abbrechen" are deliberate exits and never ask about changes — Escape here would.
  await eventDialog.locator('button[title="Schließen"]').click();
  const eventShut = await gone(k.locator('.fixed.inset-0'));
  check('der Termin-Dialog lässt sich über ✕ schließen', eventShut, `${await k.locator('.fixed.inset-0').count()} Dialoge`);

  // ======================================================================== T · the search overlay
  //
  // The search field is a combobox and the hits are `[role="option"]` that focus never enters:
  // ↑/↓ move `aria-activedescendant` while the caret stays in the field, because the field is a
  // *filter* and every keystroke after ↓ would otherwise have to be routed back into it. The hits
  // are `tabIndex={-1}` for the same reason — they used to be twenty tab stops behind the field.
  //
  // So nothing here reads `document.activeElement` to find the marked hit, and nothing presses
  // Enter on a hit: both are how a script asserts the opposite of the contract (WP-43).
  console.log('\nT · Die Suchüberlagerung (WP-43)');
  const field = k.locator('input[role="combobox"]');
  await k.keyboard.press('ControlOrMeta+k');
  const inField = await until(
    () => k.evaluate(() => document.activeElement === document.querySelector('input[role="combobox"]')),
    (v) => v === true,
    5000,
  );
  check('⌘K setzt den Cursor ins Suchfeld', inField);
  await k.keyboard.type('Konzert');
  const hitCount = await until(() => k.locator('#gs-hits [role="option"]').count(), (n) => n > 1, 8000);
  check('die Trefferliste öffnet und hat mehrere Treffer', hitCount > 1, `${hitCount} Treffer`);

  const marker = () =>
    k.evaluate(() => {
      const input = document.querySelector('input[role="combobox"]');
      const hits = Array.from(document.querySelectorAll('#gs-hits [role="option"]'));
      return {
        ad: input?.getAttribute('aria-activedescendant') ?? '',
        ids: hits.map((h) => h.id),
        selected: hits.filter((h) => h.getAttribute('aria-selected') === 'true').map((h) => h.id),
        tabIndexes: [...new Set(hits.map((h) => /** @type {HTMLElement} */ (h).tabIndex))],
        inField: document.activeElement === input,
      };
    });
  const firstHit = await marker();
  check(
    'der Marker steht auf dem ersten Treffer und ist genau einer',
    firstHit.ad === firstHit.ids[0] && firstHit.selected.join() === firstHit.ad,
    JSON.stringify({ ad: firstHit.ad, selected: firstHit.selected }),
  );
  check('Treffer sind keine Tabstopps', firstHit.tabIndexes.join() === '-1', firstHit.tabIndexes.join());
  await k.keyboard.press('ArrowDown');
  const second = await until(marker, (m) => m.ad === m.ids[1], 5000);
  check(
    '↓ bewegt den Marker und lässt den Fokus im Feld',
    second.ad === second.ids[1] && second.selected.join() === second.ad && second.inField,
    JSON.stringify({ ad: second.ad, inField: second.inField }),
  );
  await k.keyboard.press('Tab');
  // `hits` is in the reading because „focus is not on a hit" is also true of a panel that closed
  // on the keystroke — the assertion is about the *open* list having no tab stops in it.
  const afterTab = await k.evaluate(() => ({
    isHit: !!document.activeElement?.closest('#gs-hits [role="option"]'),
    role: document.activeElement?.getAttribute('role') ?? '',
    tag: document.activeElement?.tagName ?? 'BODY',
    hits: document.querySelectorAll('#gs-hits [role="option"]').length,
  }));
  check(
    'Tab führt aus dem Feld heraus, aber nie auf einen Treffer',
    afterTab.hits > 0 && !afterTab.isHit && afterTab.role !== 'option',
    JSON.stringify(afterTab),
  );

  // ⌘F is the second way in and answers the other habit; it has to work from outside the field too.
  await k.keyboard.press('ControlOrMeta+f');
  const backInField = await until(
    () => k.evaluate(() => document.activeElement === document.querySelector('input[role="combobox"]')),
    (v) => v === true,
    5000,
  );
  check('⌘F holt den Cursor zurück ins Feld', backInField);
  // Walked to, never counted: which groups this query returns is a fixture fact, and the group
  // order decides how many ↓ a project hit is away.
  const wantedHit = (await marker()).ids.find((id) => id.startsWith('gs-hit-p')) ?? '';
  for (let i = 0; i < 12 && (await marker()).ad !== wantedHit; i++) await k.keyboard.press('ArrowDown');
  const onProject = await marker();
  check('der Marker lässt sich bis auf einen Projekttreffer laufen', !!wantedHit && onProject.ad === wantedHit, onProject.ad || 'kein Projekttreffer');
  await k.keyboard.press('Enter');
  const wantedHash = `#/project/${wantedHit.replace('gs-hit-p', '')}`;
  const opening = await until(() => k.evaluate(() => location.hash), (h) => h === wantedHash, 8000);
  check('Enter im Feld öffnet den markierten Treffer', opening === wantedHash, `${opening} für ${wantedHit}`);
  check('…und leert die Suche', (await field.inputValue()) === '', await field.inputValue());

  await k.keyboard.press('ControlOrMeta+f');
  await k.keyboard.type('Konzert');
  await shown(k.locator('#gs-hits [role="option"]'));
  await k.keyboard.press('Escape');
  const panelGone = await until(() => k.locator('#gs-hits').count(), (n) => n === 0, 5000);
  check(
    'Escape legt zuerst die Liste weg und lässt die Eingabe stehen',
    panelGone === 0 && (await field.inputValue()) === 'Konzert',
    await field.inputValue(),
  );
  await k.keyboard.press('Escape');
  const emptied = await until(() => field.inputValue(), (v) => v === '', 5000);
  check('…und erst der zweite Escape leert sie', emptied === '', emptied);

  // The rule that makes the two shortcuts safe: over an open dialog they do nothing. A listener
  // that moved focus would tear the trap open from the outside and park the caret behind the
  // backdrop — the state `Modal`'s focus effect exists to prevent (WP-43).
  await k.goto(`${UI}/#/artist/1`);
  await k.reload();
  await ready(k);
  await k.getByRole('button', { name: '✎ Bearbeiten' }).first().click();
  await k.getByRole('heading', { name: /bearbeiten$/ }).waitFor({ timeout: 8000 });
  await k.keyboard.press('ControlOrMeta+f');
  await k.keyboard.press('ControlOrMeta+k');
  await sleep(400);
  const inert = await k.evaluate(() => {
    const search = document.querySelector('input[role="combobox"]');
    return {
      dialog: document.querySelectorAll('.fixed.inset-0').length,
      onSearch: document.activeElement === search,
      expanded: search?.getAttribute('aria-expanded') ?? '',
      panels: document.querySelectorAll('#gs-hits').length,
    };
  });
  check(
    '⌘F und ⌘K sind bei offenem Dialog wirkungslos (WP-43)',
    inert.dialog === 1 && !inert.onSearch && inert.panels === 0 && inert.expanded === 'false',
    JSON.stringify(inert),
  );
  await k.keyboard.press('Escape');
  await k.close();

  // ======================================================================== U · the update card
  //
  // Everything below runs against the recording bridge and never against the real one — see
  // `stubElectron`. Three prerequisites decide whether this card is reachable at all, and each
  // one fails silently on its own: it lives at **`#/einstellungen/hilfe`** and nowhere else
  // (`#/einstellungen` lands on „Aufgaben & Übersicht", where every selector here matches nothing),
  // `checkForUpdates` has to answer `updateAvailable`, and the in-app install only exists with
  // `canInstall` — on the stub's defaults the button is simply not in the DOM.
  //
  // What WP-60 added is the *progress*, and the reason the percentage is pushed rather than
  // polled is also the reason a naive stub proves nothing here: with no subscriber the card sits
  // in its first frame for ever, which is exactly what the defect looked like.
  console.log('\nU · Die Update-Karte am Bridge-Stub (WP-60)');
  const u = await open(context, '/einstellungen/hilfe', (page) =>
    stubElectron(page, {
      platform: 'win32',
      silent: { current: '0.0.0-test', latest: '9.9.9', url: 'https://example.invalid/releases', updateAvailable: true, canInstall: true },
      manual: { current: '0.0.0-test', latest: '9.9.9', url: 'https://example.invalid/releases', updateAvailable: true, canInstall: false },
    }),
  );
  const updateCard = cardWith(u, 'Version & Updates');
  check('die Karte, die es ohne Bridge nicht gibt (Fall O), steht hier', await shown(updateCard));
  const version = await until(() => updateCard.innerText(), (t) => t.includes('0.0.0-test'), 5000);
  check(
    'sie nennt die Version aus der Bridge',
    version.includes('0.0.0-test'),
    version.split('\n').find((l) => l.includes('Installierte')) ?? '',
  );
  // Mounting reads the *cached silent* check, so an available update is on screen without anyone
  // having clicked „Nach Updates suchen".
  check('…und die stille Startprüfung steht ohne Klick da', await shown(updateCard.getByText('Version 9.9.9 ist verfügbar.')));

  const progress = () =>
    u.evaluate(() => {
      const box = document.querySelector('.rounded-lg.bg-neutral-50');
      const track = box?.querySelector('span.inline-block.overflow-hidden') ?? null;
      const fill = track?.firstElementChild ?? null;
      return {
        text: (box?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        pulsing: !!track && track.className.includes('animate-pulse'),
        width: fill instanceof HTMLElement ? fill.style.width : '',
      };
    });
  await updateCard.getByRole('button', { name: 'Herunterladen & installieren' }).click();
  const started = await until(progress, (d) => d.text.includes('heruntergeladen'), 5000);
  check(
    'vor dem ersten Datenpaket zeigt der Balken die ehrliche Unbekannte statt einer Null',
    started.pulsing && !started.text.includes('%'),
    JSON.stringify(started),
  );
  check(
    '…und der Hinweis auf den Neustart steht daneben (WP-60)',
    /Danach fragt Auftakt, ob es zum Installieren neu starten soll/.test(started.text),
    started.text,
  );
  await u.evaluate(() => /** @type {any} */ (window).__updateProgress(42));
  const at42 = await until(progress, (d) => d.width === '42%', 5000);
  check('ein gemeldeter Fortschritt erreicht Balken und Beschriftung', at42.width === '42%' && at42.text.includes('42 %') && !at42.pulsing, JSON.stringify(at42));
  // The clamp sits at the boundary rather than inside `ProgressBar`, because electron-updater has
  // been seen to overshoot on the last chunk — a clamp that only reaches the bar leaves the label
  // beside it reading „103 %".
  await u.evaluate(() => /** @type {any} */ (window).__updateProgress(103));
  const over = await until(progress, (d) => d.text.includes('100'), 5000);
  check('ein Überlauf wird an der Grenze gekappt, nicht erst im Balken', over.text.includes('100 %') && over.width === '100%', JSON.stringify(over));

  await u.evaluate(() => /** @type {any} */ (window).__finishUpdate());
  const availableAgain = await until(() => updateCard.innerText(), (t) => t.includes('Herunterladen & installieren'), 8000);
  check(
    'nach dem Abschluss steht die Karte wieder auf „verfügbar“',
    availableAgain.includes('Version 9.9.9 ist verfügbar.'),
    availableAgain.replace(/\n/g, ' | '),
  );

  // The manual check is the other door, and it answers with the *other* branch: without
  // `canInstall` the card sends the user to the Releases page over `openExternal` — the mac path,
  // and the only observable a fire-and-forget bridge call has.
  await updateCard.getByRole('button', { name: 'Nach Updates suchen' }).click();
  check('„Nach Updates suchen“ holt die zweite Antwort', await shown(updateCard.getByRole('button', { name: 'Zur Releases-Seite' })));
  await updateCard.getByRole('button', { name: 'Zur Releases-Seite' }).click();
  const externals = await until(() => u.evaluate(() => /** @type {any} */ (window).__external), (v) => v.length > 0, 5000);
  check('…und der Knopf reicht die URL an die Bridge weiter', externals[0] === 'https://example.invalid/releases', externals.join(' '));

  // The other half of case R's backup card: with a bridge the buttons are live and the browser
  // note is gone, which is what makes R's „nur in der Desktop-App" assertion about the branch
  // rather than about the wording.
  await u.goto(`${UI}/#/einstellungen/daten`);
  await u.reload();
  await ready(u);
  const stubbedBackup = cardWith(u, 'Datenbank & Backups');
  check('mit Bridge ist der Backup-Ordner wählbar', await stubbedBackup.getByRole('button', { name: 'Wählen…' }).isEnabled());
  const backupText = await stubbedBackup.innerText();
  check('…die Browser-Warnung ist weg', !/nur in der Desktop-App/.test(backupText));
  check('…und ohne gewählten Ordner warnt die Karte, dass nichts gesichert wird', /Ohne Backup-Ordner/.test(backupText), backupText.replace(/\n/g, ' | ').slice(0, 120));

  // ======================================================================== U2 · the feedback dialog
  //
  // A `mailto:` is fire-and-forget, so the dialog produces no app state to assert on: the URL
  // handed to `openExternal` is the whole of its output, and the real one opens a mail client on
  // the machine running this. The file is worse — the real `saveDiagnostics` writes to the desktop
  // (WP-54) — so the recording stub is not convenience here, it is the only way this case may
  // exist at all.
  //
  // Two assertions, and WP-66 added the second. The first is that the four places the reference
  // appears agree: the recorded file name, the subject, the body's attach line and its stamp —
  // that is what a customer's mail is *for*. The second is what the handover no longer does:
  // „Weiter" writes the file and **opens nothing**, so `window.__external` has to still be empty
  // when the dialog is fully on screen, and only the optional link may fill it. A recorder is the
  // right instrument for a call that must not happen.
  //
  // The clipboard is real, not stubbed: the three copy buttons are `navigator.clipboard`, so the
  // context is granted both permissions and the assertions read the clipboard back. `bringToFront`
  // because a clipboard write needs the document focused and earlier cases left pages open.
  console.log('\nU2 · Der Feedback-Dialog am Bridge-Stub (WP-54, WP-66)');
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: UI });
  await u.bringToFront();
  await u.goto(`${UI}/#/einstellungen/hilfe`);
  await u.reload();
  await ready(u);
  await u.getByRole('button', { name: 'Feedback senden…' }).click();
  // Waited for by the dialog's own first control, not by its heading: the card behind it carries
  // the *same* words in an `<h2>`, so `getByRole('heading', { name: 'Feedback & Diagnose' })` is
  // two elements and a strict-mode violation.
  await topDialog(u).getByRole('button', { name: /^Fehler/ }).waitFor({ timeout: 8000 });
  check('der Dialog fragt nichts, bevor eine Art gewählt ist', (await u.locator('textarea').count()) === 0);
  check('…und sagt im Fuß, woran es liegt', /Bitte zuerst Fehler oder Wunsch wählen/.test(await topDialog(u).innerText()));
  check('…„Weiter“ ist so lange stumpf', !(await topDialog(u).getByRole('button', { name: 'Weiter' }).isEnabled()));

  await topDialog(u).getByRole('button', { name: /^Fehler/ }).click();
  check('nach der Art wird der Bereich gefragt, noch keine Texte', (await u.locator('textarea').count()) === 0 && (await shown(topDialog(u).getByRole('button', { name: 'Allgemein', exact: true }))));
  await topDialog(u).getByRole('button', { name: 'Allgemein', exact: true }).click();
  const asked = await until(() => u.locator('textarea').count(), (n) => n === 3, 5000);
  check('…und erst dann die drei Fehlerfragen', asked === 3, `${asked} Felder`);
  // „Was ist passiert?" exists only under Fehler — under Wunsch the same first box asks something
  // else, which is why the two branches are driven separately below.
  check('die erste Frage ist die des Fehlers', /Was ist passiert\?/.test(await topDialog(u).innerText()));

  await u.locator('textarea').nth(0).fill('Der Druckbogen bleibt leer.');
  const ready2 = await until(() => topDialog(u).getByRole('button', { name: 'Weiter' }).isEnabled(), (v) => v === true, 5000);
  check('mit der Pflichtantwort wird „Weiter“ scharf', ready2 === true);

  // „Weiter" *opens* a dialog rather than closing one — and since WP-66 it is also the click that
  // writes the file, because the customer leaves for their mail in the middle of the handover and
  // attaches it before coming back. The handover then waits for the write: it is composed from
  // the name main returns, and that name is only guessable for the first bundle (held case below).
  await topDialog(u).getByRole('button', { name: 'Weiter' }).click();
  const stacked = await until(() => u.locator('.fixed.inset-0').count(), (n) => n === 2, 5000);
  check('„Weiter“ stapelt die Übergabe auf das Formular', stacked === 2, `${stacked} Dialoge`);
  const saved = await until(() => u.evaluate(() => /** @type {any} */ (window).__saved), (v) => v.length > 0, 8000);
  const ref = String(saved[0]?.ref ?? '');
  const file = `Auftakt-Diagnose-${ref}.txt`;
  check('ein Fehler schreibt die Diagnosedatei über die Bridge', /^AF-\d{10}$/.test(ref), ref || 'nichts geschrieben');
  // The whole of WP-66 in one line. Before it, this same click revealed the file in the Finder
  // and launched a mail client; a recorder that stays empty is the only way to hold that shut.
  check(
    '…und öffnet dabei nichts (WP-66)',
    (await u.evaluate(() => /** @type {any} */ (window).__external)).length === 0,
    (await u.evaluate(() => /** @type {any} */ (window).__external)).join(' '),
  );
  const handover = await until(() => topDialog(u).innerText(), (t) => t.includes(file), 5000);
  check('die Übergabe nennt die Datei, die main wirklich geschrieben hat', handover.includes(file), file);
  check('…und sagt, dass das Anhängen niemand für den Kunden übernehmen kann', /Das Anhängen kann kein Programm für dich übernehmen/.test(handover));
  // Focus is *not* on „Zurück" here: WP-42's rule is „the footer's safe answer when the body has
  // nothing to focus", and this body's first stop is the first thing the customer has to do.
  const steps = await until(() => tabStop(u), (v) => v.at >= 0, 5000);
  check(
    'der Fokus liegt auf dem ersten Schritt, nicht im Fuß (WP-42/66)',
    steps.at === 1 && steps.text === 'Adresse kopieren',
    JSON.stringify(steps),
  );
  await u.keyboard.press('Escape');
  const peeled = await until(() => u.locator('.fixed.inset-0').count(), (n) => n === 1, 5000);
  check('Escape schält nur sie ab, das Formular bleibt stehen', peeled === 1 && (await u.locator('textarea').nth(0).inputValue()) === 'Der Druckbogen bleibt leer.', await u.locator('textarea').nth(0).inputValue());

  await topDialog(u).getByRole('button', { name: 'Weiter' }).click();
  await topDialog(u).getByRole('button', { name: 'Adresse kopieren' }).waitFor({ timeout: 8000 });
  check(
    'zurück und wieder vor schreibt dieselbe Datei nicht zweimal',
    (await u.evaluate(() => /** @type {any} */ (window).__saved)).length === 1,
  );

  // The three copy buttons are the path now: address, subject, body — the order a compose window
  // asks for them in. Read back out of the real clipboard, which is what the customer pastes.
  //
  // `click()` returns when the event was dispatched, not when the handler's `writeText` settled,
  // so every read is a `until` on a shape the *previous* content does not have. Reading once
  // straight after the click passes or fails on timing.
  const copy = async (name, shape) => {
    await topDialog(u).getByRole('button', { name }).click();
    return until(() => u.evaluate(() => navigator.clipboard.readText()), shape, 5000);
  };
  const address = await copy('Adresse kopieren', (t) => t === 'auftakt@e-mail.de');
  check('„Adresse kopieren“ legt die Support-Adresse in die Zwischenablage', address === 'auftakt@e-mail.de', address);
  const subject = await copy('Betreff kopieren', (t) => t.startsWith('['));
  check(
    'ihr Betreff trägt Kennung, Art, Bereich und Version',
    subject === `[${ref}] Auftakt-Fehler: Allgemein (v0.0.0-test)`,
    subject,
  );
  const body = await copy('Text kopieren', (t) => t.startsWith('!!'));
  check(
    'die erste Zeile des Textes ist die eine Sache, die niemand für den Kunden tun kann',
    body.split('\n')[0] === `!! BITTE NOCH ANHÄNGEN: ${file}`,
    body.split('\n')[0],
  );
  check('…und der technische Block nennt dieselbe Kennung', body.includes(`Fehler · Allgemein · Kennung: ${ref}`), body.split('\n').find((l) => l.includes('Kennung')) ?? '');
  check('ein geglückter Kopiervorgang sagt es am Knopf', await shown(topDialog(u).getByRole('button', { name: 'Kopiert ✓' })));

  // The report is read positively first: „it does not contain X" is also true of an empty string,
  // and an empty one is what a broken `feedbackBody` would hand the bridge.
  const report = String(saved[0]?.report ?? '');
  check(
    'die Datei trägt, was der Kunde geschrieben hat',
    report.includes('Der Druckbogen bleibt leer.') && report.includes(ref),
    report.split('\n')[0] ?? '',
  );
  check(
    '…aber weder die Anhangzeile noch die Zusammenfassung — beides stünde darin doppelt',
    !/BITTE NOCH ANHÄNGEN/.test(report) && !/Startdiagnose/.test(report),
  );

  // The `mailto:` is the one optional shortcut, a link and not a button, and the *only* thing on
  // this path that ever reaches `openExternal`.
  await topDialog(u).getByRole('link', { name: 'E-Mail-Programm öffnen' }).click();
  const mails = await until(() => u.evaluate(() => /** @type {any} */ (window).__external), (v) => v.length > 0, 8000);
  const mail = new URL(mails[0] ?? 'mailto:');
  check('erst der optionale Link reicht eine Mail an die Bridge', mails.length === 1 && mail.pathname === 'auftakt@e-mail.de', mails.join(' ').slice(0, 60));
  check(
    '…mit demselben Betreff, den der Knopf kopiert hat',
    new URLSearchParams(mail.search).get('subject') === subject,
    new URLSearchParams(mail.search).get('subject') ?? '',
  );
  check('…und der Dialog bleibt dabei stehen', (await u.locator('.fixed.inset-0').count()) === 2);

  // A Wunsch is the other branch and writes nothing at all: startup timings say nothing about it,
  // so no file, no attach line, no summary — and the budget goes to the person's own words.
  //
  // Driven by switching the kind **inside the dialog that has already written a bundle**, which
  // is the only place the defect lives: a fresh dialog has nothing to inherit, so a Wunsch driven
  // from one passes whether or not the write's answer is cleared on the way through.
  await topDialog(u).getByRole('button', { name: 'Zurück' }).click();
  await topDialog(u).getByRole('button', { name: /^Wunsch/ }).click();
  await until(() => u.locator('textarea').count(), (n) => n === 3, 5000);
  check('der Wunsch fragt etwas anderes', /Was möchtest du tun können\?/.test(await topDialog(u).innerText()));
  await u.locator('textarea').nth(0).fill('Die Künstlerliste nach Land sortieren.');
  await topDialog(u).getByRole('button', { name: 'Weiter' }).click();
  const wishBody = await copy('Text kopieren', (t) => t.startsWith('---'));
  const wishSubject = await copy('Betreff kopieren', (t) => t.startsWith('['));
  check('…und schreibt dafür keine Datei', (await u.evaluate(() => /** @type {any} */ (window).__saved)).length === 1);
  const wishText = await topDialog(u).innerText();
  check('…und erbt auch keine: kein Anhang, keine Diagnose-Datei aus dem Fehler davor', !/anhängen/i.test(wishText) && !/Diagnose-Datei/.test(wishText), wishText.replace(/\n/g, ' | ').slice(0, 100));
  check('sein Betreff sagt „Wunsch“', /Auftakt-Wunsch: Allgemein/.test(wishSubject), wishSubject);
  check('…und sein Text beginnt ohne Anhangzeile', wishBody.split('\n')[0] === '--- Was ich tun können möchte', wishBody.split('\n')[0]);
  await topDialog(u).getByRole('link', { name: 'E-Mail-Programm öffnen' }).click();
  const wishMails = await until(() => u.evaluate(() => /** @type {any} */ (window).__external), (v) => v.length > 1, 8000);
  check(
    '…und auch seine Mail trägt keine Anhangzeile',
    !/BITTE NOCH ANH/.test(new URLSearchParams(new URL(wishMails[wishMails.length - 1]).search).get('body') ?? ''),
    (new URLSearchParams(new URL(wishMails[wishMails.length - 1]).search).get('body') ?? '').split('\n')[0],
  );

  // Back to the Fehler, unedited: the answers of both kinds survive a switch (they are keyed per
  // field), so the report text is the one already on the desktop and it must name *that* bundle
  // rather than write a second one.
  await topDialog(u).getByRole('button', { name: 'Zurück' }).click();
  await topDialog(u).getByRole('button', { name: /^Fehler/ }).click();
  await topDialog(u).getByRole('button', { name: 'Weiter' }).click();
  const backAgain = await until(() => topDialog(u).innerText(), (t) => /Diagnose/.test(t), 5000);
  check(
    'zurück zum Fehler nennt wieder dieselbe Datei und schreibt keine zweite',
    backAgain.includes(file) && (await u.evaluate(() => /** @type {any} */ (window).__saved)).length === 1,
    file,
  );

  // A corrected answer *must* write a second bundle — and the handover may not open until main
  // has said what it is called, because `uniqueBundleName` makes it `…-2.txt` and every line in
  // the handover names the file. Held open on purpose, which is the only way to see the wait.
  await topDialog(u).getByRole('button', { name: 'Zurück' }).click();
  await u.locator('textarea').nth(0).fill('Der Druckbogen bleibt leer — auch nach einem Neustart.');
  await u.evaluate(() => {
    /** @type {any} */ (window).__holdSave = true;
  });
  await topDialog(u).getByRole('button', { name: 'Weiter' }).click();
  const held = await until(() => u.evaluate(() => /** @type {any} */ (window).__saved), (v) => v.length > 1, 8000);
  check('ein korrigierter Text schreibt eine zweite Datei', held.length === 2 && held[1].report.includes('auch nach einem Neustart'), `${held.length} Dateien`);
  // The button says so rather than only greying out: the write races a 2 s GPU timeout, and the
  // person waiting is the one already reporting a fault. Note that this is also why a script may
  // not address „Weiter" by name across a held save — for that moment it is not called that.
  check(
    '…und die Übergabe wartet darauf, statt einen Namen zu raten',
    (await u.locator('.fixed.inset-0').count()) === 1 &&
      (await topDialog(u).getByRole('button', { name: 'Speichert…' }).isDisabled()),
  );
  await u.evaluate(() => /** @type {any} */ (window).__finishSave());
  const file2 = `Auftakt-Diagnose-${ref}-2.txt`;
  const renamed = await until(() => topDialog(u).innerText(), (t) => t.includes(file2), 8000);
  // `file` is not a substring of `file2` — `…AF-….txt` against `…AF-…-2.txt` — so „the first one
  // is not mentioned" is a real assertion rather than one the second name satisfies anyway.
  check('dann nennt sie die zweite Datei, nicht die erste', renamed.includes(file2) && !renamed.includes(file), file2);
  const body2 = await copy('Text kopieren', (t) => t.includes('-2.txt'));
  check(
    '…und der kopierte Text hängt dieselbe zweite Datei an',
    body2.split('\n')[0] === `!! BITTE NOCH ANHÄNGEN: ${file2}`,
    body2.split('\n')[0],
  );

  // Taking the correction back is the one step a single remembered text cannot pass: `written`
  // is keyed by the report text, so a text already on the desktop is a *lookup* — the first
  // bundle holds exactly it — and the earlier cache hits do not prove that, because there the
  // remembered name and the predictable one are the same string. Here they differ, and a third
  // write would also still be held: the handover would simply never open.
  await topDialog(u).getByRole('button', { name: 'Zurück' }).click();
  await u.locator('textarea').nth(0).fill('Der Druckbogen bleibt leer.');
  await topDialog(u).getByRole('button', { name: 'Weiter' }).click();
  const reverted = await until(() => topDialog(u).innerText(), (t) => t.includes(file), 8000);
  check(
    'ein zurückgenommener Text nennt wieder die erste Datei und schreibt keine dritte',
    reverted.includes(file) && !reverted.includes(file2) && (await u.evaluate(() => /** @type {any} */ (window).__saved)).length === 2,
    file,
  );
  const bodyBack = await copy('Text kopieren', (t) => t.startsWith('!!') && !t.includes('-2.txt'));
  check('…und der kopierte Text hängt sie an, nicht die zweite', bodyBack.split('\n')[0] === `!! BITTE NOCH ANHÄNGEN: ${file}`, bodyBack.split('\n')[0]);

  await topDialog(u).getByRole('button', { name: 'Fertig' }).click();
  check('der Hinweis nennt die Datei beim Namen', await shown(toast(u, new RegExp(file))));
  await u.close();

  // ======================================================================== V · announcements
  //
  // The announcement overlay (WP-63) — the only surface in the app that decides for itself
  // whether to exist, and the only one whose *absence* the other 250 assertions here depend on.
  // A full-screen `z-[60]` layer appearing unbidden would swallow every click in this gate, so
  // „inert without a payload" is asserted first and asserted again at the end, after the case has
  // installed one and taken it away.
  //
  // **The negatives are waits, not counts.** `ready()` resolves on `html[data-app-ready]`, which
  // `BootReady` also sets from an unconditional budget, so the feed request may still be in
  // flight; a `count() === 0` taken there passes against an overlay that is one round trip from
  // appearing — which is the failure this case exists to catch. `shown(…, 2000)` gives it a real
  // chance to turn up and then reports that it did not.
  //
  // The payload is hand-written into `.demo/seasons.json`, exactly the way a real dated
  // announcement is installed: nothing writes that key, there is no UI behind it, and there is
  // deliberately no fixture in `server/src/demo.ts` — a card in front of every `npm run demo`
  // would be in the way of every other visual check.
  //
  // Two contexts, and the second one is the point. Everything here runs at
  // `reducedMotion: 'reduce'` (the boot gesture's documented escape hatch), which is also the
  // branch that must render the card *without* a canvas — so the default context asserts the
  // reduced-motion variant for free. The fireworks themselves only exist at
  // `no-preference`, and „a canvas element is in the DOM" is not the assertion worth having:
  // this gate exists for the defects that appear only once something is laid out, and a canvas
  // loop that never paints is exactly one of them. So the pixels are read back.
  console.log('\nV · Ankündigungen (WP-63)');
  const registryPath = join(root, '.demo', 'seasons.json');
  const readReg = () => JSON.parse(readFileSync(registryPath, 'utf8'));
  /**
   * Hand-install into the registry, the way the one real payload is installed — and **atomically**,
   * the way the server writes the same file (`saveRegistry`, tmp + rename).
   *
   * A plain `writeFileSync` truncates the file before it fills it, so there is a window in which
   * `seasons.json` is empty on disk. The server re-reads it on *every* request, and `readRegistry`
   * treats a parse failure as corruption: it renames the file aside and bootstraps a fresh
   * registry holding one season. With four pages refetching against a demo whose season list is
   * the run's whole fixture set, that window is wide enough to hit — once in six runs here, as a
   * burst of 410s in the case *after* this one, every copied season of the run gone with it. The
   * rename is the only part of this the filesystem promises to do in one step.
   *
   * The suffix is **not** the server's. `saveRegistry` stages through `seasons.json.tmp`, and this
   * case's own clicks make the server write that file (the „Alles klar" marker) while these writes
   * are going on — two writers sharing one staging path either promote interleaved bytes or lose
   * the race to the other's rename with an ENOENT out of the try. A private name is the whole cost
   * of not having to reason about that.
   */
  const writeReg = (fn) => {
    const reg = readReg();
    fn(reg);
    const staged = `${registryPath}.tmp-check`;
    writeFileSync(staged, JSON.stringify(reg, null, 2));
    renameSync(staged, registryPath);
  };
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const overlay = (page) => page.locator('[data-announcement]');

  const v0 = await open(context);
  check('ohne Payload zeigt die Demo keine Ankündigung', !(await shown(overlay(v0), 2000)));
  await v0.close();

  // A neutral fixture, dated today. `celebrate` is set here and read in both contexts below.
  writeReg((reg) => {
    reg.announcements = [
      { id: 'testfest', title: 'Testfest', body: 'Eine Zeile.\n\nGrüße', date: TODAY.slice(5), celebrate: true },
    ];
  });

  const v1 = await open(context);
  check('ein datierter Payload erscheint beim Start', await shown(overlay(v1).first()));
  check('…mit seinem Titel', (await v1.locator('#announcement-title').textContent()) === 'Testfest');
  // The last paragraph is set apart as a sign-off — smaller, warm gold — and the lead must not
  // still carry it. Two locators, because „the body contains both" would pass on one block.
  check(
    '…der letzte Absatz steht abgesetzt als Signatur',
    (await v1.locator('.announcement-signoff').textContent())?.trim() === 'Grüße',
  );
  check(
    '…und der Fließtext trägt ihn nicht noch einmal',
    (await v1.locator('.announcement-body').textContent())?.trim() === 'Eine Zeile.',
  );
  // The reduced-motion branch, asserted as a *pair* rather than as an absence: the same payload
  // in the `no-preference` context below must produce a canvas, so a count of 0 here is only half
  // the claim. The other half is the scrimAlphaOf — the two branches pick different colours, and without
  // the fireworks the darker one reads as a defect (the agreed values are 0.80 against 0.86).
  check('…ohne Feuerwerk, weil das Fenster reduzierte Bewegung meldet', !(await shown(v1.locator('[data-announcement] canvas'), 1000)));
  const scrimAlphaOf = (page) =>
    page.evaluate(() => {
      const el = document.querySelector('[data-announcement] > [aria-hidden="true"]');
      const m = el && getComputedStyle(el).backgroundColor.match(/rgba?\(([^)]+)\)/);
      return m ? Number(m[1].split(',')[3] ?? 1) : 1;
    });
  const scrimReduced = await scrimAlphaOf(v1);
  check('…und hinter dem helleren der beiden Schleier', scrimReduced === 0.8, String(scrimReduced));
  // A dialog layer without being a `Modal`: the search shortcut must not reach past it and put
  // the caret in a field behind a full-screen backdrop (`registerModalLayer` → `anyModalOpen()`).
  // `ControlOrMeta`, like case S — the browser job runs on Linux.
  await v1.keyboard.press('ControlOrMeta+k');
  // The assertion is the *caret*, never „the field is not there": `GlobalSearch` renders its
  // input permanently in the header, so a count of `input[role="combobox"]` is 1 on every page
  // of the app and would pass against a shortcut that reached straight past this overlay. What
  // `anyModalOpen()` exists to prevent is focus landing in that field behind a full-screen
  // backdrop — so read the focus, and read it as a wait, because it would move one React round
  // after the keystroke.
  const caretInSearch = await until(
    () => v1.evaluate(() => document.activeElement === document.querySelector('input[role="combobox"]')),
    (v) => v === true,
    1500,
  );
  check('⌘K setzt den Cursor nicht hinter die Überlagerung', caretInSearch === false);
  // Tab cycles inside the card instead of walking out the back of it and landing on a link the
  // user cannot see. The card holds exactly one tab stop, so the wrap is back onto the button.
  await v1.keyboard.press('Tab');
  check(
    'Tab bleibt auf der Bestätigung, statt hinter die Überlagerung zu laufen',
    await v1.evaluate(() => document.activeElement?.hasAttribute('data-announcement-confirm') === true),
  );

  await overlay(v1).getByRole('button', { name: 'Danke!' }).click();
  check('„Danke!“ schließt die Karte', await gone(overlay(v1)));
  const stamped = await until(() => Promise.resolve(readReg().announcementsSeen?.ids?.testfest), (d) => d === TODAY, 5000);
  // The *server* stamps the day (localDay), never the client: a client that could name the day
  // could name yesterday and make a yearly announcement repeat on every start.
  check('…und der Server stempelt den Tag in die Registry', stamped === TODAY, String(stamped));
  await v1.reload();
  await ready(v1);
  check('…ein Neustart holt sie nicht zurück', !(await shown(overlay(v1), 2000)));
  await v1.close();

  // --- the marker is registry-wide, so confirming is a cross-window event ---
  //
  // Two windows both show the same dated card — the feed is one file, not one window's state —
  // and without the broadcast the user confirms the same greeting twice. Two *pages in one
  // context*, never two contexts: BroadcastChannel is partitioned per context, so a second
  // context would make this pass vacuously with nothing delivered and nothing expected.
  writeReg((reg) => {
    reg.announcements = [
      { id: 'zweifenster', title: 'Zweifenster', body: 'Eine Zeile.\n\nGrüße', date: TODAY.slice(5) },
    ];
  });
  const [w1, w2] = await windows(context, 2);
  check(
    'beide Fenster zeigen dieselbe Ankündigung',
    (await shown(overlay(w1).first())) && (await shown(overlay(w2).first())),
  );
  await overlay(w1).getByRole('button', { name: 'Danke!' }).click();
  check('…und die Bestätigung im einen räumt sie im anderen weg', await gone(overlay(w2)));
  await w1.close();
  await w2.close();

  // --- the card can arrive after a dialog is already open ---
  //
  // The feed is a round trip, so this is a real ordering and not a contrived one: the user opens
  // „Neuer Künstler", the answer lands, and the card covers the dialog completely. One Escape has
  // to close **one** thing — the one on screen. Before `ANNOUNCEMENT_DEPTH` neither layer marked
  // the key and both acted, so the dialog closed underneath a card the user was still reading;
  // on a dirty form it raised „Änderungen verwerfen?" at `z-40`, invisible under this backdrop.
  writeReg((reg) => {
    reg.announcements = [
      { id: 'spaetstart', title: 'Spätstart', body: 'Eine Zeile.', date: TODAY.slice(5) },
    ];
  });
  const slow = await context.newPage();
  slow.on('pageerror', (e) => check('no page error (Ankündigung über Dialog)', false, e.message));
  // Six seconds, not one: the ordering is the fixture here, and a card that arrived first would
  // swallow the click on „+ Künstler" and fail as a 30 s actionability timeout rather than as
  // anything readable. The pre-check below states the ordering instead of hoping for it.
  await slow.route('**/api/announcements', async (route) => {
    await sleep(6000);
    await route.continue();
  });
  await slow.goto(`${UI}/#/dashboard`);
  await ready(slow);
  check('die Ankündigung ist noch unterwegs', !(await shown(overlay(slow), 500)));
  await slow.getByRole('button', { name: '+ Künstler' }).click();
  // „anlegen" rather than „Künstler": the heading is renameable (WP-F), and the card's own text
  // must not match this locator.
  const artistDialog = slow.locator('.fixed.inset-0').filter({ hasText: 'anlegen' }).first();
  check('der Dialog steht, bevor die Ankündigung eintrifft', await shown(artistDialog));
  check('…dann legt sich die Karte darüber', await shown(overlay(slow).first()));
  await slow.keyboard.press('Escape');
  check('Escape schließt die Karte…', await gone(overlay(slow)));
  check('…und nicht den Dialog darunter', (await artistDialog.count()) === 1);
  await slow.close();

  // The other trigger, driven the only way it can be without shipping a second build: put the
  // marker back to a version that predates every entry in CHANGELOG.md. What this really asserts
  // is the bundling — `__APP_VERSION__` and the `?raw` import of a file *above* the Vite root
  // both have to have survived into the browser, and neither is visible to typecheck or to any
  // other gate.
  const APP_VERSION = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const newest = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').split(/^## (?=\d+\.\d+\.\d+)/m)[1] ?? '';
  // A line of the entry with the Markdown taken off — what the card has to render as text.
  // Derived from the file at run time, so writing the next release's notes cannot break it.
  const strip = (line) =>
    line
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`#]/g, '')
      .replace(/^\s*[-–—]\s*/, '')
      .trim()
      .slice(0, 24);
  const entryLines = newest.split('\n').slice(1).filter((l) => l.trim());
  const notesProbe = strip(entryLines[0] ?? '');
  // The newest entry's closing line — and deliberately labelled as the *weaker* half of the pair
  // below. It is the card's last block only while the card carries a single entry; the marker is
  // set to `0.0.1`, so the card carries every entry above that, and the block `splitSignoff`
  // would set apart then belongs to the **oldest** one. The discriminator is therefore the count,
  // and this says the newest entry's closing line arrived as flowing text rather than going
  // missing.
  const lastProbe = strip(entryLines[entryLines.length - 1] ?? '');
  writeReg((reg) => {
    delete reg.announcements;
    reg.announcementsSeen = { version: '0.0.1' };
  });

  const v2 = await open(context);
  check('nach einem Update erscheint „Was ist neu“', await shown(overlay(v2).first()));
  check('…mit der laufenden Version im Titel', (await v2.locator('#announcement-title').textContent()) === `Auftakt ${APP_VERSION}`, APP_VERSION);
  const notes = (await v2.locator('.announcement-body').textContent()) ?? '';
  check('…und dem echten CHANGELOG.md aus dem Bundle', notesProbe.length > 8 && notes.includes(notesProbe), notesProbe);
  // Rendered as Markdown, not dumped as source: the entry is a list and has to arrive as one.
  check('…als Markdown gerendert, nicht als Quelltext', (await v2.locator('.announcement-body li').count()) > 0);
  // The precondition of the assertion below, asserted rather than assumed. `splitSignoff` only
  // ever sets a paragraph apart when there are two or more, so „no signature" on a single-block
  // card is true whatever the code does. Counted on the **card**, not on one entry — the marker
  // sends every entry above `0.0.1` into it, which today is one and tomorrow may be three. A
  // changelog entry has always been an intro, a list and an „Außerdem" line, so this holds either
  // way; if that ever stops being so, this must say so out loud rather than let the next check
  // pass for the wrong reason. A fixture fact, like the print case's row count, and it lives in
  // docs/VERIFYING.md as one.
  const blocks = await v2.locator('.announcement-body > p, .announcement-body > ul, .announcement-body > ol').count();
  check('die Karte trägt mehrere Blöcke — sonst prüft der nächste Fall nichts', blocks >= 2, `${blocks} Blöcke`);
  check(
    '…und trotzdem keine Signatur: kein Absatz wird abgesetzt, und die Schlusszeile steht im Fließtext',
    (await v2.locator('.announcement-signoff').count()) === 0 && lastProbe.length > 8 && notes.includes(lastProbe),
    lastProbe,
  );
  await overlay(v2).getByRole('button', { name: 'Alles klar' }).click();
  check('„Alles klar“ merkt sich die Version', await gone(overlay(v2)));
  const marked = await until(() => Promise.resolve(readReg().announcementsSeen?.version), (v) => v === APP_VERSION, 5000);
  check('…in der Registry, nicht in den Saison-Settings', marked === APP_VERSION, String(marked));
  await v2.close();

  // The fireworks, in a window that has not asked for less motion. Reading the pixels back is
  // the whole assertion: a mounted canvas whose loop never runs looks identical from the DOM.
  writeReg((reg) => {
    reg.announcements = [
      { id: 'feuerwerk', title: 'Testfest', body: 'Eine Zeile.\n\nGrüße', date: TODAY.slice(5), celebrate: true },
    ];
  });
  const lively = await browser.newContext({ reducedMotion: 'no-preference', viewport: WIDE });
  try {
    const v3 = await open(lively);
    check('ein Fenster ohne „weniger Bewegung“ bekommt das Feuerwerk', await shown(v3.locator('[data-announcement] canvas')));
    const litPixels = await until(
      () =>
        v3.evaluate(() => {
          const c = /** @type {HTMLCanvasElement | null} */ (document.querySelector('[data-announcement] canvas'));
          const g = c?.getContext('2d');
          if (!c || !g) return -1;
          const d = g.getImageData(0, 0, c.width, c.height).data;
          let n = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
          return n;
        }),
      (n) => n > 200,
      8000,
    );
    check('…und die Schleife malt wirklich', litPixels > 200, `${litPixels} Pixel`);
    // The scrim stays translucent — the app has to remain visible behind it, which is what rules
    // out the obvious trail trick (a half-transparent wash accumulates to opaque in a few frames).
    // Read through the same helper as the reduced-motion window above, so „the two branches pick
    // different scrims" is one comparison rather than two unrelated numbers.
    const scrimLively = await scrimAlphaOf(v3);
    check(
      '…hinter einem durchscheinenden, nie deckenden Schleier — und einem dunkleren als ohne Feuerwerk',
      scrimLively > 0 && scrimLively < 0.95 && scrimLively > scrimReduced,
      `${scrimLively} gegen ${scrimReduced}`,
    );
    await v3.close();
  } finally {
    await lively.close();
  }

  // Leave the demo the way every other case found it: no payload, and a marker that says this
  // version has been seen. A gate that armed an overlay and walked away would break the next run.
  writeReg((reg) => {
    delete reg.announcements;
    reg.announcementsSeen = { version: APP_VERSION };
  });
  const v4 = await open(context);
  check('ohne Payload ist die Überlagerung wieder still', !(await shown(overlay(v4), 2000)));
  await v4.close();

  // ======================================================================== W–Z · the task tree
  //
  // The demo plants the subtask fixtures deliberately — a tree with a coloured and a done child,
  // an archived fourth child the table never shows, and an orphan whose parent is in the
  // Papierkorb — and until now nothing drove them. `npm run check:api` owns the server half of
  // `parent_id` (the two-level rule, self-reference, cycles, the startup flattening); these four
  // cases are the UI half, and they overlap it nowhere: every assertion below is about what the
  // *table* does with a tree the server has already accepted.
  //
  // Three handles carry all of it. `tbody[data-group-id]` is one top-level task with everything
  // folded under it, `tr[data-task-id]` a row, and `data-depth` its **render position** — not
  // `parent_id`, which is the distinction the orphan case exists for. A project page's first
  // `<tbody>` is the Besetzung grid and has none of them, so nothing here counts `tbody` alone.

  /** One group's rows, as `id@depth` — the composer has neither attribute and reads `+@`. */
  const treeRows = (page, id) =>
    page.evaluate(
      (id) =>
        [...document.querySelectorAll(`tbody[data-group-id="${id}"] tr`)].map(
          (tr) => `${tr.getAttribute('data-task-id') ?? '+'}@${tr.getAttribute('data-depth') ?? ''}`,
        ),
      id,
    );
  /** The top-level tasks in the order the table renders them. */
  const treeGroups = (page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('tbody[data-group-id]')].map((tb) => tb.getAttribute('data-group-id')),
    );
  const treeRowCount = (page) => page.locator('tr[data-task-id]').count();
  /**
   * The disclosure chevron in a row's gutter — the *only* button in that cell, the ⠿ beside it
   * being a `<span>`. Addressed that way rather than by title because the title is the state
   * („Einklappen" / „Ausklappen") and a locator that changes with what it asserts is no handle.
   */
  const chevron = (page, id) => page.locator(`tr[data-task-id="${id}"] td:first-child button`);
  /** The counter pill, the second disclosure target. Its own title carries „einklappen" too. */
  const counter = (page, id) =>
    page.locator(`tr[data-task-id="${id}"] button[title*="Unteraufgaben erledigt"]`);
  const rowButton = (page, id, title) => page.locator(`tr[data-task-id="${id}"] button[title="${title}"]`);
  /** The 12 px elbow, i.e. „this row is drawn as somebody's child". A leaf and an orphan have none. */
  const elbows = (page, id) => page.locator(`tr[data-task-id="${id}"] td:first-child span.h-px`).count();
  /**
   * Text of something that may legitimately not be there — every reading below doubles as the
   * failure's own detail, and a locator that matches nothing must report „" rather than throw the
   * remaining cases away with it.
   */
  const textOf = (locator) => locator.first().innerText().catch(() => '');
  /**
   * The chevron's rotation, polled — and read off `rotate`, not off `transform`.
   *
   * Tailwind v4 compiles `rotate-90` to the standalone `rotate` property, so `transform` computes
   * to `none` in *both* states and an assertion written the obvious way fails against working
   * code. And it is a 150 ms `transition-transform` (which in v4 covers `rotate` too), while
   * `reducedMotion: 'reduce'` touches animations and not transitions — so a value sampled straight
   * after the click is mid-flight and neither state.
   */
  const spun = (page, id, want) =>
    until(
      () =>
        chevron(page, id)
          .locator('svg')
          .evaluate((el) => getComputedStyle(el).rotate)
          .catch(() => 'kein Chevron'),
      (r) => (want === 'none' ? r === 'none' : r !== 'none'),
      4000,
    );

  // ======================================================================== W · fold and unfold
  //
  // Read-only, and deliberately against the demo's own season: the tree here is `server/src/
  // demo.ts`'s showcase (task 1 with children 2, 3 coloured and 4 done) and folding writes
  // nothing at all, so there is nothing for a copy to protect.
  console.log('\nW · Unteraufgaben auf- und zuklappen');
  const w = await open(context, '/dashboard');
  await pin(w, HOME, '/project/1');

  // Every first read of a table is polled, never sampled: `ready()` also resolves from
  // `BootReady`'s unconditional 700 ms budget, so a one-shot `count()` taken there reads an empty
  // table on a loaded runner — and „no rows" satisfies half the assertions in this file.
  const plantedTree = await until(() => treeRows(w, 1), (r) => r.length === 4, 8000);
  check(
    'die Demo pflanzt einen Baum: der Elterntask und seine drei lebenden Kinder',
    plantedTree.join(' ') === '1@0 2@1 3@1 4@1',
    plantedTree.join(' '),
  );
  check('…und die Zählerpille daneben sagt, wie viele davon erledigt sind', (await textOf(counter(w, 1))) === '1/3', await textOf(counter(w, 1)));
  check(
    'aufgeklappt tritt die Pille zurück und trägt keinen Fortschritt',
    (await counter(w, 1)
      .evaluate((el) => getComputedStyle(el).backgroundImage)
      .catch(() => 'keine Pille')) === 'none',
  );
  const turnedOpen = await spun(w, 1, 'turned');
  check('…und das Chevron steht wirklich gedreht', turnedOpen === '90deg', turnedOpen);
  // Both sides of `aria-expanded`, like both sides of the rotation: a chevron hardwired to „true"
  // satisfies the folded assertion's opposite and nothing else here would notice.
  check('…und meldet sich als aufgeklappt', (await chevron(w, 1).getAttribute('aria-expanded').catch(() => null)) === 'true');

  const groupsBefore = (await treeGroups(w)).join(' ');
  const rowsBefore = await treeRowCount(w);
  /** @type {string[]} */
  const duringFold = [];
  const watchFold = (r) => {
    if (r.url().includes('/api/')) duringFold.push(`${r.method()} ${r.url().replace(API, '')}`);
  };
  w.on('request', watchFold);
  await chevron(w, 1).click();
  check('zuklappen nimmt die Unteraufgaben aus der Tabelle', await gone(w.locator('tr[data-task-id="2"]')));
  await sleep(500); // long enough for a refetch this must not be making
  w.off('request', watchFold);

  check('…die Gruppe hält danach nur noch ihren Kopf', (await treeRows(w, 1)).join(' ') === '1@0', (await treeRows(w, 1)).join(' '));
  check(
    '…und sonst nichts: die drei Zeilen fehlen, jede andere Gruppe steht unverändert da',
    (await treeRowCount(w)) === rowsBefore - 3 && (await treeGroups(w)).join(' ') === groupsBefore,
    `${await treeRowCount(w)} von ${rowsBefore} Zeilen, ${(await treeGroups(w)).join(' ')}`,
  );
  // The state is `useState` in TaskTable — no request, and nothing to reload. A fold that talked
  // to the server would also be a fold that survived a season switch, which nobody asked for.
  check('…ohne einen einzigen Aufruf: das Falten ist reine Ansicht', duringFold.length === 0, duringFold.join(' | '));
  check('…und das Chevron meldet es an sich selbst', (await chevron(w, 1).getAttribute('aria-expanded').catch(() => null)) === 'false');
  const turnedShut = await spun(w, 1, 'none');
  check('…das Chevron dreht zurück', turnedShut === 'none', turnedShut);
  // Folded, the pill stands in for the rows it hid, so it stops being decoration: 1 of 3 done is
  // a third of its own width. Expanded it was `none` above — the pair is the assertion.
  const fill = await counter(w, 1)
    .evaluate((el) => getComputedStyle(el).backgroundImage)
    .catch(() => 'keine Pille');
  check('…und die Pille trägt den Fortschritt jetzt selbst', fill.includes('linear-gradient') && fill.includes('33%'), fill);
  const pillTitle = (await counter(w, 1).getAttribute('title').catch(() => null)) ?? '';
  check('…und bietet das Gegenteil an', /ausklappen$/.test(pillTitle), pillTitle);

  // The pill is the second disclosure target — for anyone who never notices the chevron.
  await counter(w, 1).click();
  check('die Pille klappt auch wieder auf', (await treeRows(w, 1)).join(' ') === '1@0 2@1 3@1 4@1', (await treeRows(w, 1)).join(' '));
  await chevron(w, 1).click();
  await gone(w.locator('tr[data-task-id="2"]'));
  await w.reload();
  await ready(w);
  check(
    'ein Neuladen zeigt wieder alle Unteraufgaben — gefaltet wird nur die Ansicht',
    (await treeRows(w, 1)).join(' ') === '1@0 2@1 3@1 4@1',
    (await treeRows(w, 1)).join(' '),
  );

  // ======================================================================== X · a new subtask
  //
  // In a copy from here on: everything below writes. The copy keeps every row id, so the demo's
  // tree facts hold inside it — except the orphan, which no copy can carry (see case Z).
  console.log('\nX · Eine Unteraufgabe anlegen');
  const SUB = scoped(subtree.id);
  const x = await open(context, '/dashboard');
  await pin(x, subtree.id, '/project/8');
  const composer = x.locator('input[placeholder^="Neue Unteraufgabe"]');

  // The row first, then what it does *not* carry: `ready()` also resolves from `BootReady`'s
  // unconditional 700 ms budget, so „no chevron, no counter" counted straight after it is 0 and 0
  // on a table that has not rendered a single row yet — the emptiest possible pass.
  const leafRow = await shown(x.locator('tr[data-task-id="31"]'));
  check('Aufgabe 31 ist ein Blatt: kein Chevron, keine Zählerpille', leafRow && (await chevron(x, 31).count()) === 0 && (await counter(x, 31).count()) === 0);
  check('…und bietet trotzdem „Unteraufgabe hinzufügen" an', await shown(rowButton(x, 31, 'Unteraufgabe hinzufügen')));

  await rowButton(x, 31, 'Unteraufgabe hinzufügen').click();
  const composerOpen = await shown(composer);
  check('der Eingabefeld-Platzhalter steht als letzte Zeile der Gruppe', composerOpen && (await treeRows(x, 31)).join(' ') === '31@0 +@', (await treeRows(x, 31)).join(' '));
  check('…und hat den Fokus, ohne dass jemand hineinklicken müsste', (await x.evaluate(() => document.activeElement?.getAttribute('placeholder') ?? '')).startsWith('Neue Unteraufgabe'));

  // Typed *first*: an Escape on an empty composer is discarded by every conceivable build, so the
  // assertion that it writes nothing would hold against one that commits on close as well.
  const beforeAdd = (await api(SUB('/tasks?project_id=8'))).length;
  const abandoned = `Verworfen ${RUN}`;
  await composer.fill(abandoned);
  await x.keyboard.press('Escape');
  check('Escape schließt ihn wieder', await gone(composer));
  const afterEscape = await api(SUB('/tasks?project_id=8'));
  check(
    '…und wirft weg, was darin stand, statt es anzulegen',
    afterEscape.length === beforeAdd && !afterEscape.some((t) => t.title === abandoned),
    `${afterEscape.length} statt ${beforeAdd} Aufgaben`,
  );

  const kidTitle = `Unteraufgabe ${RUN}`;
  await rowButton(x, 31, 'Unteraufgabe hinzufügen').click();
  if (await shown(composer)) {
    await composer.fill(kidTitle);
    await composer.press('Enter');
  }
  const kid = await until(
    () => api(SUB('/tasks?project_id=8')).then((rows) => rows.find((t) => t.title === kidTitle)),
    (t) => !!t,
  );
  check('Enter legt die Unteraufgabe an', !!kid, kid ? `#${kid.id}` : 'nicht gefunden');
  // The server cannot know where a subtask belongs: the composer sends the parent's own scope,
  // so a child created on a project page lands in that project's list rather than in the
  // season-wide „Festival" one.
  check('…unter ihrem Elterntask und in dessen Liste', kid?.parent_id === 31 && kid?.project_id === 8, `parent ${kid?.parent_id}, Projekt ${kid?.project_id}`);
  // The POST resolves a query before the row does — `onAdded` invalidates and the table re-renders
  // on the refetch — so the row is a wait, not a read taken the moment the API knows about it.
  const grown = await until(() => treeRows(x, 31), (r) => r.length === 3, 8000);
  check('…und sie erscheint eingerückt in derselben Gruppe', grown.join(' ') === `31@0 ${kid?.id}@1 +@`, grown.join(' '));
  check('das Blatt ist damit ein Elterntask geworden', (await chevron(x, 31).count()) === 1 && (await textOf(counter(x, 31))) === '0/1', await textOf(counter(x, 31)));
  // Deliberate: the composer is the „add several" affordance, so it stays for the next title.
  check('…und der Composer bleibt für die nächste stehen', await shown(composer, 2000));
  // The UI half of the server's 400 (`check:api`: „a third level is refused"): the row that would
  // ask for one does not offer the button. Keyed on `parent_id`, which is why case Z can tell the
  // two tests apart.
  const kidId = kid?.id ?? -1;
  check('eine Unteraufgabe bekommt selbst keine Unteraufgaben angeboten', !!kid && (await rowButton(x, kidId, 'Unteraufgabe hinzufügen').count()) === 0);
  check('…und auch kein „Verschieben“: sie reist mit ihrem Elterntask', !!kid && (await rowButton(x, kidId, 'Verschieben').count()) === 0);

  await x.keyboard.press('Escape');
  await gone(composer);
  // A composer opened into a folded group would be invisible, so `startSubtask` unfolds first.
  await chevron(x, 32).click();
  await gone(x.locator('tr[data-task-id="33"]'));
  await rowButton(x, 32, 'Unteraufgabe hinzufügen').click();
  check(
    '„＋“ auf einer zugeklappten Gruppe klappt sie erst auf',
    (await shown(composer)) && (await treeRows(x, 32)).join(' ') === '32@0 33@1 +@',
    (await treeRows(x, 32)).join(' '),
  );
  await x.keyboard.press('Escape');
  await gone(composer);

  // ======================================================================== Y · done, up or down
  //
  // „Erledigt" is not a literal: the done value is whichever Status option carries the flag.
  console.log('\nY · Erledigt: Elterntask und Kind');
  const subColumns = await api(SUB('/custom-columns'));
  const subStatus = subColumns.find((c) => c.kind === 'builtin' && c.key === 'status');
  const subDone = JSON.parse(subStatus?.options ?? '[]').find((o) => o.done)?.value ?? 'done';
  const setStatus = async (page, id, value) => {
    // Two `listbox` triggers per row (Status and Bereich); the first is Status. And
    // `useAnchoredPopover` closes on any scroll outside its menu — including the one `click()`
    // performs for itself — so the trigger is scrolled into view first.
    const trigger = page.locator(`tr[data-task-id="${id}"] button[aria-haspopup="listbox"]`).first();
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    const option = page.locator(`[role="option"][data-value="${value}"]`).first();
    if (await shown(option, 5000)) await option.click();
    else await page.keyboard.press('Escape');
  };

  await x.goto(`${UI}/#/project/1`);
  await x.reload(); // a `goto` to another hash keeps data-app-ready — it says nothing about the route
  await ready(x);
  const copiedTree = await until(() => treeRows(x, 1), (r) => r.length === 4, 8000);
  check('die Kopie trägt denselben Baum', copiedTree.join(' ') === '1@0 2@1 3@1 4@1', copiedTree.join(' '));

  await setStatus(x, 2, subDone);
  const kidsDone = await until(() => textOf(counter(x, 1)), (t) => t === '2/3', 8000);
  check('ein erledigtes Kind zählt sofort mit', kidsDone === '2/3', kidsDone);
  // A status change re-sorts, and the question is *where* it sorts to: inside the group, never
  // out of it. Both halves in one read, because a row that left would satisfy „it is behind its
  // sibling" vacuously.
  const insideGroup = await treeRows(x, 1);
  check('…bleibt aber eingerückt bei seinem Elterntask', insideGroup.includes('2@1'), insideGroup.join(' '));
  // Both positions have to be *found* before one can be behind the other: a missing „3@1" is -1,
  // and -1 is below every index there is — the comparison would pass on a group that lost the row
  // the assertion is about.
  const openSister = insideGroup.indexOf('3@1');
  const doneSister = insideGroup.indexOf('2@1');
  check(
    '…und sinkt innerhalb der Gruppe unter die offene Schwester',
    openSister >= 0 && doneSister >= 0 && openSister < doneSister,
    insideGroup.join(' '),
  );
  const parentAfterKid = await api(SUB('/tasks/1'));
  check('…der Elterntask wird davon nicht miterledigt', parentAfterKid.status !== subDone, String(parentAfterKid.status));

  await setStatus(x, 1, subDone);
  const sunk = await until(() => treeGroups(x), (g) => g[g.length - 1] === '1', 8000);
  check('ein erledigter Elterntask sinkt ans Ende der Tabelle', sunk[sunk.length - 1] === '1', sunk.join(' '));
  const travelled = await treeRows(x, 1);
  check(
    '…und nimmt seine Unteraufgaben mit, statt sie oben zurückzulassen',
    travelled[0] === '1@0' && [...travelled.slice(1)].sort().join(' ') === '2@1 3@1 4@1',
    travelled.join(' '),
  );
  const kidsAfterParent = (await api(SUB('/tasks?project_id=1'))).filter((t) => t.parent_id === 1);
  check(
    '…erledigt sie aber nicht mit',
    kidsAfterParent.some((t) => t.id === 3 && t.status !== subDone),
    kidsAfterParent.map((t) => `${t.id}:${t.status}`).join(' '),
  );
  check('…und die Pille steht auch auf der grauen Zeile noch richtig', (await textOf(counter(x, 1))) === '2/3', await textOf(counter(x, 1)));

  // ======================================================================== Z · the orphan
  //
  // A subtask whose parent is in the Papierkorb. The rule is „never hide a task just because its
  // parent is gone", so `effectiveParent` promotes it to top level — a *render* decision, which
  // is why the stored `parent_id` is asserted beside it.
  //
  // The first half runs on the demo's own season, because no copy can carry the fixture:
  // `createSeason` drops soft-deleted rows and nulls a `parent_id` whose parent stayed behind, so
  // in a copy task 12 is an ordinary root task that looks exactly the same on screen.
  console.log('\nZ · Die verwaiste Unteraufgabe');
  await w.goto(`${UI}/#/project/5`);
  await w.reload();
  await ready(w);

  const waise = await until(() => treeRows(w, 12), (r) => r.length === 1, 8000);
  check('die Waise steht als eigene Gruppe auf oberster Ebene', waise.join(' ') === '12@0', waise.join(' '));
  // „It renders flat" is the absence of the elbow — and alone that passes on a build that draws
  // no connectors at all, so a real child of the same table is measured in the same breath.
  check(
    '…ohne Verbindungslinie, anders als ein echtes Kind daneben',
    (await elbows(w, 12)) === 0 && (await elbows(w, 46)) === 1,
    `Waise ${await elbows(w, 12)}, Kind ${await elbows(w, 46)}`,
  );
  check('…während ihr parent_id unangetastet auf den gelöschten Elterntask zeigt', (await api('/tasks/12')).parent_id === 11, String((await api('/tasks/12')).parent_id));
  // The one row where the two tests disagree: „Verschieben" asks the render depth (TTU-30 —
  // moving it is how the user repairs it), „Unteraufgabe hinzufügen" asks `parent_id` (TTU-15 —
  // offering it here is how a three-level tree gets built). Both, or the swap goes unnoticed.
  check('…sie lässt sich verschieben — so repariert man sie', (await rowButton(w, 12, 'Verschieben').count()) === 1);
  check('…bekommt aber keine eigenen Unteraufgaben angeboten', (await rowButton(w, 12, 'Unteraufgabe hinzufügen').count()) === 0);
  check(
    '…und ein echtes Kind hat beides nicht, ein echter Elterntask beides',
    (await rowButton(w, 46, 'Verschieben').count()) === 0 &&
      (await rowButton(w, 46, 'Unteraufgabe hinzufügen').count()) === 0 &&
      (await rowButton(w, 41, 'Verschieben').count()) === 1 &&
      (await rowButton(w, 41, 'Unteraufgabe hinzufügen').count()) === 1,
    `Kind ${await rowButton(w, 46, 'Verschieben').count()}/${await rowButton(w, 46, 'Unteraufgabe hinzufügen').count()}, Elterntask ${await rowButton(w, 41, 'Verschieben').count()}/${await rowButton(w, 41, 'Unteraufgabe hinzufügen').count()}`,
  );

  // Why the pair survives at all: the parent cannot be purged while a live child references it
  // (SDL-01), and the Papierkorb says so rather than promising a date it will not keep.
  await w.goto(`${UI}/#/archiv`);
  await w.reload();
  await ready(w);
  const parentRow = w.locator('div.divide-y > div').filter({ hasText: 'Gelöschter Elterntask' });
  check(
    'der Papierkorb erklärt, warum das Paar bleibt',
    (await shown(parentRow)) && /bleibt, bis abhängige Einträge entfernt sind/.test(await parentRow.first().innerText()),
    (await parentRow.first().innerText().catch(() => 'keine Zeile')).replace(/\n/g, ' | '),
  );

  // The other half, in the copy: how the app *makes* one. The count in the dialog is the TTU-05
  // assertion — it comes from the `scope: 'all'` list, so it sees the archived child 53 that the
  // table does not, and a count taken from the rendered rows would say three.
  const allTasks = x.waitForResponse((r) => r.url().includes('tasks?scope=all'), { timeout: 20_000 }).catch(() => null);
  await x.goto(`${UI}/#/project/1`);
  await x.reload();
  await ready(x);
  await allTasks;
  const shownKids = await until(() => treeRows(x, 1), (r) => r.length === 4, 8000);
  check('die Tabelle zeigt drei Unteraufgaben', shownKids.filter((r) => r.endsWith('@1')).length === 3, shownKids.join(' '));

  // The number is frozen into the dialog when the 🗑 is pressed, so the response wait above is
  // necessary and not sufficient: React still has to commit the query before the click handler
  // reads it. Asking again is the only correct fix — nothing about the tree changes while the
  // dialog is up, and a build that counts from the rendered rows answers „3" at every attempt.
  const askHeading = x.getByRole('heading', { name: 'Aufgabe löschen' });
  const ask = topDialog(x);
  let askedKids = false;
  let askText = '';
  for (let attempt = 0; attempt < 4 && !/4 Unteraufgaben/.test(askText); attempt++) {
    if (attempt) {
      await x.keyboard.press('Escape');
      await gone(askHeading);
      await sleep(250);
    }
    await rowButton(x, 1, 'Löschen').click();
    askedKids = await shown(askHeading);
    if (!askedKids) break;
    askText = await ask.innerText();
  }
  check('das Löschen eines Elterntasks fragt nach den Kindern', askedKids);
  check(
    '…und zählt die archivierte vierte mit, die auf dem Schirm gar nicht steht (TTU-05)',
    askedKids && /4 Unteraufgaben/.test(askText),
    askText.replace(/\n/g, ' | '),
  );
  if (askedKids) await ask.getByRole('button', { name: 'Nur diese Aufgabe' }).click();
  const orphaned = await until(() => treeRows(x, 2), (r) => r.length > 0, 8000);
  check('„Nur diese Aufgabe" nimmt allein den Elterntask mit', (await send('GET', SUB('/tasks/1'))).status === 404 && (await send('GET', SUB('/tasks/2'))).status === 200);
  check('…seine Kinder bleiben und stehen als eigene Gruppen da', orphaned.join(' ') === '2@0' && (await treeRows(x, 3)).join(' ') === '3@0', `${orphaned.join(' ')} / ${(await treeRows(x, 3)).join(' ')}`);
  check('…ohne das Angebot, selbst welche zu bekommen', (await rowButton(x, 2, 'Unteraufgabe hinzufügen').count()) === 0 && (await rowButton(x, 3, 'Unteraufgabe hinzufügen').count()) === 0);
  check('…und mit unverändertem parent_id: die Beförderung ist Darstellung, kein Schreibvorgang', (await api(SUB('/tasks/2'))).parent_id === 1, String((await api(SUB('/tasks/2'))).parent_id));

  await x.goto(`${UI}/#/archiv`);
  await x.reload();
  await ready(x);
  const binnedParent = x.locator('div.divide-y > div').filter({ hasText: 'Instrumente – Anmietung und Transport' });
  // Asserted rather than merely guarded: without this the missing row is silent here and surfaces
  // ten seconds later as „the children were not re-nested", which is a different bug.
  const parentInBin = check('der gelöschte Elterntask liegt im Papierkorb', await shown(binnedParent));
  if (parentInBin) await binnedParent.getByRole('button', { name: 'Wiederherstellen' }).first().click();
  await until(() => send('GET', SUB('/tasks/1')).then((r) => r.status), (s) => s === 200);
  await x.goto(`${UI}/#/project/1`);
  await x.reload();
  await ready(x);
  const renested = await until(() => treeRows(x, 1), (r) => r.length === 4, 8000);
  check(
    'wird der Elterntask wiederhergestellt, hängen die Kinder wieder unter ihm',
    renested.filter((r) => r.endsWith('@1')).length === 3,
    renested.join(' '),
  );

  // ======================================================================== AA–AC · the toolbox
  //
  // What sits in front of case H. That one asserts a note *saves* — on blur, and through the door
  // React's delegated `onBlur` cannot see; these three are the buttons above the text: the marks
  // the toolbar writes, the closed colour palette (WP-62) and the trimmed bar a task comment gets.
  //
  // The Markdown round-trip itself is **not** re-asserted here. `npm run check:markdown` drives
  // the same dialect in jsdom over a corpus of some seventy constructs, which is where a
  // serializer question belongs. What is asserted below is the other half of that boundary, and
  // the half no headless editor can answer: that pressing a button really produces the mark, that
  // pressing it again really takes it back, and that what the toolbar produced is what the
  // *server* ends up holding.
  //
  // In a copy from the first line — all three type into a note and save it.

  const BOX = scoped(toolbox.id);
  /** The eight tones, in the order `TEXT_COLORS` offers them. */
  const PALETTE = ['Rot', 'Orange', 'Bernstein', 'Grün', 'Türkis', 'Blau', 'Violett', 'Pink'];
  /** What `.tc-blau` and `.tc-tuerkis` paint — hand-written hex in `index.css`, so a plain `rgb()`. */
  const BLAU = 'rgb(29, 78, 216)';
  const TUERKIS = 'rgb(15, 118, 110)';

  /**
   * Click something a broken build may simply not have.
   *
   * Every button below is one a reverted fix can delete, and an unguarded `click()` on a locator
   * that matches nothing waits out its timeout and then **throws** — which takes the whole run
   * down at the first red instead of letting the assertions after it report. A canary has to go
   * red by assertion, and a canary that removes one button should not hide what the other
   * fourteen still do.
   */
  const clickIfThere = (locator, timeout = 5000) =>
    locator
      .first()
      .click({ timeout })
      .then(() => true)
      .catch(() => false);

  /** A box, or `null` — `boundingBox()` on a locator that matches nothing throws like the rest. */
  const boxOf = (locator) =>
    locator
      .first()
      .boundingBox()
      .catch(() => null);

  const toolbarBtn = (page, title) => page.locator(`.rte-root button[title="${title}"]`);
  /** The trigger's tooltip carries the platform's own spelling of the chord — anchor with `^=`. */
  const colorTrigger = (page) => page.locator('.rte-root button[title^="Schriftfarbe"]');
  const palette = (page) => page.locator('[role="dialog"][aria-label="Schriftfarbe"]');
  /**
   * Leave nothing open behind a failed assertion. The palette has no backdrop, so an open one does
   * not block a click — but it does own the ⌘⇧F chord and it does sit over the text, and a case
   * that fails halfway through a pick would otherwise hand the next one a menu it never opened.
   */
  const closePalette = async (page) => {
    if ((await palette(page).count()) === 0) return;
    await page.keyboard.press('Escape');
    await gone(palette(page), 4000);
  };

  /**
   * The editor's own selection, straight off the view's DOM node.
   *
   * ProseMirror stamps the TipTap instance onto `.rte-content`, so this is the whole handle — no
   * marker character typed and read back. Returned rather than asserted, because every caller
   * below wants the range in its failure detail.
   */
  const caretIn = (page) =>
    page
      .evaluate(() => {
        const ed = /** @type {any} */ (document.querySelector('.rte-content'))?.editor;
        if (!ed) return null;
        const { from, to } = ed.state.selection;
        return { from, to, text: ed.state.doc.textBetween(from, to, ' ') };
      })
      .catch(() => null);

  /**
   * Select the last `n` characters of the note — and poll until the editor agrees that is what is
   * selected.
   *
   * Both halves are load-bearing. `End` pressed straight after a click runs against the caret the
   * editor had *before* it (`DOMObserver` flushes on a ~20 ms timer), so the arrows start from the
   * wrong place: measured here, click → `End` → nine `Shift+ArrowLeft` left a **five**-character
   * range and „Standard" then un-coloured half the run, which reads as „removing a colour is
   * broken". And a mark applied to an *empty* selection changes nothing at all, so every
   * assertion after it fails for a reason that is not the one under test. The caller asserts the
   * range it got back.
   */
  const selectTail = async (page, n) => {
    await page.keyboard.press('End');
    for (let i = 0; i < n; i++) await page.keyboard.press('Shift+ArrowLeft');
    return until(() => caretIn(page), (s) => !!s && s.to - s.from === n, 4000);
  };

  /**
   * Open an `InlineNotes` reader: a text run, never the box — its centre may be a link or an image.
   *
   * `:not(.rte-content)` because `.prose-md` is *both* surfaces (see `saveNote`): the bare selector
   * would happily „open" an editor that is already open and report success.
   */
  const openNote = async (page) => {
    const reader = page.locator('.prose-md:not(.rte-content)').first();
    if (!(await shown(reader, 8000))) return false;
    await clickIfThere(reader.locator('p'));
    // Not `open`: that is this file's „open a page" helper, and shadowing it here would be a trap
    // of its own the next time somebody needs a second page inside this block.
    const editing = await shown(page.locator('.rte-content.ProseMirror-focused'), 8000);
    await sleep(150); // TipTap's focus lands a frame late, and `End` would run against the old caret
    return editing;
  };

  /**
   * ⌘↵ / Ctrl+↵ is the editor's own save: it blurs itself, and blur is what commits (WP-49).
   *
   * The wait is on the **editor going away**, not on the reader arriving, and that is not a
   * preference: the editable node's own class list is `prose-md prose-md--roomy rte-content …`,
   * so `.prose-md` matches the editor as happily as the reading view and waiting for it is
   * satisfied by the surface that is already there. `InlineNotes` leaves edit mode only once the
   * write resolved (RTE-01), which is what makes `.rte-root` detaching the signal — and a
   * `openNote` that runs into the gap clicks the editor's own paragraph, sees it re-focus, and is
   * then unmounted mid-case. It cost this case's first run.
   *
   * **`CommentCell` is the exception, so this says „the editor is gone" and not „the write
   * landed".** Its `onBlur` runs `setEditing(false)` *before* `onCommit`, where `InlineNotes`
   * awaits — so for a comment the detach happens while the PATCH is still in flight, and the
   * caller has to poll the API for a value only the write can produce (AC does; a predicate the
   * pre-write row already satisfies is a coin toss).
   */
  const saveNote = async (page, reader) => {
    await page.keyboard.press('ControlOrMeta+Enter');
    await gone(page.locator('.rte-root'), 10_000);
    return shown(reader, 8000);
  };

  // ======================================================================== AA · marks
  console.log('\nAA · Die Werkzeugleiste zeichnet aus und nimmt zurück');
  const t = await open(context, '/dashboard');
  await pin(t, toolbox.id, '/project/2');

  const noteReader = t.locator('.prose-md:not(.rte-content)').first();
  /** Project 2's description, as the demo seeds it — the short plain note this case grows. */
  const PLAIN_NOTE = String((await api(BOX('/projects/2'))).description ?? '');
  const MARK_WORD = 'Fettprobe';
  const COLOR_WORD = 'Farbprobe';

  // The pair every „the toolbar is there" assertion needs: counted on its own, „no Fett button"
  // is also true of a page whose card has not rendered yet, which is the emptiest possible pass.
  check(
    'im Lesezustand steht die Notiz da und keine Leiste darüber',
    PLAIN_NOTE.length > 0 && (await shown(noteReader)) && (await toolbarBtn(t, 'Fett').count()) === 0,
    PLAIN_NOTE || 'leere Notiz',
  );

  await openNote(t);
  check(
    'ein Klick in den Text bringt sie — samt „Zitat“, denn dies ist ein dokumentgroßes Feld',
    (await toolbarBtn(t, 'Fett').count()) === 1 && (await toolbarBtn(t, 'Zitat').count()) === 1,
  );

  await t.keyboard.press('End');
  await t.keyboard.type(` ${MARK_WORD}`);
  const markedRun = await selectTail(t, MARK_WORD.length);
  check(
    'ein getippter Lauf ist ausgewählt — genau er, nicht der Satz davor',
    markedRun?.text === MARK_WORD,
    markedRun ? `${markedRun.from}–${markedRun.to} „${markedRun.text}“` : 'keine Auswahl',
  );

  /** `aria-pressed` is the only thing that says „the toolbar noticed", so it is read on both sides. */
  const pressed = (title) => toolbarBtn(t, title).getAttribute('aria-pressed').catch(() => null);
  check('„Fett“ meldet sich vorher als nicht gesetzt', (await pressed('Fett')) === 'false', String(await pressed('Fett')));
  await clickIfThere(toolbarBtn(t, 'Fett'));
  const boldOn = await until(() => pressed('Fett'), (v) => v === 'true', 4000);
  check('…und nach dem Klick als gesetzt', boldOn === 'true', String(boldOn));

  const strong = t.locator('.rte-content strong');
  const em = t.locator('.rte-content em');
  const underlined = t.locator('.rte-content u');
  check(
    '…und der Lauf steht wirklich fett im Text, und nur er',
    (await strong.count()) === 1 && (await textOf(strong)) === MARK_WORD,
    `${await strong.count()}× fett: „${await textOf(strong)}“`,
  );

  await clickIfThere(toolbarBtn(t, 'Unterstrichen'));
  await clickIfThere(toolbarBtn(t, 'Kursiv'));
  const italicOn = await until(() => pressed('Kursiv'), (v) => v === 'true', 4000);
  check(
    'drei Auszeichnungen stapeln sich auf demselben Lauf',
    italicOn === 'true' && (await em.count()) === 1 && (await underlined.count()) === 1,
    `${await em.count()}× kursiv, ${await underlined.count()}× unterstrichen`,
  );

  await clickIfThere(toolbarBtn(t, 'Kursiv'));
  const italicOff = await until(() => pressed('Kursiv'), (v) => v === 'false', 4000);
  check('ein zweiter Klick nimmt genau eine davon zurück', italicOff === 'false' && (await em.count()) === 0, `${italicOff}, ${await em.count()}× kursiv`);
  check(
    '…und lässt die beiden anderen stehen — sonst wäre „zurücknehmen“ nur „alles wegwerfen“',
    (await strong.count()) === 1 && (await underlined.count()) === 1 && (await pressed('Fett')) === 'true',
    `${await strong.count()}× fett, ${await underlined.count()}× unterstrichen`,
  );

  await saveNote(t, noteReader);
  const storedMarks = await until(
    () => api(BOX('/projects/2')).then((p) => String(p.description ?? '')),
    (d) => d.includes(MARK_WORD),
    8000,
  );
  check('die Auszeichnung landet so in der gespeicherten Fassung', storedMarks.includes(`**<u>${MARK_WORD}</u>**`), storedMarks);
  check(
    '…und nur auf ihrem Lauf: der Satz davor ist unausgezeichnet geblieben',
    storedMarks.startsWith(PLAIN_NOTE) &&
      (await noteReader.locator('strong').count()) === 1 &&
      (await noteReader.locator('em').count()) === 0,
    `${await noteReader.locator('strong').count()}× fett, ${await noteReader.locator('em').count()}× kursiv`,
  );

  // …and the other direction through the same door. A mark that comes back on the next save is
  // the failure a customer meets a day later, and „it is gone from the screen" cannot see it.
  await openNote(t);
  const reselected = await selectTail(t, MARK_WORD.length);
  check('der gespeicherte Lauf lässt sich wieder auswählen', reselected?.text === MARK_WORD, reselected ? `„${reselected.text}“` : 'keine Auswahl');
  const boldRead = await until(() => pressed('Fett'), (v) => v === 'true', 4000);
  check('…und die Leiste liest ab, was auf ihm liegt', boldRead === 'true', String(boldRead));
  await clickIfThere(toolbarBtn(t, 'Fett'));
  await saveNote(t, noteReader);
  const clearedMarks = await until(
    () => api(BOX('/projects/2')).then((p) => String(p.description ?? '')),
    (d) => !d.includes('**'),
    8000,
  );
  check('das Zurücknehmen wird genauso gespeichert', !clearedMarks.includes('**') && (await noteReader.locator('strong').count()) === 0, clearedMarks);
  check('…und nimmt die Unterstreichung nicht mit', clearedMarks.includes(`<u>${MARK_WORD}</u>`), clearedMarks);

  // ======================================================================== AB · the colour palette
  //
  // Back to the plain note first: this case grows its own run, and starting on the previous one's
  // would make „the sentence beside it stayed uncoloured" a statement about `<u>` instead.
  console.log('\nAB · Die Schriftfarbe: Palette, Klick daneben, Zurücknehmen');
  await send('PATCH', BOX('/projects/2'), { description: PLAIN_NOTE });
  await t.reload();
  await ready(t);

  const trigger = colorTrigger(t);
  const colorMenu = palette(t);
  const layers = () => t.locator('.fixed.inset-0').count();
  const glyph = () => trigger.locator('span').first().getAttribute('class').catch(() => '');

  await openNote(t);
  await t.keyboard.press('End');
  await t.keyboard.type(` ${COLOR_WORD}`);
  const toPaint = await selectTail(t, COLOR_WORD.length);
  check('ein Lauf ist ausgewählt, auf den eine Farbe passt', toPaint?.text === COLOR_WORD, toPaint ? `„${toPaint.text}“` : 'keine Auswahl');

  const layersClosed = await layers();
  check(
    'geschlossen: keine Palette, und der Knopf sagt es auch',
    (await colorMenu.count()) === 0 && (await trigger.getAttribute('aria-expanded').catch(() => null)) === 'false',
    String(await trigger.getAttribute('aria-expanded').catch(() => null)),
  );

  await clickIfThere(trigger);
  const openedByClick = await shown(colorMenu, 4000);
  check(
    'der Schriftfarben-Knopf öffnet sie',
    openedByClick && (await trigger.getAttribute('aria-expanded').catch(() => null)) === 'true',
    String(await trigger.getAttribute('aria-expanded').catch(() => null)),
  );
  // The one thing this colorMenu does *not* have, and the reason: a portalled backdrop would take the
  // click, and the editor treats a click landing outside `.rte-root` as „the user left" — it would
  // commit and unmount the note under the open colorMenu (RTE-02). Every other popover in the app does
  // hang one off `document.body`, `ColorSwatchPicker` (the task row's „Farbe wählen") included, so
  // „the colour picker's click-away layer is a second `.fixed.inset-0`" is true of that one and
  // false of this one. Asserted as a count rather than argued, because `topDialog` depends on it.
  check(
    '…ohne eine Klickfangschicht darüber: `topDialog` bleibt, was es war',
    (await layers()) === layersClosed,
    `${layersClosed} → ${await layers()}`,
  );
  check(
    '…denn sie hängt im Editor selbst, nicht am Dokument',
    await colorMenu.evaluate((el) => !!el.closest('.rte-root')).catch(() => false),
  );
  const swatches = await colorMenu
    .locator('[data-roving]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
    .catch(() => []);
  check(
    'die Palette ist geschlossen: acht Töne und „Standard“',
    swatches.join(' ') === PALETTE.join(' ') && (await colorMenu.getByRole('button', { name: 'Standard', exact: true }).count()) === 1,
    swatches.join(' ') || 'keine Felder',
  );

  await clickIfThere(colorMenu.getByRole('button', { name: 'Blau', exact: true }));
  check('ein Griff in die Palette schließt sie wieder', await gone(colorMenu, 4000));
  await closePalette(t);
  const blau = t.locator('.rte-content span.tc-blau');
  const paintedColor = await blau.first().evaluate((el) => getComputedStyle(el).color).catch(() => 'kein Lauf');
  const plainColor = await t.locator('.rte-content p').first().evaluate((el) => getComputedStyle(el).color).catch(() => 'kein Absatz');
  check(
    '…und färbt genau den ausgewählten Lauf',
    (await blau.count()) === 1 && (await textOf(blau)) === COLOR_WORD && paintedColor === BLAU,
    `${await blau.count()}× „${await textOf(blau)}“ in ${paintedColor}`,
  );
  // The other half: a colour read off the coloured run says nothing until the text beside it has
  // been read *un*coloured — a stylesheet that paints everything #1d4ed8 looks the same from here.
  check('…und nur ihn: der Satz daneben behält die Textfarbe', plainColor !== BLAU, plainColor);
  const glyphShut = await until(glyph, (c) => /\btc-/.test(c), 4000);
  check('der Knopf zeigt danach die Farbe, in der der Cursor steht', /\btc-blau\b/.test(glyphShut), glyphShut);

  await clickIfThere(trigger);
  await shown(colorMenu, 4000);
  const active = await colorMenu
    .locator('[data-roving]')
    .evaluateAll((els) => els.filter((e) => e.getAttribute('aria-pressed') === 'true').map((e) => e.getAttribute('data-color')))
    .catch(() => []);
  check('wieder geöffnet ist genau der eine Ton markiert', active.join(' ') === 'blau', active.join(' ') || 'keiner');
  // The other half of the preview, and it belongs **here** rather than at the first open: with no
  // colour applied yet `color` is null, so the class is absent whatever `open` does and the
  // assertion is satisfied by a build that previews while open as well as by one that never
  // previews at all. The caret is in the blue run now, so the line above holds `tc-blau` on a
  // closed trigger and this one requires it gone while the menu is up — a #1d4ed8 „A" on the
  // #262626 the open trigger paints is not a preview of anything.
  const glyphOpen = await glyph();
  check('…und der Knopf lässt seine Vorschau fallen, solange sie offen steht', !/\btc-/.test(glyphOpen), glyphOpen);

  const caretBefore = await caretIn(t);
  const paraBox = await boxOf(t.locator('.rte-content p'));
  if (paraBox) await t.mouse.click(paraBox.x + 12, paraBox.y + paraBox.height / 2);
  check('ein Klick in den Text schließt die Palette', await gone(colorMenu, 4000));
  // …and the same click *lands*, which is the whole reason there is no backdrop — and the only
  // thing that tells the two designs apart, since a swallowed click closes the colorMenu just as well.
  const caretAfter = await until(() => caretIn(t), (s) => !!s && s.from !== caretBefore?.from, 4000);
  check(
    '…und setzt dabei den Cursor, statt geschluckt zu werden',
    !!caretAfter && caretAfter.from !== caretBefore?.from,
    `${caretBefore?.from} → ${caretAfter?.from}`,
  );
  check('…während die Notiz im Bearbeitungsmodus bleibt', (await t.locator('.rte-content').count()) === 1);
  const glyphMoved = await until(glyph, (c) => !/\btc-/.test(c), 4000);
  check('…was der Knopf mitbekommt: dort, wo er jetzt steht, ist keine Farbe', !/\btc-/.test(glyphMoved), glyphMoved);

  // Whatever the click-away did, the chord below has to start from a closed palette — otherwise
  // a broken click-away turns „⌘⇧F opens it“ into „⌘⇧F closes it“ and the case reports the
  // wrong defect.
  await closePalette(t);

  // The keyboard route, and why it exists at all: every toolbar button is `tabIndex={-1}` (WP-43),
  // so this is the only way in without a mouse. It used to reach `GlobalSearch`'s ⌘F listener
  // instead, which takes focus *outside* `.rte-root` — i.e. it committed the note and unmounted
  // the editor, picker and all. Pressing it twice is exactly the shape that used to do that.
  await selectTail(t, COLOR_WORD.length);
  await t.keyboard.press('ControlOrMeta+Shift+F');
  const openedByKey = await shown(colorMenu, 4000);
  const grabbed = await t.evaluate(() => document.activeElement?.getAttribute('data-color') ?? null);
  check('⌘⇧F öffnet sie und setzt den Fokus auf den Ton, der schon gilt', openedByKey && grabbed === 'blau', String(grabbed));
  await t.keyboard.press('ControlOrMeta+Shift+F');
  check('…ein zweites Mal schließt sie wieder', await gone(colorMenu, 4000));
  check('…ohne die Notiz zu speichern und den Editor abzuräumen', (await t.locator('.rte-content').count()) === 1);
  check(
    '…und gibt den Cursor zurück in den Text',
    await t
      .waitForFunction(() => !!document.querySelector('.rte-content')?.contains(document.activeElement), null, { timeout: 4000 })
      .then(() => true)
      .catch(() => false),
  );
  await closePalette(t);

  // „Standard" needs the run *selected*: over an empty selection `unsetMark` only drops the stored
  // mark and the span on screen keeps its colour — while the trigger previews it and the swatch
  // reads `aria-pressed="true"`, so everything on screen says it should have worked.
  const toClear = await selectTail(t, COLOR_WORD.length);
  check(
    'vor dem Zurücknehmen liegt die Auswahl auf dem gefärbten Lauf',
    toClear?.text === COLOR_WORD && (await blau.count()) === 1,
    `„${toClear?.text ?? ''}“, ${await blau.count()}× gefärbt`,
  );
  await clickIfThere(trigger);
  await shown(colorMenu, 4000);
  await clickIfThere(colorMenu.getByRole('button', { name: 'Standard', exact: true }));
  await gone(colorMenu, 4000);
  await closePalette(t);
  check('„Standard“ nimmt die Farbe zurück', (await until(() => blau.count(), (n) => n === 0, 4000)) === 0);
  check('…und lässt den Text stehen, statt ihn mitzunehmen', (await textOf(t.locator('.rte-content p'))).includes(COLOR_WORD));

  // Both directions through the save, because a colour that lives only until the note is closed
  // is not a colour the customer has.
  await selectTail(t, COLOR_WORD.length);
  await clickIfThere(trigger);
  await shown(colorMenu, 4000);
  await clickIfThere(colorMenu.getByRole('button', { name: 'Türkis', exact: true }));
  await gone(colorMenu, 4000);
  await closePalette(t);
  await saveNote(t, noteReader);
  const storedColor = await until(
    () => api(BOX('/projects/2')).then((p) => String(p.description ?? '')),
    (d) => d.includes('tc-'),
    8000,
  );
  check('die Farbe steht als Klasse in der gespeicherten Fassung', storedColor.includes(`<span class="tc-tuerkis">${COLOR_WORD}</span>`), storedColor);
  check(
    '…und die gelesene Fassung malt sie wirklich',
    (await noteReader.locator('span.tc-tuerkis').first().evaluate((el) => getComputedStyle(el).color).catch(() => 'kein Lauf')) === TUERKIS,
    await noteReader.locator('span.tc-tuerkis').first().evaluate((el) => getComputedStyle(el).color).catch(() => 'kein Lauf'),
  );

  await openNote(t);
  await selectTail(t, COLOR_WORD.length);
  await clickIfThere(trigger);
  await shown(colorMenu, 4000);
  await clickIfThere(colorMenu.getByRole('button', { name: 'Standard', exact: true }));
  await gone(colorMenu, 4000);
  await closePalette(t);
  await saveNote(t, noteReader);
  const clearedColor = await until(
    () => api(BOX('/projects/2')).then((p) => String(p.description ?? '')),
    (d) => !d.includes('tc-'),
    8000,
  );
  check('…und das Zurücknehmen wird ebenso gespeichert', !clearedColor.includes('tc-') && clearedColor.includes(COLOR_WORD), clearedColor);

  // ======================================================================== AC · the compact bar
  //
  // The same toolbox, trimmed. `compact` is one prop and nothing checks that it *stays* trimmed —
  // a task comment is a cell in a table, and „Tabelle einfügen" or „Bild einfügen" in there is how
  // a Saalplan ends up inside a row. So the case is a pair: the seven buttons that must be there,
  // and the document-sized ones that must not. The palette is deliberately *not* behind that gate
  // — a colour is inline formatting like B/I/U — so it is driven here all the way to the cell's
  // own stored value.
  console.log('\nAC · Die schmale Leiste im Kommentar');
  await t.goto(`${UI}/#/project/7`);
  await t.reload();
  await ready(t);
  const commented = t.locator('[data-task-id="30"]');
  const commentReader = commented.locator('.prose-md:not(.rte-content)').first();
  check(
    'die Demo pflanzt einen gefärbten Kommentar in Aufgabe 30',
    (await shown(commentReader)) && (await commentReader.locator('span[class^="tc-"]').count()) === 1,
    await textOf(commentReader),
  );
  await commented.scrollIntoViewIfNeeded().catch(() => {}); // a missing row must report AC, not abort the run

  // A *double* click: `CommentCell` binds `onDoubleClick` where `InlineNotes` binds `onClick`, so
  // the recipe that opens a description opens nothing here — and „no compact toolbar" is what a
  // real `compact` regression would look like too.
  const commentBox = await boxOf(commentReader);
  if (commentBox) await t.mouse.dblclick(commentBox.x + 20, commentBox.y + 8);
  const compactOpen = await shown(t.locator('.rte-content.ProseMirror-focused'), 8000);
  const bar = await t
    .locator('.rte-root button[title]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('title')))
    .catch(() => []);
  check(
    'ein Doppelklick öffnet die schmale Leiste: B/I/U, Schriftfarbe, Liste, Link, Emoji',
    compactOpen &&
      bar.length === 7 &&
      ['Fett', 'Kursiv', 'Unterstrichen', 'Aufzählung', 'Link einfügen', 'Emoji'].every((x) => bar.includes(x)) &&
      bar.some((x) => x.startsWith('Schriftfarbe')),
    bar.join(' | ') || 'keine Leiste',
  );
  check(
    '…und nichts Dokumentgroßes daneben: keine Überschrift, kein Zitat, keine Tabelle, kein Bild',
    compactOpen && !bar.some((x) => /^(Überschrift|Zitat|Tabelle einfügen|Bild|Nummerierte Liste|Einrücken|Ausrücken)/.test(x)),
    bar.join(' | ') || 'keine Leiste',
  );

  await t.keyboard.press('ControlOrMeta+a');
  const wholeComment = await until(() => caretIn(t), (s) => !!s && s.text.includes('Absprache'), 4000);
  check('der ganze Kommentar ist ausgewählt', !!wholeComment && wholeComment.text.includes('Reihe 1'), wholeComment?.text ?? 'keine Auswahl');
  await clickIfThere(colorTrigger(t));
  await shown(palette(t), 4000);
  await clickIfThere(palette(t).getByRole('button', { name: 'Grün', exact: true }));
  await gone(palette(t), 4000);
  await closePalette(t);
  check(
    'auch die schmale Leiste färbt',
    (await until(() => t.locator('.rte-content span.tc-gruen').count(), (n) => n === 1, 4000)) === 1,
  );
  await saveNote(t, commentReader);
  // `tc-gruen`, never a bare `tc-` — the demo seeds this very comment with a `tc-rot` run, so the
  // loose predicate resolves on the *pre-write* value on its first read and the assertions below
  // are then a coin toss against the PATCH. Doubly so here: `saveNote`'s „the editor is gone" is
  // not a write-resolved signal for a comment, since `CommentCell.onBlur` unmounts first and
  // commits afterwards, where `InlineNotes.commit` awaits the write before it leaves edit mode.
  const storedComment = await until(
    () => api(BOX('/tasks/30')).then((r) => String(r.comment ?? '')),
    (c) => c.includes('tc-gruen'),
    8000,
  );
  check('…und die Zelle speichert, was sie geschrieben hat', storedComment.includes('<span class="tc-gruen">'), storedComment);
  check('…die vorher darin liegende Farbe ist ersetzt, nicht danebengelegt', !storedComment.includes('tc-rot'), storedComment);

  // ======================================================================== AD–AG · images in the text
  //
  // WP-37 put pictures into the database and into the editor, and case N asserts the far end of
  // that pipe — a note's image reaches the printed PDF as an embedded object of its stored size.
  // Nothing drove the near end: the button that puts one in, the clipboard that must not, the note
  // that has to give both back unchanged, and the Papierkorb that has to leave the bytes alone.
  //
  // **The decision table stays with `npm run check:markdown`**, which runs the same `parseHTML`
  // rules over nine clipboard payloads in jsdom and is where „is this `<img>` admitted" is settled.
  // AE's three foreign payloads *are* three of those nine rows, deliberately: what it adds is the
  // half jsdom cannot have an opinion about — that the rule is reached at all when the HTML comes
  // off the real clipboard through a real keystroke, over routes that hand the editor different
  // HTML than `insertContent` does (three of them, three different answers, all in
  // `docs/VERIFYING.md`), and that the text beside the refused picture lands, which is what tells
  // „refused" from „the keystroke reached nothing". Everything else below has no counterpart there
  // at all: whether the bytes come back, and whether the picture on screen survives a save.
  //
  // In a copy from the first line: three of the four write.

  const PIC = scoped(pictures.id);
  /** The one path images are served from, and the shape `imageRef.ts` validates. */
  const IMAGE_REF = /\/api\/images\/([0-9a-f]{32})/;
  /** A token nothing was ever stored under — „a note pasted in from another season". */
  const STALE_TOKEN = 'a'.repeat(32);

  /** Every picture in the note being read, as the reader draws it. */
  const notePictures = (page) =>
    page.evaluate(() => {
      // The **first** `.prose-md:not(.rte-content)`: an artist's note lives in the header card
      // rather than in a `[data-section]`, and every project card below it renders its own
      // description — page-wide there are four `<img>` on `#/artist/1` where the note has two.
      const note = document.querySelector('.prose-md:not(.rte-content)');
      return Array.from(note?.querySelectorAll('img') ?? []).map((i) => ({
        src: i.getAttribute('src'),
        width: i.getAttribute('width'),
        align: i.getAttribute('align'),
        float: getComputedStyle(i).float,
        inLink: !!i.closest('a'),
        inQuote: !!i.closest('blockquote'),
        // `complete` alone is true for an image that failed, so the pair is what „it loaded" means.
        loaded: /** @type {HTMLImageElement} */ (i).complete && /** @type {HTMLImageElement} */ (i).naturalWidth > 0,
      }));
    });

  // ======================================================================== AD · a picture goes in
  console.log('\nAD · Ein Bild kommt in die Notiz');
  const pic = await open(context, '/dashboard');
  await pin(pic, pictures.id, '/project/2');

  const picReader = pic.locator('.prose-md:not(.rte-content)').first();
  const picEditorImg = pic.locator('.rte-content img:not(.ProseMirror-separator)');
  /** Project 2's description as the demo seeds it — the short plain note AD and AE grow. */
  const PIC_NOTE = String((await api(PIC('/projects/2'))).description ?? '');

  /**
   * The source file, built by the page itself.
   *
   * No dependency, no binary in the repository, and the dimensions are whatever the case needs:
   * 1400×900 so the client's 1200 px resize really has something to do, **transparent** on the left
   * so the white fill JPEG needs (CCL-10) is readable in the bytes that come back, and a flat
   * colour on the right so „it is the right picture" has an answer.
   */
  const sourcePng = Buffer.from(
    (
      await pic.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = 1400;
        c.height = 900;
        const ctx = c.getContext('2d');
        if (!ctx) return '';
        ctx.clearRect(0, 0, 1400, 900);
        ctx.fillStyle = '#0b5fe9';
        ctx.fillRect(700, 0, 700, 900);
        return c.toDataURL('image/png');
      })
    ).split(',')[1] ?? '',
    'base64',
  );
  check('die Quelldatei entsteht im Browser: 1400×900 PNG, halb durchsichtig', sourcePng.length > 1000, `${sourcePng.length} Bytes`);

  await openNote(pic);
  const wideBar = await pic
    .locator('.rte-root button[title]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('title')))
    .catch(() => []);
  // The other side of AC's pair: the compact bar must *not* have this button, the document-sized
  // one must — otherwise „no Bild einfügen in a comment" is also true of a build that lost it
  // everywhere.
  check('die dokumentgroße Leiste trägt „Bild einfügen“', wideBar.includes('Bild einfügen'), wideBar.join(' | ') || 'keine Leiste');

  /** Every upload this page triggers. „Nothing was inserted" needs this beside the image count. */
  /** @type {number[]} */
  const uploads = [];
  pic.on('response', (r) => {
    if (r.request().method() === 'POST' && r.url().includes('/api/images')) uploads.push(r.status());
  });

  // Onto a line of its own, which is where a hall plan goes — and which keeps a paragraph of plain
  // text in the note for later: `InlineNotes` opens on a click, a click lands at the element's
  // centre, and a 384 px picture sharing the paragraph *is* that centre (docs/VERIFYING.md).
  await pic.keyboard.press('End');
  await pic.keyboard.press('Enter');

  // Through the button and the panel it opens, never by feeding the hidden `<input type="file">`:
  // the button sets `pickingImage` *before* the panel opens, which is what stops the editor's blur
  // guard committing the note mid-insert (RTE-02), and going around it drives a path nobody has.
  const [chooser] = await Promise.all([
    pic.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null),
    clickIfThere(toolbarBtn(pic, 'Bild einfügen')),
  ]);
  check('„Bild einfügen“ öffnet die Dateiauswahl', !!chooser);
  if (chooser) {
    await chooser
      .setFiles({ name: 'Saalplan [Probe].png', mimeType: 'image/png', buffer: sourcePng })
      .catch(() => {});
  }

  /** The inserted node, and whether its bytes have arrived — the assertions below need both. */
  const insertedImage = () =>
    pic
      .evaluate(() => {
        const all = document.querySelectorAll('.rte-content img:not(.ProseMirror-separator)');
        const i = /** @type {HTMLImageElement | null} */ (all[0] ?? null);
        return {
          n: all.length,
          src: i?.getAttribute('src') ?? null,
          width: i?.getAttribute('width') ?? null,
          natural: i?.naturalWidth ?? 0,
        };
      })
      .catch(() => ({ n: -1, src: null, width: null, natural: 0 }));

  // The node **and** its bytes. The upload resolves a tick before the `<img>` reaches the document,
  // and the browser has never seen this URL, so a poll that stops at „one image is there" is a round
  // trip ahead of `naturalWidth` — the two assertions below would then read 0 px on a good build.
  const placed = await until(insertedImage, (p) => p.n === 1 && p.natural > 0, 15_000);
  const arrived = placed.n;
  check(
    'die gewählte Datei geht hoch und steht als Bild im Text',
    arrived === 1 && uploads.join('|') === '201',
    `${arrived} Bild(er), POST /api/images → ${uploads.join('|') || 'keiner'}`,
  );
  // A 1200 px plan at full column width shoves everything under it out of view, so a fresh insert
  // starts at „Mittel" — unless the picture is naturally smaller, which this one is not.
  check('…in der Größe „Mittel“, nicht in voller Spaltenbreite', placed?.width === '384', JSON.stringify(placed));
  check('…verkleinert auf 1200 px, bevor irgendetwas hochgeladen wurde', placed?.natural === 1200, `${placed?.natural ?? '—'} px`);
  // The pin is added when the picture is *drawn* and never stored (`resolveSrc`), and the editor
  // needs it as much as the reader: without it the `<img>` inside the editor resolves the registry
  // default and shows nothing, while the stored note looks perfectly correct.
  check(
    '…und der Pin am gezeichneten `src` holt die Bytes auch im Editor',
    new RegExp(`\\?season=${pictures.id}$`).test(placed?.src ?? '') && (placed?.natural ?? 0) > 0,
    placed?.src ?? 'kein Bild',
  );

  await saveNote(pic, picReader);
  const storedPic = await until(
    () => api(PIC('/projects/2')).then((p) => String(p.description ?? '')),
    (d) => IMAGE_REF.test(d),
    8000,
  );
  const token = IMAGE_REF.exec(storedPic)?.[1] ?? '';
  check(
    'die gespeicherte Notiz nennt es saisonfrei und mit seiner Breite',
    !!token && storedPic.includes(`](/api/images/${token}?w=384)`) && !storedPic.includes('season='),
    storedPic.slice(PIC_NOTE.length).trim() || storedPic,
  );
  // The file name is the alt fallback, and file names really do carry brackets („Saalplan
  // [Entwurf].jpg") — unescaped, the `![…]` closes early and the rest of the name becomes text.
  check(
    '…und der Dateiname trägt seine Klammern escaped hinein (IMG-06)',
    storedPic.includes('![Saalplan \\[Probe\\].png]'),
    storedPic.slice(PIC_NOTE.length).trim() || storedPic,
  );

  // Loaded, not merely present: this is the one URL in the run the browser has never fetched, so the
  // reader's `<img>` is a round trip behind the element the count sees.
  const drawn = await until(() => notePictures(pic), (p) => p.length === 1 && p.every((x) => x.loaded), 8000);
  check(
    'der Lesezustand zeichnet es in 384 px, aus denselben Bytes',
    drawn.length === 1 && drawn[0]?.width === '384' && drawn[0]?.loaded === true,
    JSON.stringify(drawn),
  );

  // --- the round trip, read off the wire ---
  const imageUrl = `${API}/images/${token}`;
  const served = await fetch(`${imageUrl}?season=${pictures.id}`);
  const servedHeaders = {
    ct: served.headers.get('content-type'),
    etag: served.headers.get('etag'),
    cc: served.headers.get('cache-control'),
    nosniff: served.headers.get('x-content-type-options'),
    csp: served.headers.get('content-security-policy'),
  };
  const servedBytes = Buffer.from(await served.arrayBuffer());
  check(
    'der Server liefert die Bytes mit den Kopfzeilen, die `immutable` erst ehrlich machen',
    served.status === 200 &&
      servedHeaders.ct === 'image/jpeg' &&
      servedHeaders.etag === `"${token}"` &&
      /immutable/.test(servedHeaders.cc ?? '') &&
      servedHeaders.nosniff === 'nosniff' &&
      /default-src 'none'/.test(servedHeaders.csp ?? '') &&
      servedBytes.length > 0,
    `HTTP ${served.status}, ${servedBytes.length} Bytes, ${JSON.stringify(servedHeaders)}`,
  );
  // `'cache-control': ''` on purpose: undici adds `no-cache` to every request it sends and
  // Express's `fresh` honours it, so the obvious conditional request reads 200 and the route looks
  // like it is ignoring the ETag it just set. A browser revalidating an `<img>` sends no such
  // header, so this is the faithful simulation rather than a workaround.
  const revalidated = await fetch(`${imageUrl}?season=${pictures.id}`, {
    headers: { 'if-none-match': `"${token}"`, 'cache-control': '' },
  });
  check('…und beantwortet einen bedingten Abruf mit 304', revalidated.status === 304, `HTTP ${revalidated.status}`);
  // The pin's own proof, and it needs a token that exists **only** here: the demo's hall plan is in
  // the demo season and in every copy of it, so a request with no pin would find that one anyway.
  const unpinned = (await fetch(imageUrl)).status;
  check('ohne Pin findet dieselbe URL nichts — das ist es, was der Pin tut', unpinned === 404, `HTTP ${unpinned}`);
  const unknown = (await fetch(`${API}/images/${'f'.repeat(32)}?season=${pictures.id}`)).status;
  const malformed = (await fetch(`${API}/images/nicht-hex?season=${pictures.id}`)).status;
  // A stale reference inside prose is not a client error worth distinguishing: 400 would read as an
  // app bug when the honest answer is „that picture is not in this season".
  check('…und ein unbekanntes wie ein unförmiges Token sind 404, nicht 400', unknown === 404 && malformed === 404, `${unknown} / ${malformed}`);

  // The bytes, read back as pixels rather than as a status code. Same-origin through Vite's proxy,
  // so the canvas is not tainted — and this is the only way to see the white fill: JPEG has no
  // alpha channel, so the transparent half of the source must come back **white**. Onto a fresh
  // canvas it would be black, which is CCL-10 and which a byte count cannot tell from the fix.
  const pixels = await pic.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      return null;
    }
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const at = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3);
    return { w: img.naturalWidth, h: img.naturalHeight, links: at(20, 20), rechts: at(img.naturalWidth - 20, 20) };
  }, `/api/images/${token}?season=${pictures.id}`);
  const near = (rgb, want) => !!rgb && rgb.every((v, i) => Math.abs(v - want[i]) <= 12);
  check(
    'die zurückgelesenen Pixel sind wirklich dieses Bild',
    pixels?.w === 1200 && pixels?.h === 771 && near(pixels?.rechts, [11, 95, 233]),
    JSON.stringify(pixels),
  );
  check(
    '…und die durchsichtige Hälfte kam weiß zurück, nicht schwarz (CCL-10)',
    near(pixels?.links, [255, 255, 255]),
    JSON.stringify(pixels?.links),
  );

  // ======================================================================== AE · the clipboard
  //
  // Three routes onto the clipboard and three different answers, which is the whole reason this
  // case is in a browser at all (docs/VERIFYING.md, „Bilder im Text"). `navigator.clipboard.write`
  // resolves every relative URL against the document, so it can only ever present an **absolute**
  // src — right for the foreign half, useless for our own. A genuine in-editor ⌘C does not:
  // ProseMirror writes the clipboard synchronously from the `copy` event, so the reference stays
  // relative and the gate lets it through. Both are driven below; the synthetic `ClipboardEvent`,
  // which admits anything, is deliberately not used for a rule.
  console.log('\nAE · Was die Zwischenablage hereinlässt');
  // A *context* permission, and case U2 already granted these two — repeated because a case must
  // not depend on an earlier one's grant, and the write needs the document focused besides.
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: UI });
  await pic.bringToFront();
  await openNote(pic);

  // Reported rather than counted: „no image node" and „no editor" are different defects and this
  // is the line that has to tell them apart for everything below it.
  const picked = await pic
    .evaluate(() => {
      const node = document.querySelector('.rte-content');
      const ed = /** @type {any} */ (node)?.editor;
      if (!ed) return { n: -1, was: node ? 'Knoten ohne Editor' : 'kein Editor offen' };
      /** @type {number[]} */
      const at = [];
      ed.state.doc.descendants((n, pos) => {
        if (n.type.name === 'image') at.push(pos);
      });
      if (!at.length) return { n: 0, was: ed.state.doc.textContent.slice(0, 60) };
      ed.commands.setNodeSelection(at[0]);
      return { n: at.length, was: '' };
    })
    .catch((err) => ({ n: -2, was: String(err).slice(0, 90) }));
  check('das eingefügte Bild lässt sich als Knoten auswählen', picked.n === 1, `${picked.n} Bildknoten ${picked.was}`);
  await pic.keyboard.press('ControlOrMeta+c');
  await sleep(250);
  // Collapsed deliberately. `End` here would run against the caret the editor had *before* the
  // node selection (`DOMObserver` flushes on a ~20 ms timer), the paste would replace the selection
  // with itself, and the image count would not move — which reads as „the paste inserted nothing".
  await pic.evaluate(() => /** @type {any} */ (document.querySelector('.rte-content'))?.editor.commands.focus('end')).catch(() => {});
  await sleep(150);
  await pic.keyboard.press('ControlOrMeta+v');
  const copied = await until(() => picEditorImg.count(), (n) => n === 2, 6000);
  check('⌘C/⌘V im Editor bringt eine zweite Kopie — über die echte Zwischenablage', copied === 2, `${copied} Bilder`);

  /**
   * Put HTML on the **real** clipboard and paste it with the keyboard.
   *
   * Two things are handed back rather than swallowed. The write can reject — it needs the document
   * focused, and this page is one of a dozen the run has opened — and a rejection leaves whatever
   * an *earlier* case copied lying on the clipboard, so the ⌘V then pastes that: a failure that
   * reads as „the paste gate let something through". And the plain text rides along so the
   * assertion can say the paste happened at all; „no picture arrived" is also true of a keystroke
   * that reached nothing.
   */
  const pasteHtml = async (html, text) => {
    const wrote = await pic
      .evaluate(async ([h, t]) => {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/html': new Blob([h], { type: 'text/html' }),
              'text/plain': new Blob([t], { type: 'text/plain' }),
            }),
          ]);
          return '';
        } catch (err) {
          return String(err).slice(0, 90);
        }
      }, [html, text])
      .catch((err) => String(err).slice(0, 90));
    await pic.keyboard.press('ControlOrMeta+v');
    await sleep(400);
    return wrote;
  };

  for (const [what, src] of [
    ['ein `https:`-Bild aus einer Webseite', 'https://example.com/saalplan.jpg'],
    ['ein `data:`-Bild aus einer Webseite', 'data:image/png;base64,iVBORw0KGgo='],
    ['ein `file:`-Bild aus dem Dateisystem', 'file:///Users/x/saalplan.jpg'],
  ]) {
    const marker = `Fremd-${src.split(':')[0]}`;
    const wrote = await pasteHtml(`<p>${marker} <img src="${src}" alt="fremd"></p>`, marker);
    const landed = await picEditorImg.count();
    const textLanded = (await textOf(pic.locator('.rte-content'))).includes(marker);
    check(
      `${what} kommt nicht mit — der Text daneben schon`,
      landed === 2 && textLanded && wrote === '',
      `${landed} Bilder, Text „${marker}“ ${textLanded ? 'da' : 'fehlt'}${wrote ? `, Zwischenablage: ${wrote}` : ''}`,
    );
  }

  const beforeShot = uploads.length;
  // Reported like `pasteHtml`'s, and for the same reason: a rejected write leaves whatever the run
  // copied earlier lying on the clipboard, the ⌘V then pastes *that*, and „no picture arrived" is
  // true for a reason that has nothing to do with the promise under test.
  const wroteShot = await pic
    .evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 8;
      c.height = 8;
      const ctx = c.getContext('2d');
      if (!ctx) return 'kein Canvas';
      ctx.fillStyle = '#b91c1c';
      ctx.fillRect(0, 0, 8, 8);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      if (!blob) return 'kein Blob';
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return '';
      } catch (err) {
        return String(err).slice(0, 90);
      }
    })
    .catch((err) => String(err).slice(0, 90));
  await pic.keyboard.press('ControlOrMeta+v');
  await sleep(700);
  // „Paste and drag-and-drop are deliberately not wired" (DECISIONS.md) — an accidentally pasted
  // screenshot must not land in the database, so the upload count is asserted beside the picture.
  const afterShot = await picEditorImg.count();
  check(
    'ein eingefügter Screenshot landet weder im Text noch in der Datenbank',
    afterShot === 2 && uploads.length === beforeShot && wroteShot === '',
    `${afterShot} Bilder, ${uploads.length - beforeShot} Uploads${wroteShot ? `, Zwischenablage: ${wroteShot}` : ''}`,
  );

  /**
   * Drop something on the editor. Returns whether anybody called `preventDefault` — which is how
   * „the editor refused it" is told apart from „the event never arrived".
   */
  const dropOnEditor = (kind, html) =>
    pic
      .evaluate(async ([k, h]) => {
        const dt = new DataTransfer();
        if (k === 'file') {
          const c = document.createElement('canvas');
          c.width = 8;
          c.height = 8;
          c.getContext('2d')?.fillRect(0, 0, 8, 8);
          const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
          if (blob) dt.items.add(new File([blob], 'screenshot.png', { type: 'image/png' }));
        } else {
          dt.setData('text/html', h);
          dt.setData('text/plain', 'abgelegt');
        }
        const el = document.querySelector('.rte-content');
        if (!el) return { files: dt.files.length, handled: false, was: 'kein Editor offen' };
        const r = el.getBoundingClientRect();
        const init = { dataTransfer: dt, bubbles: true, cancelable: true, clientX: Math.round(r.x + 20), clientY: Math.round(r.y + 8) };
        el.dispatchEvent(new DragEvent('dragenter', init));
        el.dispatchEvent(new DragEvent('dragover', init));
        return { files: dt.files.length, handled: !el.dispatchEvent(new DragEvent('drop', init)), was: '' };
      }, [kind, html])
      .catch((err) => ({ files: -1, handled: false, was: String(err).slice(0, 90) }));

  const beforeDrop = uploads.length;
  const droppedFile = await dropOnEditor('file', '');
  await sleep(500);
  const afterFileDrop = await picEditorImg.count();
  check(
    'eine abgelegte Bilddatei ebenso wenig: der Editor lässt das Ereignis unbeantwortet',
    droppedFile.files === 1 && droppedFile.handled === false && afterFileDrop === 2 && uploads.length === beforeDrop,
    `${JSON.stringify(droppedFile)}, ${afterFileDrop} Bilder, ${uploads.length - beforeDrop} Uploads`,
  );
  // The control, and without it the line above passes on a drop that never reached ProseMirror:
  // the *same* gesture carrying one of our own references is taken.
  const droppedRef = await dropOnEditor('html', `<p><img src="/api/images/${token}" alt="Abgelegt"></p>`);
  const afterDrop = await until(() => picEditorImg.count(), (n) => n === 3, 6000);
  check(
    '…während dieselbe Geste mit einer eigenen Referenz ankommt — sonst prüfte die Zeile darüber nichts',
    droppedRef.handled === true && afterDrop === 3,
    `${JSON.stringify(droppedRef)}, ${afterDrop} Bilder`,
  );

  await saveNote(pic, picReader);
  const storedPastes = await until(
    () => api(PIC('/projects/2')).then((p) => String(p.description ?? '')),
    (d) => (d.match(/\/api\/images\//g) ?? []).length === 3,
    8000,
  );
  const refs = storedPastes.match(/\/api\/images\/[0-9a-f]{32}[^)\s"]*/g) ?? [];
  check(
    'die drei Bilder stehen als drei Referenzen auf dasselbe Token in der Notiz',
    refs.length === 3 && refs.every((r) => r.startsWith(`/api/images/${token}`)),
    refs.join(' ') || 'keine Referenz',
  );
  // What is drawn is not what is stored: the pin would be wrong in every other season, and a copy
  // made inside the editor is exactly how it would get in.
  check('…keine davon mit Saison-Pin', !storedPastes.includes('season='), storedPastes.slice(-160));
  check(
    '…und die Kopie hat die Breite des Originals mitgenommen, die abgelegte keine',
    refs.filter((r) => r.endsWith('?w=384')).length === 2 && refs.filter((r) => !r.includes('?')).length === 1,
    refs.join(' '),
  );

  // ======================================================================== AF · what a note gives back
  //
  // Artist 1's note is the fixture: an imported raw `<img … width="120" align="right">` inside a
  // quote and a linked plan at natural size (WP-37). Before the image node existed both came back
  // out of the editor as the bare word „Saalplan" — the URL gone, no warning, the renderer still
  // drawing the picture from the *stored* text until somebody edited the note. That is the failure
  // this case exists for, and it is only reachable through the app's own door: the editor is built
  // with `useEditor({ content })`, which validates nothing, where `setContent` would repair.
  //
  // The assertion is the **picture list**, not the stored string. Saving rewrites the raw tag into
  // the Markdown spelling (`![…](…?w=120&a=right)`) and `check:markdown` guarantees render-equality
  // rather than byte-identity, so a text diff reports „the editor rewrote my note" against working
  // code. What must hold byte-for-byte is narrower: the same tokens, and no pin.
  console.log('\nAF · Was eine Notiz mit ihren Bildern macht');
  await pic.goto(`${UI}/#/artist/1`);
  await pic.reload();
  await ready(pic);

  const beforeSave = await until(() => notePictures(pic), (p) => p.length === 2 && p.every((x) => x.loaded), 10_000);
  check(
    'die Künstlernotiz zeichnet beide Bilder, und beide sind wirklich geladen',
    beforeSave.length === 2 && beforeSave.every((p) => p.loaded),
    JSON.stringify(beforeSave),
  );
  check(
    '…das importierte 120 px breit rechts im Zitat, das verlinkte in Originalgröße (IMG-08)',
    beforeSave[0]?.width === '120' &&
      beforeSave[0]?.align === 'right' &&
      beforeSave[0]?.float === 'right' &&
      beforeSave[0]?.inQuote === true &&
      beforeSave[1]?.width === null &&
      beforeSave[1]?.inLink === true,
    JSON.stringify(beforeSave),
  );

  const notesBefore = String((await api(PIC('/artists/1'))).notes ?? '');
  await openNote(pic);
  const inEditor = await pic.evaluate(() =>
    Array.from(document.querySelectorAll('.rte-content img:not(.ProseMirror-separator)')).map((i) => ({
      width: i.getAttribute('width'),
      float: getComputedStyle(i).float,
      loaded: /** @type {HTMLImageElement} */ (i).complete && /** @type {HTMLImageElement} */ (i).naturalWidth > 0,
    })),
  );
  check(
    'der Editor zeigt dieselben zwei, geladen und mit ihrer Ausrichtung',
    inEditor.length === 2 && inEditor.every((p) => p.loaded) && inEditor[0]?.width === '120' && inEditor[0]?.float === 'right',
    JSON.stringify(inEditor),
  );

  await pic.keyboard.press('End');
  await pic.keyboard.type(` Nachtrag ${RUN}.`);
  await saveNote(pic, picReader);
  const notesAfter = await until(
    () => api(PIC('/artists/1')).then((a) => String(a.notes ?? '')),
    (n) => n.includes(`Nachtrag ${RUN}`),
    8000,
  );
  // The reader has to be showing the **saved** note before its pictures are read: the API answering
  // is one thing and the re-render another, and in that gap the old elements are still on screen —
  // so a save that ate both images would be compared against the version that still had them.
  const readerSaved = await until(() => textOf(picReader), (t) => t.includes(`Nachtrag ${RUN}`), 8000);
  const afterSave = await until(() => notePictures(pic), (p) => p.length === 2 && p.every((x) => x.loaded), 10_000);
  check(
    'nach dem Speichern zeichnet der Leser genau dieselben Bilder — Größe, Ausrichtung, Zitat, Link',
    readerSaved.includes(`Nachtrag ${RUN}`) && JSON.stringify(afterSave) === JSON.stringify(beforeSave),
    JSON.stringify(afterSave),
  );
  const tokensIn = (s) => (s.match(/\/api\/images\/[0-9a-f]{32}/g) ?? []).join(' ');
  check(
    '…und die gespeicherte Fassung nennt beide Token weiter, keins mit Pin',
    tokensIn(notesAfter) === tokensIn(notesBefore) && tokensIn(notesAfter) !== '' && !notesAfter.includes('season='),
    tokensIn(notesAfter) || 'keine Referenz mehr',
  );

  // A reference whose image did not travel — a note pasted in from another season. Written with
  // the **stale one first**, which is what the second half below needs.
  await send('PATCH', PIC('/projects/3'), {
    description: `![Verlorener Plan](/api/images/${STALE_TOKEN})\n\n![Guter Plan](/api/images/${token}?w=192)`,
  });
  await pic.goto(`${UI}/#/project/3`);
  await pic.reload();
  await ready(pic);
  /** What the note being read shows: the pictures that arrived, and the places that say one did not. */
  const noteState = () =>
    pic.evaluate(() => {
      const note = document.querySelector('.prose-md:not(.rte-content)');
      return {
        drawn: Array.from(note?.querySelectorAll('img') ?? []).map(
          (i) => /** @type {HTMLImageElement} */ (i).complete && /** @type {HTMLImageElement} */ (i).naturalWidth > 0,
        ),
        missing: Array.from(note?.querySelectorAll('span') ?? [])
          .map((s) => (s.textContent ?? '').trim())
          .filter((t) => t.startsWith('Bild nicht gefunden')),
      };
    });
  // Both halves in the predicate. „A message is on screen" becomes true the instant the stale
  // reference's 404 re-renders, which is concurrent with the good picture's own load — so a poll on
  // the message alone hands the pair assertion below a picture that has not arrived yet.
  const mixed = await until(noteState, (m) => m.missing.length > 0 && m.drawn.every((d) => d), 8000);
  check(
    'eine Referenz ohne Bild sagt es im Text, mit ihrem Alt-Text',
    mixed.missing.join(' | ') === 'Bild nicht gefunden: Verlorener Plan',
    mixed.missing.join(' | ') || 'keine Meldung',
  );
  // The pair: a fallback that draws over everything is indistinguishable from this one when only
  // the failing side is read.
  check(
    '…und das Bild daneben wird trotzdem gezeichnet',
    mixed.drawn.length === 1 && mixed.drawn[0] === true,
    JSON.stringify(mixed.drawn),
  );

  // …and the *next* note in that place gets its picture. React reuses this component — same route,
  // same position in the tree, `Markdown`'s `useMemo` rebuilding the elements without remounting —
  // so a boolean „it failed" latched on the first 404 drew „Bild nicht gefunden" over the next good
  // picture until the window was reloaded (IMG-05).
  //
  // **A navigation cannot show that and a reload certainly cannot**: both remount the note, the
  // second one through the loading state a fetch for another row goes through. Measured against the
  // reverted fix, a hash navigation to a second project draws the picture perfectly while this does
  // not. So the note is replaced *under* the component: the row is patched out of band and the
  // window is asked to refresh itself, which keeps the tree standing.
  //
  // Focus is dispatched from inside the poll rather than once: `staleTime` is 5 s, so a focus
  // sooner than that refetches nothing at all, and the wait then ends as early as it can instead of
  // on a fixed sleep. The predicate counts *nodes* — the note above renders two, a picture and a
  // message, and the one below renders one — so it cannot resolve on the pre-write note.
  await send('PATCH', PIC('/projects/3'), { description: `![Anderer Plan](/api/images/${token}?w=128)` });
  const next = await until(
    async () => {
      await pic.evaluate(() => window.dispatchEvent(new Event('focus'))).catch(() => {});
      return noteState();
    },
    (m) => m.drawn.length + m.missing.length === 1,
    12_000,
  );
  check(
    '…und die nächste Notiz an derselben Stelle zeigt ihres, statt die Meldung zu erben (IMG-05)',
    next.drawn.length === 1 && next.drawn[0] === true && next.missing.length === 0,
    JSON.stringify(next),
  );

  // ======================================================================== AG · a cell, and the bin
  console.log('\nAG · Das Bild in der Zelle, und was der Papierkorb damit macht');
  await send('PATCH', PIC('/tasks/30'), { comment: `Saalplan: ![Zellbild](/api/images/${token}?w=96)` });
  await pic.goto(`${UI}/#/project/7`);
  await pic.reload();
  await ready(pic);
  const cellRow = pic.locator('[data-task-id="30"]');
  await cellRow.scrollIntoViewIfNeeded().catch(() => {}); // a missing row must report AG, not abort the run
  const cellReader = cellRow.locator('.prose-md:not(.rte-content)').first();
  const cellPicture = await until(
    () =>
      cellRow
        .locator('img')
        .first()
        .evaluate((i) => ({
          src: i.getAttribute('src'),
          width: i.getAttribute('width'),
          box: Math.round(i.getBoundingClientRect().width),
          loaded: /** @type {HTMLImageElement} */ (i).complete && /** @type {HTMLImageElement} */ (i).naturalWidth > 0,
        }))
        .catch(() => null),
    (p) => !!p?.loaded,
    8000,
  );
  check(
    'ein Bild in einer Kommentarzelle wird gezeichnet, in der Breite, die dort steht',
    cellPicture?.width === '96' && cellPicture?.box === 96 && cellPicture?.loaded === true,
    JSON.stringify(cellPicture),
  );

  // A *double* click: `CommentCell` binds `onDoubleClick` where `InlineNotes` binds `onClick`.
  const cellBox = await boxOf(cellReader);
  if (cellBox) await pic.mouse.dblclick(cellBox.x + 20, cellBox.y + 8);
  const cellOpen = await shown(pic.locator('.rte-content.ProseMirror-focused'), 8000);
  await sleep(200);
  await pic.keyboard.press('End');
  // What is asserted is that the caret is **collapsed**, not where it is: a double click leaves a
  // word selected and typing into a selection replaces it, which on a one-line comment can be the
  // picture. Where it ends up is the click's own position — `End` runs against the selection the
  // editor had before the click, through `DOMObserver`'s ~20 ms flush — and that does not matter
  // to anything below.
  const cellCaret = await until(() => caretIn(pic), (s) => !!s && s.from === s.to, 4000);
  check(
    'die schmale Zelle öffnet sich mit dem Bild darin und einem leeren Cursor',
    cellOpen && (await picEditorImg.count()) === 1 && !!cellCaret && cellCaret.from === cellCaret.to,
    `${await picEditorImg.count()} Bilder, Auswahl ${cellCaret?.from}–${cellCaret?.to}`,
  );
  await pic.keyboard.type(' Nachtrag.');
  // `CommentCell` unmounts *before* it commits, so „the editor is gone" says nothing here — poll
  // the API for a value only the write can produce.
  await pic.keyboard.press('ControlOrMeta+Enter');
  const storedCell = await until(
    () => api(PIC('/tasks/30')).then((t2) => String(t2.comment ?? '')),
    (c) => c.includes('Nachtrag.'),
    8000,
  );
  check(
    '…und gibt das Bild beim Speichern wieder her, statt es zu seinem Alt-Text zu machen',
    storedCell.includes(`![Zellbild](/api/images/${token}?w=96)`),
    storedCell,
  );

  // Images are deliberately outside the cascade: `CHILD_EDGES`, `DELETE_ORDER` and `TABLE_TYPE` are
  // generated from the foreign-key graph, and an image reference lives inside a TEXT column no
  // foreign key describes — so `purgeExpired`, which walks `DELETE_ORDER`, can never reach a row
  // here. Adding the table there would read as a tidy-up and behave as data loss. What the customer
  // meets is this: a note that spent a while in the Papierkorb still has its pictures.
  const trashed = await send('DELETE', PIC('/projects/3'));
  check(
    'das Projekt mit der Bildnotiz liegt im Papierkorb',
    trashed.status === 200 && (await send('GET', PIC('/projects/3'))).status === 404,
    `HTTP ${trashed.status}`,
  );
  // An invariant guard rather than a regression detector, and worth knowing before writing a canary
  // for it: the change this line forbids is putting `images` into `DELETE_ORDER`, and a *soft* delete
  // never walks that list — so no plausible revert takes it red on its own. What bites AG is the
  // season pin (the cell, and the restored note) and the width the cell has to give back.
  const stillServed = (await fetch(`${imageUrl}?season=${pictures.id}`)).status;
  check(
    '…und seine Bytes werden weiter ausgeliefert: Bilder hängen nicht an der Kaskade',
    stillServed === 200,
    `HTTP ${stillServed}`,
  );
  const restored = await send('POST', PIC('/deleted/project/3/restore'));
  check('das Wiederherstellen holt den Eintrag zurück', restored.status === 200 && (await send('GET', PIC('/projects/3'))).status === 200, `HTTP ${restored.status}`);
  await pic.goto(`${UI}/#/project/3`);
  await pic.reload();
  await ready(pic);
  // One `<img>`: the IMG-05 step above patched this description down to a single reference, so the
  // stale one is long gone — the count is right for that reason and not because a second picture is
  // failing somewhere. And the wait is on **loaded**, not on the element: a `reload()` revalidates
  // every `<img>` over the network (see the 304 above), so „the node is there" resolves a round trip
  // before the bytes do, and the assertion under it would read `loaded: false` on a good build.
  const afterRestore = await until(
    () => notePictures(pic),
    (p) => p.length === 1 && p.every((x) => x.loaded),
    10_000,
  );
  check(
    '…und die Notiz zeichnet ihr Bild wieder, aus derselben URL',
    afterRestore.length === 1 &&
      afterRestore[0]?.loaded === true &&
      afterRestore[0]?.src === `/api/images/${token}?season=${pictures.id}`,
    JSON.stringify(afterRestore),
  );

  // ======================================================================== AH–AK · the archive
  //
  // Distinct from I/I2, which own the **Papierkorb** — soft-deleted records, their dependency
  // counts, restore and undo. This is the other mechanism sharing `#/archiv`: a task in the
  // „erledigt" category whose `erledigt_am` has aged past `ARCHIVE_AFTER_DAYS` leaves every live
  // list. Nothing drove it — not the views that stop showing an aged task, not what the archived
  // row can and cannot do from there, and not the boundary itself.
  //
  // No date is written down anywhere below. `demo.ts` stamps its five archived rows relative to
  // today, so „past the cutoff" holds whenever the gate runs, and AJ's own pair is computed from
  // `/api/settings.archive_after_days` — the same number the page prints in its heading.

  /**
   * One row of the archived-task table. `ArchivePage` is a plain `<table>` + `.map()`, not
   * `TaskTable`, so there is no `data-task-id` and no `tbody[data-group-id]` to address — every
   * handle from „Der Aufgabenbaum" matches nothing here. `controls` is what makes „this row offers
   * nothing" a reading rather than an opinion.
   */
  const archiveRows = (page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('table tbody tr')].map((tr) => ({
        title: (tr.querySelector('td')?.textContent ?? '').trim(),
        links: [...tr.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? ''),
        controls: tr.querySelectorAll(
          'button, input, select, textarea, [contenteditable], div.cursor-text',
        ).length,
        taskId: tr.getAttribute('data-task-id'),
      })),
    );

  /**
   * Both halves of `#/archiv`, read **per section**: „Keine Treffer." is the same `EmptyState` in
   * both, so only the `<h2>` above one tells them apart. `textContent` rather than `innerText`,
   * because every heading in the app is CSS-uppercased.
   */
  const archiveSections = (page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('h2')].map((h) => {
        const sec = h.closest('.space-y-3');
        return {
          head: (h.textContent ?? '').trim(),
          tasks: sec?.querySelectorAll('table tbody tr').length ?? 0,
          trash: sec?.querySelectorAll('div.divide-y > div').length ?? 0,
          empty: (sec?.querySelector('div.bg-neutral-50')?.textContent ?? '').trim(),
        };
      }),
    );

  /** Whatever task table is on screen, as row ids. */
  const rowIds = (page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('tr[data-task-id]')].map((tr) => tr.getAttribute('data-task-id') ?? ''),
    );

  /**
   * The dashboard's „Fortschritt" tile as one line — „<pct>% <done>/<total> FORTSCHRITT", the
   * label CSS-uppercased like every other one.
   *
   * The *innermost* `div.rounded-2xl` whose last child is the label: `Card` carries that class too,
   * and so does every artist card, several of which say „… erledigt" in their chips.
   */
  const fortschritt = (page) =>
    page.evaluate(() => {
      const tile = [...document.querySelectorAll('div.rounded-2xl')].find(
        (d) => d.querySelector('div.rounded-2xl') === null && d.lastElementChild?.textContent === 'Fortschritt',
      );
      return tile ? /** @type {HTMLElement} */ (tile).innerText.replace(/\s+/g, ' ').trim() : '';
    });

  /** `dayCount` from `client/src/lib/dates.ts` — „1 Tag" / „30 Tage", which the two texts below use. */
  const dayCountDe = (n) => `${n} Tag${n === 1 ? '' : 'e'}`;

  /** `YYYY-MM-DD HH:MM:SS`, local — the shape `acceptsErledigtAm` takes and SQLite compares. */
  const pad2 = (n) => String(n).padStart(2, '0');
  const stampAt = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  };

  // ======================================================================== AH · what the lists drop
  //
  // Read-only, against the demo's own season: the five archived rows are `demo.ts`'s and nothing
  // here writes. Two surfaces stop showing an aged task — a project's table and the Übersicht's
  // season-wide list — and „Fortschritt" is the pair, the one number that must *not* stop at that
  // edge (CCL-04).
  console.log('\nAH · Was die Listen verschweigen und was das Archiv zeigt');
  const arc = await open(context, '/dashboard');
  await pin(arc, HOME, '/project/1');

  const archColumns = await api('/custom-columns');
  const archStatus = archColumns.find((c) => c.kind === 'builtin' && c.key === 'status');
  const archDone = JSON.parse(archStatus?.options ?? '[]').find((o) => o.done)?.value ?? 'done';
  const agedRows = await api('/tasks?scope=archive');
  const liveSeason = await api('/tasks?scope=live');
  const allSeason = await api('/tasks?scope=all');
  const liveIds = new Set(liveSeason.map((t) => t.id));
  check(
    'die Demo pflanzt fünf archivierte Aufgaben: alle erledigt, alle mit Abschlussdatum',
    agedRows.length === 5 && agedRows.every((t) => t.status === archDone && !!t.erledigt_am),
    agedRows.map((t) => `${t.id}:${t.erledigt_am}`).join(' '),
  );
  // The one server-side reading this case takes, and the fixture fact both halves below lean on:
  // the archive is exactly the difference between the two scopes, so „missing from the table" and
  // „listed in the Archiv" are about the same five rows and not about two unrelated sets.
  check(
    '…und sie sind genau das, was der Live-Liste fehlt',
    allSeason.length === liveSeason.length + agedRows.length && agedRows.every((t) => !liveIds.has(t.id)),
    `${allSeason.length} alle, ${liveSeason.length} live, ${agedRows.length} archiviert`,
  );

  const p1Live = await api('/tasks?project_id=1&scope=live');
  const p1All = await api('/tasks?project_id=1&scope=all');
  // Polled on the length the assertion then compares: `ready()` also resolves from `BootReady`'s
  // unconditional 700 ms budget, so a one-shot read is an empty table on a loaded runner — and an
  // empty table satisfies „the archived rows are not there" perfectly.
  const p1Rows = await until(() => rowIds(arc), (r) => r.length === p1Live.length, 8000);
  check(
    'die Projekttabelle zeigt genau die lebende Liste — die beiden archivierten Zeilen fehlen',
    [...p1Rows].sort().join(' ') === p1Live.map((t) => String(t.id)).sort().join(' '),
    `${p1Rows.join(' ')} statt ${p1Live.map((t) => t.id).join(' ')}`,
  );
  // The pair, and the reason this case needs no date at all: tasks 4 and 53 are both done children
  // of task 1, and only the older one is gone. „Erledigt" on its own archives nothing.
  const youngDone = p1All.find((t) => t.id === 4);
  const agedKid = p1All.find((t) => t.id === 53);
  check(
    '…die beiden erledigten Kinder derselben Aufgabe liegen auf verschiedenen Seiten der Grenze',
    youngDone?.status === archDone &&
      agedKid?.status === archDone &&
      p1Rows.includes('4') &&
      !p1Rows.includes('53'),
    `4 seit ${youngDone?.erledigt_am} → ${p1Rows.includes('4')}, 53 seit ${agedKid?.erledigt_am} → ${p1Rows.includes('53')}`,
  );

  await arc.goto(`${UI}/#/dashboard`);
  await arc.reload();
  await ready(arc);
  // Polled on the *neighbour* the assertion also reads: „the aged row is absent" is true of a
  // table that has not rendered a single row yet, and `ready()` legitimately resolves there.
  const festival = await until(() => rowIds(arc), (r) => r.includes('20'), 8000);
  // The season-wide „Festival" list is the second table an aged row could turn up in, and task 27
  // („Save-the-Date verschickt") is the one archived todo that belongs to it. Task 20 is its live
  // neighbour, so this is not „the list rendered nothing".
  check(
    'auch die „Festival“-Liste der Übersicht lässt die gealterte Saison-Aufgabe weg',
    !festival.includes('27') && festival.includes('20'),
    festival.join(' '),
  );

  // …and the one number that must see *past* the edge. Fed the page's own `scope: 'live'` list,
  // „Fortschritt" falls as work is finished and ages out — 0 %, 0/0 for a project that is finished
  // (CCL-04). Both counts are read here, because comparing against only one of them passes either
  // way: on a freshly seeded demo they are 8/51 and 3/46, and inside this run — case F has added a
  // task by now — 9/52 and 4/47.
  const cnt = (rows) => ({ done: rows.filter((t) => t.status === archDone).length, total: rows.length });
  const allCount = cnt(allSeason);
  const liveCount = cnt(liveSeason);
  const tile = await until(() => fortschritt(arc), (t) => /\d+\/[1-9]/.test(t), 8000);
  check(
    'die „Fortschritt“-Kachel zählt über die Archivgrenze hinweg (CCL-04)',
    tile.includes(`${allCount.done}/${allCount.total}`),
    `${tile} — erwartet ${allCount.done}/${allCount.total}`,
  );
  check(
    '…und die Live-Liste hätte etwas anderes gesagt: sonst prüfte die Zeile darüber nichts',
    allCount.done !== liveCount.done && allCount.total !== liveCount.total,
    `alle ${allCount.done}/${allCount.total}, live ${liveCount.done}/${liveCount.total}`,
  );

  await arc.goto(`${UI}/#/archiv`);
  await arc.reload();
  await ready(arc);
  const listed = await until(() => archiveRows(arc), (r) => r.length === agedRows.length, 8000);
  check(
    'das Archiv zeigt genau diese fünf und keine andere Zeile',
    listed.map((r) => r.title).sort().join(' | ') === agedRows.map((t) => t.title).sort().join(' | '),
    listed.map((r) => r.title).join(' | ') || 'leer',
  );
  // PGS-24: the heading states the policy the server really follows. A hardcoded „30" passes
  // against a build that has stopped reading the constant.
  const retention = (await api('/settings')).archive_after_days;
  const archHeads = (await archiveSections(arc)).map((s) => s.head);
  check(
    '…unter einer Überschrift, die die Aufbewahrungsfrist des Servers nennt (PGS-24)',
    archHeads[0] === `Erledigte Aufgaben (älter als ${dayCountDe(retention)})`,
    `${archHeads.join(' / ')} bei archive_after_days=${retention}`,
  );
  // Three shapes of Zuordnung in one table, which is what those fixtures exist for: a project row
  // links to both, an artist-only row to one, and the season-wide todo to nothing at all.
  const linksOf = (title) => listed.find((r) => r.title === title)?.links.join(' ') ?? 'keine Zeile';
  check(
    'die Zuordnung nennt Künstler und Projekt, wo es welche gibt — und bleibt leer, wo nicht',
    linksOf('Probenraum gebucht') === '#/artist/1 #/project/1' &&
      linksOf('Vorvertrag unterschrieben') === '#/artist/3' &&
      linksOf('Save-the-Date verschickt') === '',
    `24: ${linksOf('Probenraum gebucht')} | 26: ${linksOf('Vorvertrag unterschrieben')} | 27: „${linksOf('Save-the-Date verschickt')}“`,
  );

  // The archive is a view, not a deletion, and the search is where that becomes visible:
  // `/api/search` filters `deleted_at` and the live parents and nothing else. Following the hit
  // lands on the page the task belongs to, where the row is not in the table — the same one-way
  // trip the Zuordnung link makes in AI, asserted there.
  await arc.keyboard.press('ControlOrMeta+k');
  await arc.keyboard.type('Probenraum');
  const found = await until(
    () => arc.locator('#gs-hits [role="option"]').evaluateAll((els) => els.map((e) => e.id)),
    (ids) => ids.includes('gs-hit-t24'),
    8000,
  );
  check(
    'die Suche findet die archivierte Aufgabe weiterhin',
    found.includes('gs-hit-t24'),
    found.join(' ') || 'keine Treffer',
  );
  await arc.keyboard.press('Escape');
  await arc.keyboard.press('Escape');

  // ======================================================================== AI · what the row offers
  //
  // The other half of „a view": an archived row is a *report*, not a task. Case M owns WP-58 on the
  // task table's done row — the strike's propagation into block children and the precondition it
  // relies on — and nothing here re-asserts that mechanism. What is asserted is this page's own
  // markup: four `<td>`s, three of them struck, and a `prose-md--done` of its own.
  console.log('\nAI · Was eine archivierte Zeile hergibt und was nicht');
  // An invariant guard rather than a regression detector, and worth knowing before writing a canary
  // for it: what this line forbids is a control being *added* to the archive table, and no plausible
  // revert of an existing fix takes it red on its own (the `scope: 'all'` canary does, but for the
  // row count). What bites AI is the strike, the Zitat's colour, the search box and the badge's link.
  const bare = await until(() => archiveRows(arc), (r) => r.length === agedRows.length, 8000);
  check(
    'keine der Zeilen trägt ein Bedienelement — keinen Knopf, kein Feld, keinen Kommentarkasten',
    bare.length === agedRows.length && bare.every((r) => r.controls === 0 && r.taskId === null),
    bare.map((r) => `${r.title}:${r.controls}`).join(' | ') || 'keine Zeilen',
  );
  // The pair, on the same screen: this page does render controls, this table does not.
  const trashButtons = await arc
    .locator('div.divide-y > div')
    .evaluateAll((els) => els.map((e) => [...e.querySelectorAll('button')].map((b) => b.textContent).join('+')));
  check(
    '…während jede Papierkorb-Zeile darunter zwei davon hat',
    trashButtons.length > 0 && trashButtons.every((t) => t === 'Wiederherstellen+Endgültig löschen'),
    `${trashButtons.length} Zeilen: ${[...new Set(trashButtons)].join(' / ')}`,
  );

  // A missing button is not a missing handler: `InlineNotes` opens on a single click and
  // `CommentCell` on a double one, and neither surface exists here. Task 25 is the one archived row
  // with a comment, i.e. the only cell a double click could plausibly open. An invariant guard like
  // the line above, and for the same reason: what it forbids is an editor being *added* here.
  const archCommentRow = arc.locator('table tbody tr').filter({ hasText: 'Technikrider geprüft' });
  await clickIfThere(arc.locator('table tbody tr').first().locator('td').first());
  const archCommentBox = await boxOf(archCommentRow.locator('td').nth(3));
  if (archCommentBox) await arc.mouse.dblclick(archCommentBox.x + 20, archCommentBox.y + 8);
  await sleep(500); // long enough for an editor this must not be mounting
  const openedEditors = await arc.locator('.rte-content').count();
  check(
    'ein Klick auf den Titel und ein Doppelklick auf den Kommentar öffnen nichts',
    !!archCommentBox && openedEditors === 0 && (await arc.locator('table input').count()) === 0,
    `${openedEditors} Editoren, Kommentarzelle ${archCommentBox ? 'gefunden' : 'nicht gefunden'}`,
  );

  const look = await arc.evaluate(() => {
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const row = [...document.querySelectorAll('table tbody tr')].find(
      (r) => (r.querySelectorAll('td')[3]?.textContent ?? '').trim().length > 0,
    );
    if (!row) return null;
    const tds = [...row.querySelectorAll('td')];
    return {
      row: cs(row)?.color ?? '',
      deco: tds.map((td) => cs(td)?.textDecorationLine ?? ''),
      link: cs(tds[1]?.querySelector('a'))?.color ?? 'kein Link',
      quote: cs(row.querySelector('blockquote'))?.color ?? 'kein Zitat',
      cell: cs(tds[3])?.color ?? '',
    };
  });
  check(
    'Aufgabe, „Erledigt am“ und Kommentar sind durchgestrichen — die Zuordnung nicht',
    look?.deco.join(' ') === 'line-through none line-through line-through',
    look?.deco.join(' ') ?? 'keine Zeile mit Kommentar',
  );
  check(
    '…das Grau erbt trotzdem jede Zelle, den Link darin eingeschlossen',
    !!look && look.link === look.row && look.row !== '',
    `Link ${look?.link}, Zeile ${look?.row}`,
  );
  // `.prose-md blockquote` paints `#6b7280` of its own (index.css) and `.prose-md--done` hands it
  // back to the row — so the pair is the assertion and needs no second fixture: the Zitat takes the
  // row's grey *and* is not the colour it would carry without the modifier.
  check(
    'das Zitat im archivierten Kommentar nimmt das Grau der Zeile statt seines eigenen',
    !!look && look.quote === look.cell && look.quote !== 'rgb(107, 114, 128)',
    `Zitat ${look?.quote}, Zelle ${look?.cell}`,
  );

  // The box above both lists is labelled for the whole Archiv, so it has to narrow both (PGS-22) —
  // and „Keine Treffer." is a different empty state from „Noch nichts archiviert", which case AK
  // reads. Only the `<h2>` above one of them tells the two apart, hence `archiveSections`.
  //
  // Every `fill` here is bounded and swallowed for the reason `clickIfThere` exists: a build that
  // has lost the box would otherwise wait out the default 30 s actionability timeout and then
  // **throw**, taking the rest of the run down instead of letting three assertions report.
  const archSearch = arc.locator('input[placeholder="Archiv durchsuchen…"]');
  const search = (text) => archSearch.fill(text, { timeout: 5000 }).catch(() => {});
  await search('Probenraum');
  const narrowed = await until(() => archiveSections(arc), (s) => s[0]?.tasks === 1, 5000);
  check(
    'die Suche über dem Archiv verengt auch den Papierkorb (PGS-22)',
    narrowed[0]?.tasks === 1 && narrowed[1]?.trash === 0 && narrowed[1]?.empty === 'Keine Treffer.',
    JSON.stringify(narrowed),
  );
  await search('Gelöschter');
  const other = await until(() => archiveSections(arc), (s) => s[1]?.trash === 1, 5000);
  check(
    '…und in der anderen Richtung ebenso',
    other[0]?.tasks === 0 && other[0]?.empty === 'Keine Treffer.' && other[1]?.trash === 1,
    JSON.stringify(other),
  );
  await search('');
  const cleared = await until(() => archiveSections(arc), (s) => s[0]?.tasks === agedRows.length, 5000);
  check(
    '…geleert stehen beide Listen wieder vollständig da',
    cleared[0]?.tasks === agedRows.length && cleared[1]?.trash === trashButtons.length,
    JSON.stringify(cleared),
  );

  // What the row *can* do. The Zuordnung cell is where the task came from, and its badge is the way
  // back — to the page, not to the row: the archive edge is one-way from here, exactly as it is
  // from the search hit above.
  // By the row's text, not by position: all five archived rows tie under `TASK_ORDER_DUE` (every
  // one done, none with a due date), so `first()` is only task 24 by insert order and a sixth
  // fixture would silently make this the wrong row.
  const badge = await clickIfThere(
    arc.locator('table tbody tr').filter({ hasText: 'Probenraum gebucht' }).locator('a[href="#/project/1"]'),
  );
  // Guarded, and the fallback is a plain `goto`: a build whose badge is not a link at all must take
  // the line below red and still let the *pair* underneath report, which is about what the project
  // page holds and not about how it was reached. An unguarded `waitForURL` throws there and ends
  // the run — measured, in the canary for exactly this link.
  if (badge) await arc.waitForURL(/#\/project\/1$/, { timeout: 15_000 }).catch(() => {});
  else await arc.goto(`${UI}/#/project/1`);
  await arc.reload();
  await ready(arc);
  const backHome = await until(() => rowIds(arc), (r) => r.length === p1Live.length, 8000);
  check(
    'die Projektmarke der Zeile führt dorthin zurück, wo die Aufgabe herkam',
    badge && (await arc.evaluate(() => location.hash)) === '#/project/1' && backHome.length === p1Live.length,
    `${badge ? 'geklickt' : 'keine Verknüpfung'}, ${await arc.evaluate(() => location.hash)}, ${backHome.length} Zeilen`,
  );
  const liveShape = await arc.evaluate(
    (title) => {
      const done = document.querySelector('tr[data-task-id="4"]');
      const commented = document.querySelector('tr[data-task-id="5"]');
      return {
        buttons: done?.querySelectorAll('button').length ?? 0,
        titled: [...(done?.querySelectorAll('button') ?? [])].some((b) => (b.textContent ?? '').trim() === title),
        commentBox: commented?.querySelectorAll('div.cursor-text').length ?? 0,
      };
    },
    youngDone?.title ?? '',
  );
  check(
    '…wo die archivierte Zeile weiterhin fehlt, ihre lebende erledigte Schwester aber alles trägt, was jener fehlte',
    !backHome.includes('24') &&
      !backHome.includes('53') &&
      liveShape.buttons > 0 &&
      liveShape.titled &&
      liveShape.commentBox === 1,
    `${JSON.stringify(liveShape)}, 24/53 gerendert=${backHome.includes('24')}/${backHome.includes('53')}`,
  );

  // ======================================================================== AJ · the boundary itself
  //
  // In a season of its own, and not a copy — `agedSeason`, made with the other fixture seasons
  // before any case has written. `erledigt_am` is server-derived,
  // so the two stamps go in through the one door that accepts them: the `{status, erledigt_am}`
  // pair `acceptsErledigtAm` takes, which exists for the undo stack (SDL-02). A lone `erledigt_am`
  // is dropped and the transform stamps today instead, which would read as a broken archive query.
  //
  // Both are computed from the server's own retention constant, ten minutes either side of it. That
  // is also what says the cutoff is a *timestamp*: twenty minutes decide, not a calendar day.
  console.log('\nAJ · Die Grenze: zwanzig Minuten entscheiden');
  const G = scoped(agedSeason.id);
  const retentionDays = (await api(G('/settings'))).archive_after_days;
  const gStatusCol = (await api(G('/custom-columns'))).find((c) => c.kind === 'builtin' && c.key === 'status');
  const gOptions = JSON.parse(gStatusCol?.options ?? '[]');
  const gDone = gOptions.find((o) => o.done)?.value ?? 'done';
  const gArtist = (await send('POST', G('/artists'), { name: 'Grenzfall', color: '#0b5fe9' })).body;
  const gProject = (
    await send('POST', G('/projects'), { artist_id: gArtist.id, code: 'GR1', name: 'Stichtag' })
  ).body;
  const TEN_MIN = 600_000;
  // `setDate`, never `Date.now() - N * 86_400_000`. The server's cutoff is
  // `datetime('now', 'localtime', '-N days')` — calendar-day arithmetic on the *naive local*
  // clock, i.e. the same wall-clock time N days ago — while a fixed span of milliseconds is an
  // absolute one. For the ~30 days after either DST transition the two differ by exactly one
  // hour, six times this case's ±10-minute margin, so in Europe/Berlin the older fixture lands on
  // the wrong side of the cutoff and four assertions go red against correct code. CI runs in UTC
  // and never sees it (docs/VERIFYING.md, „Das Archiv").
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const cutoffMs = cutoff.getTime();
  /** A task completed `offset` ms from the cutoff — or an open one when `offset` is null. */
  const atBoundary = async (title, offset) => {
    const made = (await send('POST', G('/tasks'), { project_id: gProject.id, title })).body;
    if (offset == null) return { ...made, wanted: null };
    const wanted = stampAt(cutoffMs + offset);
    const patched = await send('PATCH', G(`/tasks/${made.id}`), { status: gDone, erledigt_am: wanted });
    return { ...patched.body, wanted };
  };
  const older = await atBoundary('Zehn Minuten jenseits der Grenze', -TEN_MIN);
  const younger = await atBoundary('Zehn Minuten diesseits der Grenze', TEN_MIN);
  const stillOpen = await atBoundary('Noch offen', null);
  check(
    'beide Abschlusszeitpunkte stehen so in der Datenbank, wie sie gesetzt wurden (SDL-02)',
    older.erledigt_am === older.wanted && younger.erledigt_am === younger.wanted,
    `${older.erledigt_am} / ${younger.erledigt_am}`,
  );
  // Read off the two stored stamps rather than off the clock, so the failure detail is the pair the
  // server really holds.
  const apartMs =
    Date.parse(String(younger.erledigt_am).replace(' ', 'T')) -
    Date.parse(String(older.erledigt_am).replace(' ', 'T'));
  check(
    '…zwanzig Minuten liegen dazwischen, kein Kalendertag',
    apartMs === 2 * TEN_MIN,
    `${older.erledigt_am} → ${younger.erledigt_am}`,
  );

  const gLive = await api(G(`/tasks?project_id=${gProject.id}&scope=live`));
  const gArchived = await api(G(`/tasks?project_id=${gProject.id}&scope=archive`));
  check(
    'erledigt allein archiviert nichts: die jüngere Zeile steht mit der offenen in der Live-Liste',
    gLive.map((t) => t.id).sort().join(' ') === [younger.id, stillOpen.id].sort().join(' '),
    gLive.map((t) => `${t.id}:${t.status}`).join(' ') || 'leer',
  );
  check(
    '…und das Archiv hält genau die ältere',
    gArchived.map((t) => t.id).join(' ') === String(older.id),
    gArchived.map((t) => t.id).join(' ') || 'leer',
  );

  const gp = await open(context, '/dashboard');
  await pin(gp, agedSeason.id, `/project/${gProject.id}`);
  const gRows = await until(() => rowIds(gp), (r) => r.length === gLive.length, 8000);
  check(
    'die Projekttabelle zeigt die jüngere und die offene Zeile, die ältere nicht',
    [...gRows].sort().join(' ') === gLive.map((t) => String(t.id)).sort().join(' ') &&
      !gRows.includes(String(older.id)),
    gRows.join(' ') || 'keine Zeilen',
  );
  await gp.goto(`${UI}/#/archiv`);
  await gp.reload();
  await ready(gp);
  const gArchivePage = await until(() => archiveRows(gp), (r) => r.length === 1, 8000);
  check(
    '…und das Archiv dieser Saison zeigt sie, und nur sie',
    gArchivePage.length === 1 && gArchivePage[0]?.title === older.title,
    gArchivePage.map((r) => r.title).join(' | ') || 'leer',
  );

  // ======================================================================== AK · what „erledigt“ means
  //
  // The archive is the pair `(status = the done option) AND (erledigt_am <= cutoff)`, and only the
  // first half is configurable. Moving the flag to another category is therefore the one path in
  // the app that takes a task back *out* of the archive — and it is a definition change, not a
  // write: `erledigt_am` is untouched and the rows simply stop matching.
  //
  // The door is „Verwalten" on `#/einstellungen/aufgaben`, not the Kategorien tab, which holds the
  // other three option lists (case Q) and not this one.
  console.log('\nAK · Was „erledigt“ heißt, entscheidet über das Archiv');
  /** Open „Spalten verwalten" → the Status row's ✎, and say whether both really opened. */
  const openStatusEditor = async (page) => {
    await page.goto(`${UI}/#/einstellungen/aufgaben`);
    await page.reload();
    await ready(page);
    await clickIfThere(page.getByRole('button', { name: 'Verwalten' }));
    const manager = topDialog(page);
    const managerUp = await shown(manager.getByRole('heading', { name: 'Spalten verwalten' }), 8000);
    // „Status" appears in no other row's text — Priorität reads „Priorität / Auswahl · 3".
    await clickIfThere(
      manager.locator('[data-column-row]').filter({ hasText: 'Status' }).first().locator('button[title="Bearbeiten"]'),
    );
    const editor = topDialog(page);
    const editorUp = await shown(editor.getByRole('heading', { name: /„Status“ bearbeiten/ }), 8000);
    return { editor, ok: managerUp && editorUp };
  };
  /** Which option rows carry the „erledigt" radio, in order. */
  const doneFlags = (editor) =>
    editor
      .locator('input[type="radio"]')
      .evaluateAll((els) => els.map((el) => /** @type {HTMLInputElement} */ (el).checked));

  const flagFirst = await openStatusEditor(gp);
  const optionLabels = flagFirst.ok
    ? await flagFirst.editor
        .locator('[data-option-label]')
        .evaluateAll((els) => els.map((el) => /** @type {HTMLInputElement} */ (el).value))
    : [];
  const flagsBefore = flagFirst.ok ? await doneFlags(flagFirst.editor) : [];
  check(
    'der Editor der Status-Spalte trägt die Kategorien der Saison, und genau eine ist „erledigt“',
    flagFirst.ok && optionLabels.length === gOptions.length && flagsBefore.filter(Boolean).length === 1,
    `${optionLabels.join(' | ')} — ${flagsBefore.join(',')}`,
  );

  // A radio, not a checkbox: picking one clears the others (`OptionsEditor.update`), so there is
  // nothing to untick first. The target category is the one no fixture task holds, so the only thing
  // this save changes is which rows the archive query can match.
  const doneIndex = flagsBefore.indexOf(true);
  const flagTarget = doneIndex === 1 ? 0 : 1;
  await clickIfThere(flagFirst.editor.locator('[data-option-row]').nth(flagTarget).locator('input[type="radio"]'));
  const flagsAfter = await until(
    () => doneFlags(flagFirst.editor),
    (f) => f[flagTarget] === true && f.filter(Boolean).length === 1,
    4000,
  );
  check(
    '…das Umschalten nimmt es der alten Kategorie ab, statt eine zweite zu markieren',
    flagsAfter[flagTarget] === true && flagsAfter.filter(Boolean).length === 1,
    flagsAfter.join(','),
  );
  await clickIfThere(flagFirst.editor.getByRole('button', { name: 'Speichern' }), 8000);
  const storedOptions = await until(
    () =>
      api(G('/custom-columns')).then((cols) =>
        JSON.parse(cols.find((c) => c.key === 'status')?.options ?? '[]'),
      ),
    (o) => o[flagTarget]?.done === true && o.filter((x) => x.done).length === 1,
    8000,
  );
  check(
    'gespeichert trägt genau die andere Kategorie das Kennzeichen, unter ihrem alten Wert',
    storedOptions.filter((o) => o.done).length === 1 &&
      storedOptions[flagTarget]?.done === true &&
      storedOptions[flagTarget]?.value === gOptions[flagTarget]?.value,
    storedOptions.map((o) => `${o.label}${o.done ? '*' : ''}`).join(' | '),
  );
  // „Spalten verwalten" stays open behind the editor it opened, and its backdrop would eat the next
  // navigation's clicks.
  await gp.keyboard.press('Escape');
  await gone(gp.getByRole('heading', { name: 'Spalten verwalten' }), 5000);

  await gp.goto(`${UI}/#/archiv`);
  await gp.reload();
  await ready(gp);
  const archEmpty = await until(() => archiveSections(gp), (s) => (s[0]?.empty ?? '').length > 0, 8000);
  check(
    'das Archiv ist damit leer — und sagt die Frist des Servers dazu, statt „30“ zu behaupten',
    archEmpty[0]?.tasks === 0 &&
      archEmpty[0]?.empty ===
        `Noch nichts archiviert. Erledigte Aufgaben wandern ${dayCountDe(retentionDays)} nach Abschluss hierher.`,
    JSON.stringify(archEmpty[0]),
  );
  await gp.goto(`${UI}/#/project/${gProject.id}`);
  await gp.reload();
  await ready(gp);
  const backInTable = await until(() => rowIds(gp), (r) => r.length === 3, 8000);
  check(
    '…und die gealterte Zeile steht wieder in der Projekttabelle',
    backInTable.length === 3 && backInTable.includes(String(older.id)),
    backInTable.join(' ') || 'keine Zeilen',
  );
  const untouched = await api(G(`/tasks/${older.id}`));
  check(
    '…ohne dass ihr „Erledigt am“ angefasst worden wäre: geändert hat sich die Definition, nicht die Zeile',
    untouched.erledigt_am === older.wanted && untouched.status === gDone,
    `${untouched.erledigt_am} / ${untouched.status}`,
  );

  // And back, because „the archive emptied" is also what a broken archive query looks like.
  const flagSecond = await openStatusEditor(gp);
  if (flagSecond.ok) {
    await clickIfThere(flagSecond.editor.locator('[data-option-row]').nth(doneIndex).locator('input[type="radio"]'));
    await clickIfThere(flagSecond.editor.getByRole('button', { name: 'Speichern' }), 8000);
  }
  const archivedAgain = await until(
    () => api(G(`/tasks?project_id=${gProject.id}&scope=archive`)).then((r) => r.map((t) => t.id)),
    (ids) => ids.length === 1,
    8000,
  );
  check(
    'zurückgeschoben liegt sie wieder im Archiv: die Grenze folgt dem Kennzeichen, nicht dem Wort „Erledigt“',
    archivedAgain.join(' ') === String(older.id),
    archivedAgain.join(' ') || 'leer',
  );
  await gp.keyboard.press('Escape');

  // ======================================================================== AL–AO · the column types
  //
  // The task table has no fixed column list — every column is a `custom_columns` row — but the
  // *types* are not data-driven at all. `CustomCell` is four hardcoded branches, each with its own
  // way of taking a value in (an `InlineInput`, a native date picker, a checkbox, a `PillSelect`)
  // and its own way of putting it back on screen. The demo plants three of the four with values
  // (select · checkbox · date) plus one artist-scoped select; `text` has no fixture at all — it is
  // the branch `CustomCell` reaches by falling through — and nothing drove any of them.
  //
  // `npm run check:api` owns the server half: the `writable` allowlist, the `custom_values` merge,
  // the scope/parent CHECK. What only a browser can see is a type that renders but silently
  // refuses input, or accepts it and drops it.
  //
  // Case G owns the per-page hide/show *write shape* — one global built-in on an artist page,
  // `{"due":false}`, the override pruned again on re-show. AO's ground is the interplay: three
  // columns of three types hidden in one burst, the two different stores the same 👁 writes to,
  // and what hiding a column does to a sort that is running on it.

  /** One column per type, created below. None of these names exists on the demo — asserted. */
  const CC_NAMES = ['Zuständig', 'Zusage bis', 'Vertrag', 'Phase'];
  /**
   * The „Phase" categories in the order the user arranges them — workflow order, which is
   * deliberately *not* alphabetical. That difference is what makes „an Auswahl column sorts by its
   * configured order" (TTU-19) an assertion rather than a coincidence.
   */
  const CC_PHASES = ['Vorbereitung', 'Durchführung', 'Nachbereitung'];
  /** The demo's three global custom columns — one select, one checkbox, one date. */
  const CC_GLOBALS = ['Bereich', 'Bestätigt', 'Abgabe'];

  /** Bounded and swallowed, like `clickIfThere`: a red assertion must degrade, never end the run. */
  const ccFill = (locator, text, timeout = 5000) =>
    locator.first().fill(text, { timeout }).then(() => true).catch(() => false);
  const ccPick = (locator, value, timeout = 5000) =>
    locator.first().selectOption(value, { timeout }).then(() => true).catch(() => false);
  const ccPress = (locator, key, timeout = 5000) =>
    locator.first().press(key, { timeout }).then(() => true).catch(() => false);
  /** `#rrggbb` as Chromium serialises it, so a colour assertion can name the column's own value. */
  const ccRgb = (hex) => {
    const n = Number.parseInt(String(hex).replace('#', ''), 16);
    return Number.isNaN(n) ? String(hex) : `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
  };

  // ======================================================================== AL · one column per type
  console.log('\nAL · Eine Spalte je Typ, über „⚙ Spalten“ angelegt');
  const CC = scoped(columnsSeason.id);
  const cc = await open(context, '/dashboard');
  await pin(cc, columnsSeason.id, '/project/2');

  /** This page's own columns. A scoped list has to name its parent, or the route answers 400. */
  const ccOwnCols = () => api(CC('/custom-columns?scope=project&project_id=2'));
  const ccProject = () => api(CC('/projects/2'));

  /**
   * The task table's header row as plain text.
   *
   * Found by „Aufgabe" rather than as `document.querySelector('table')`: a project description can
   * hold a Markdown table of its own. Every cell position below is counted off this list rather
   * than written down — the demo's column set is a fixture and this slice adds four more to it.
   */
  const ccHeads = () =>
    cc.evaluate(() => {
      const table = [...document.querySelectorAll('table')].find((t) =>
        [...t.querySelectorAll('thead th')].some((th) => (th.textContent ?? '').trim() === 'Aufgabe'),
      );
      return [...(table?.querySelectorAll('thead th') ?? [])].map((th) => (th.textContent ?? '').trim());
    });
  /**
   * `td` position (1-based) of the column whose header contains `name`. The gutter is cell 1 in
   * the header row and in every body row, so the two line up index for index. Refreshed by hand
   * wherever the column set changes below; a name that is not in the row yields 0, which
   * `ccCell` turns into a locator that cannot match (see there).
   */
  let ccHeadRow = [];
  const ccAt = (name) => ccHeadRow.findIndex((h) => h.toLowerCase().includes(name.toLowerCase())) + 1;
  /**
   * `nth-child(9999)` and never `nth-child(0)` for a column that is not on screen. On this
   * Chromium `td:nth-child(0)` matches **every** `td` of the row rather than none — measured
   * through `document.querySelectorAll` as well as through Playwright — so a missing column
   * silently addressed the first control in the row, and one failure detail described a checkbox
   * where a date cell was expected.
   */
  const ccCell = (taskId, name) => {
    const i = ccAt(name);
    return cc.locator(`tr[data-task-id="${taskId}"] td:nth-child(${i > 0 ? i : 9999})`);
  };

  const ccBefore = await ccOwnCols();
  const ccAllCols = await api(CC('/custom-columns'));
  check(
    'die Kopie startet ohne eigene Spalten auf dieser Seite …',
    ccBefore.length === 0,
    ccBefore.map((c) => c.name).join(' | ') || 'keine',
  );
  // The precondition every poll below leans on: nothing this case waits for can be satisfied by a
  // column or a value the demo already planted.
  check(
    '…und keiner der vier Namen ist in der Saison vergeben',
    !ccAllCols.some((c) => CC_NAMES.includes(c.name)),
    ccAllCols.map((c) => c.name).join(' | '),
  );

  await clickIfThere(cc.getByRole('button', { name: '⚙ Spalten' }).first());
  const ccDlg = topDialog(cc);
  const ccManagerUp = await shown(ccDlg.getByRole('heading', { name: 'Spalten verwalten' }), 8000);
  check(
    '„Spalten verwalten“ ist offen und die Liste dieser Seite ist leer',
    ccManagerUp && (await shown(ccDlg.getByText('Noch keine Spalten.'), 4000)),
  );
  // Both of these are counts of something that is *not* there, so both carry `ccManagerUp`: a
  // dialog that never opened has no reset button and no category rows either.
  check(
    '…und „Auf Saison-Vorgabe zurücksetzen“ wird nicht angeboten, solange nichts abweicht',
    ccManagerUp && (await ccDlg.getByRole('button', { name: /Saison-Vorgabe/ }).count()) === 0,
  );

  const ccTypeSelect = ccDlg.locator('select');
  const ccTypes = await ccTypeSelect
    .locator('option')
    .evaluateAll((els) => els.map((el) => `${el.value}=${(el.textContent ?? '').trim()}`))
    .catch(() => []);
  check(
    'die „Neue Spalte“-Auswahl bietet genau die vier Typen an, die in `custom_values` landen',
    ccTypes.join(' | ') === 'text=Text | date=Datum | checkbox=Checkbox | select=Auswahl (farbig)',
    ccTypes.join(' | ') || 'keine Optionen',
  );
  check(
    'für „Text“ gibt es keine Kategorienliste',
    ccManagerUp && (await ccDlg.locator('[data-option-row]').count()) === 0,
  );
  await ccPick(ccTypeSelect, 'select');
  const ccSeeds = await until(
    () => ccDlg.locator('[data-option-label]').evaluateAll((els) => els.map((el) => el.value)),
    (v) => v.length > 0,
    4000,
  );
  check(
    '„Auswahl“ bringt zwei Startkategorien mit, die auf ihre Namen warten',
    ccSeeds.join(' | ') === 'offen | fertig',
    ccSeeds.join(' | ') || 'keine',
  );
  await ccPick(ccTypeSelect, 'text');
  check(
    '…und zurück auf „Text“ ist die Liste wieder weg',
    (await until(() => ccDlg.locator('[data-option-row]').count(), (n) => n === 0, 4000)) === 0,
  );

  // The one thing this form refuses, and it refuses silently: `add` starts with
  // `if (!name.trim()) return`, so there is no disabled button and no message — unlike the option
  // editors on „Kategorien" (case Q), which go stumpf with the reason beside the row. „Nothing
  // happened" is therefore a beat plus a re-read, never a wait for something to appear.
  await clickIfThere(ccDlg.getByRole('button', { name: '+ Spalte hinzufügen' }));
  await sleep(700);
  const ccNameless = await ccOwnCols();
  check(
    'ohne Namen wird keine Spalte angelegt',
    ccNameless.length === 0,
    ccNameless.map((c) => c.name).join(' | ') || 'keine',
  );

  /**
   * Fill the „Neue Spalte" form and submit it, then wait for the form to **clear itself**.
   *
   * That last wait is the trap. The reset — `setName('')`, `setOptions([])`, `setType('text')` —
   * runs after the POST resolves, so a `selectOption` issued as soon as the API lists the new
   * column is overwritten a tick later and the *next* column is created as a Text one, with every
   * assertion about it silently about the wrong type (docs/VERIFYING.md).
   */
  const ccAdd = async (name, type, iconTitle) => {
    await ccPick(ccTypeSelect, type);
    await ccFill(ccDlg.getByPlaceholder('z. B. Verantwortlich'), name);
    if (iconTitle) await clickIfThere(ccDlg.locator(`button[title="${iconTitle}"]`));
    if (type === 'select') {
      // The two seed rows go, one click per render: `OptionsEditor`'s rows are keyed by index, so
      // two clicks on „the last ✕" inside one render address the same position twice. Removed
      // rather than renamed, because `normalizeOptions` keeps an existing `value` — a renamed
      // „offen" would still be stored as `offen`, and the categories below want label == value.
      for (let i = 0; i < 2; i++) {
        await clickIfThere(
          ccDlg.locator('[data-option-row]').last().getByRole('button', { name: 'Entfernen' }),
        );
        await until(() => ccDlg.locator('[data-option-row]').count(), (n) => n === 1 - i, 4000);
      }
      for (const [i, label] of CC_PHASES.entries()) {
        await clickIfThere(ccDlg.getByRole('button', { name: '+ Kategorie' }));
        await until(() => ccDlg.locator('[data-option-row]').count(), (n) => n === i + 1, 4000);
        await ccFill(ccDlg.locator('[data-option-label]').last(), label);
      }
    }
    await clickIfThere(ccDlg.getByRole('button', { name: '+ Spalte hinzufügen' }));
    await until(
      () => ccDlg.getByPlaceholder('z. B. Verantwortlich').inputValue().catch(() => null),
      (v) => v === '',
      8000,
    );
    // Polled on the season's **whole** column list rather than on this page's own group. Whether
    // the create really put the column in this page's scope is what the assertion below is about,
    // and a wait that presupposed it would turn that assertion into a bare timeout.
    const all = await until(
      () => api(CC('/custom-columns')),
      (cols) => cols.some((c) => c.name === name),
      8000,
    );
    return all.find((c) => c.name === name);
  };

  const ccText = await ccAdd('Zuständig', 'text', 'Person');
  const ccDate = await ccAdd('Zusage bis', 'date');
  const ccBox = await ccAdd('Vertrag', 'checkbox');
  const ccSel = await ccAdd('Phase', 'select');
  const ccFour = [ccText, ccDate, ccBox, ccSel];
  check(
    'vier Spalten, eine je Typ — jede an dieser Seite und an keiner anderen',
    ccFour.every(
      (c, i) =>
        !!c &&
        c.type === ['text', 'date', 'checkbox', 'select'][i] &&
        c.scope === 'project' &&
        c.project_id === 2 &&
        c.artist_id === null &&
        // `kind` and `key` are not client-writable, so a create is always a custom column bound to
        // the blob rather than to a `tasks` field (CCL-24).
        c.kind === 'custom' &&
        c.key === null,
    ),
    ccFour.map((c) => `${c?.name}:${c?.type}:${c?.scope}/${c?.project_id}:${c?.kind}`).join(' | '),
  );
  check(
    '…und nur die „Auswahl“ trägt Kategorien, in der eingestellten Reihenfolge',
    JSON.parse(ccSel?.options ?? '[]')
      .map((o) => `${o.label}=${o.value}`)
      .join(' | ') === CC_PHASES.map((p) => `${p}=${p}`).join(' | ') &&
      [ccText, ccDate, ccBox].every((c) => c?.options === null),
    `${ccSel?.options} / ${[ccText, ccDate, ccBox].map((c) => String(c?.options)).join(', ')}`,
  );

  /** One manager row, addressed by the column's name — `[data-column-row]` matches both lists. */
  const ccRowText = (name) =>
    ccDlg
      .locator('[data-column-row]')
      .filter({ hasText: name })
      .first()
      .evaluate((el) => (el.textContent ?? '').trim())
      .catch(() => '');
  const ccRowTexts = [];
  for (const name of CC_NAMES) ccRowTexts.push(await ccRowText(name));
  check(
    'die Liste dieser Seite nennt jeden Typ mit seinem deutschen Namen',
    ['Text', 'Datum', 'Checkbox', 'Auswahl · 3'].every((label, i) => ccRowTexts[i]?.includes(label)),
    ccRowTexts.join(' | '),
  );
  const ccSwatches = await ccDlg
    .locator('[data-column-row]')
    .filter({ hasText: 'Phase' })
    .first()
    .locator('span.rounded-full[title]')
    .count();
  check(
    '…und zeigt die drei Kategorienfarben der „Auswahl“ als Punkte',
    ccSwatches === 3,
    `${ccSwatches} Punkte`,
  );

  // Read while the manager is still open: creating a column invalidates, so it reaches the table
  // without a reload — and a case that reloads first cannot tell that apart from a build that only
  // picks a new column up on the next load.
  ccHeadRow = await until(ccHeads, (h) => h.some((x) => x.includes('Phase')), 8000);
  // The last `th` is the actions column and carries no text, so the four own ones are the four
  // before it — which is also the assertion: `compareColumns` puts every global first (TTU-21).
  check(
    'die vier Köpfe stehen in der Tabelle, ohne Neuladen und hinter den globalen',
    ccHeadRow.slice(-5, -1).join(' | ') === '👤 Zuständig | Zusage bis | Vertrag | Phase',
    ccHeadRow.join(' | '),
  );
  check(
    '…und der Dialog steht dabei noch offen',
    (await ccDlg.getByRole('heading', { name: 'Spalten verwalten' }).count()) === 1,
  );
  check(
    'nur die Spalte mit Symbol trägt es im Kopf, die anderen stehen ohne da',
    ccText?.icon === '👤' && ccBox?.icon === null && ccHeadRow.includes('Vertrag'),
    `${ccText?.icon} / ${ccBox?.icon}`,
  );
  await cc.keyboard.press('Escape');
  await gone(cc.getByRole('heading', { name: 'Spalten verwalten' }), 5000);

  // ======================================================================== AM · one value per type
  //
  // Four widgets, four ways in, one blob. The row starts empty — a fixture fact of project 2 — so
  // every poll below can only be satisfied by what this case types into it.
  console.log('\nAM · Ein Wert je Typ: eingegeben, gespeichert, angezeigt');
  const CC_TASK = 34; // „Schulen kontaktieren", the one project-2 row that carries a Fällig date
  const CC_OTHER = 35; // „Material für Workshop drucken" — no dates at all, the empty control
  const ccValues = (id) => api(CC(`/tasks/${id}`)).then((t) => JSON.parse(t.custom_values || '{}'));
  const ccKey = (col) => String(col?.id ?? 0);

  const ccEmptyStart = await ccValues(CC_TASK);
  check(
    'die Zeile startet ohne einen einzigen eigenen Wert',
    Object.keys(ccEmptyStart).length === 0,
    JSON.stringify(ccEmptyStart),
  );

  // Built with `setDate`, never `Date.now() + n * 86_400_000`: everything stored here is naive
  // local time, and a fixed span of milliseconds names a different day across a DST change.
  const ccDay = new Date();
  ccDay.setDate(ccDay.getDate() + 40);
  const ccIso = `${ccDay.getFullYear()}-${pad2(ccDay.getMonth() + 1)}-${pad2(ccDay.getDate())}`;
  const ccGerman = `${pad2(ccDay.getDate())}.${pad2(ccDay.getMonth() + 1)}.${ccDay.getFullYear()}`;

  /** Open a cell's inline editor, type, commit with Enter. Every step bounded and swallowed. */
  const ccType = async (taskId, name, text) => {
    await clickIfThere(ccCell(taskId, name).locator('button'));
    const input = ccCell(taskId, name).locator('input');
    if (!(await shown(input, 4000))) return false;
    await ccFill(input, text);
    return ccPress(input, 'Enter');
  };
  /**
   * A pill is a popover: `useAnchoredPopover` closes on any outside scroll, and the scroll a click
   * performs for itself arrives *after* the menu opened — so scroll first, then click. The menu
   * is waited for rather than assumed, so a caller that could not open it says so.
   */
  const ccPillIn = (taskId, name) => ccCell(taskId, name).locator('button[aria-haspopup="listbox"]');
  const ccOpenPill = async (taskId, name) => {
    await ccPillIn(taskId, name).scrollIntoViewIfNeeded().catch(() => {});
    if (!(await clickIfThere(ccPillIn(taskId, name)))) return false;
    return shown(cc.locator('[role="listbox"]'), 4000);
  };

  // One write at a time, each waited out before the next gesture. Not decoration: every commit
  // ends in a blanket invalidate, and with two refetches in flight the pill's popover opened onto
  // a table that re-rendered under it — the pick landed nowhere and the cell stayed „—" once in a
  // full run. What „several writes inside one refetch window" does is AN's ground, with the GET
  // held back on purpose rather than by accident.
  await ccType(CC_TASK, 'Zuständig', 'Merle Dahlke');
  await until(() => ccValues(CC_TASK), (v) => v[ccKey(ccText)] === 'Merle Dahlke', 8000);
  await ccType(CC_TASK, 'Zusage bis', ccIso);
  await until(() => ccValues(CC_TASK), (v) => v[ccKey(ccDate)] === ccIso, 8000);
  await clickIfThere(ccCell(CC_TASK, 'Vertrag').locator('input[type="checkbox"]'));
  await until(() => ccValues(CC_TASK), (v) => v[ccKey(ccBox)] === true, 8000);
  await ccOpenPill(CC_TASK, 'Phase');
  await clickIfThere(cc.locator(`[role="option"][data-value="${CC_PHASES[0]}"]`));

  const ccStored = await until(() => ccValues(CC_TASK), (v) => Object.keys(v).length === 4, 8000);
  check(
    'alle vier Typen schreiben in dieselbe Zelle der Zeile, jeder unter seiner Spalten-id',
    ccStored[ccKey(ccText)] === 'Merle Dahlke' &&
      ccStored[ccKey(ccDate)] === ccIso &&
      ccStored[ccKey(ccBox)] === true &&
      ccStored[ccKey(ccSel)] === CC_PHASES[0],
    JSON.stringify(ccStored),
  );
  check(
    '…die Checkbox als echter Boolean, die drei anderen als Zeichenkette',
    typeof ccStored[ccKey(ccBox)] === 'boolean' &&
      [ccText, ccDate, ccSel].every((c) => typeof ccStored[ccKey(c)] === 'string'),
    ccFour.map((c) => `${c?.type}:${typeof ccStored[ccKey(c)]}`).join(' '),
  );

  /**
   * One reading of a row's cells — text, checkbox state, pill colour and how many controls the
   * cell offers. A single `evaluate`, because two round trips can straddle a background refetch's
   * re-render and compare readings taken from different commits.
   */
  const ccRender = (taskId, positions) =>
    cc.evaluate(
      ([id, pos]) => {
        const tds = [...document.querySelectorAll(`tr[data-task-id="${id}"] td`)];
        /** @type {Record<string, {text: string, checked: boolean|null, pill: string|null, controls: number}>} */
        const out = {};
        for (const [key, i] of Object.entries(pos)) {
          const td = tds[Number(i) - 1];
          const box = /** @type {HTMLInputElement | null | undefined} */ (
            td?.querySelector('input[type="checkbox"]')
          );
          const pill = td?.querySelector('button[aria-haspopup="listbox"]');
          out[key] = {
            text: (td?.textContent ?? '').trim(),
            checked: box ? box.checked : null,
            pill: pill ? getComputedStyle(pill).backgroundColor : null,
            controls: td
              ? td.querySelectorAll('button, input, select, textarea, [contenteditable], div.cursor-text').length
              : -1,
          };
        }
        return out;
      },
      [taskId, positions],
    );
  const ccFourAt = () => ({
    text: ccAt('Zuständig'),
    date: ccAt('Zusage bis'),
    box: ccAt('Vertrag'),
    sel: ccAt('Phase'),
  });

  // The colour comes from the column's own options rather than from a literal: it is the swatch
  // the user picked in the form above, and a hardcoded value would pass on a pill painted by
  // something else entirely.
  const ccFirstColour = ccRgb(JSON.parse(ccSel?.options ?? '[]')[0]?.color);
  // It is also in the poll's predicate, and that is not tidiness: the pill carries Tailwind's
  // `transition`, so its background is interpolating from the grey placeholder for 150 ms after
  // the pick, and `reducedMotion: 'reduce'` touches animations rather than transitions. A reading
  // taken on the *label* alone caught it mid-flight at `rgb(254, 227, 227)` for a category
  // configured as `#fee2e2`, which reads as „the pill paints the wrong colour".
  const ccOn = await until(
    () => ccRender(CC_TASK, ccFourAt()),
    (r) => r.text?.text === 'Merle Dahlke' && r.sel?.text === CC_PHASES[0] && r.sel?.pill === ccFirstColour,
    8000,
  );
  check('die Textspalte zeigt genau das Getippte', ccOn.text?.text === 'Merle Dahlke', String(ccOn.text?.text));
  check(
    'die Datumsspalte zeigt den deutschen Tag, gespeichert bleibt die ISO-Form',
    ccOn.date?.text === ccGerman && ccStored[ccKey(ccDate)] === ccIso,
    `${ccOn.date?.text} / ${ccStored[ccKey(ccDate)]}`,
  );
  check('die Checkbox steht auf gesetzt', ccOn.box?.checked === true, String(ccOn.box?.checked));
  check(
    'die Auswahl trägt die Bezeichnung ihrer Kategorie in deren eigener Farbe',
    ccOn.sel?.text === CC_PHASES[0] && ccOn.sel?.pill === ccFirstColour,
    `${ccOn.sel?.text} / ${ccOn.sel?.pill} statt ${ccFirstColour}`,
  );

  const ccOff = await ccRender(CC_OTHER, ccFourAt());
  check(
    'die Nachbarzeile bleibt in allen vier Spalten leer — „—“, „—“, ungesetzt, „—“',
    ccOff.text?.text === '—' &&
      ccOff.date?.text === '—' &&
      ccOff.box?.checked === false &&
      ccOff.sel?.text === '—',
    `${ccOff.text?.text} | ${ccOff.date?.text} | ${ccOff.box?.checked} | ${ccOff.sel?.text}`,
  );

  /** The values a pill's menu offers, in order — then close it again. */
  const ccMenu = async (taskId, name) => {
    if (!(await ccOpenPill(taskId, name))) return null;
    const values = await cc
      .locator('[role="listbox"] [role="option"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-value') ?? ''));
    await cc.keyboard.press('Escape');
    await gone(cc.locator('[role="listbox"]'), 4000);
    return values;
  };
  const ccSelMenu = await ccMenu(CC_TASK, 'Phase');
  const ccStatusMenu = await ccMenu(CC_TASK, 'Status');
  check(
    'die eigene Auswahl bietet zusätzlich „kein Wert“ an …',
    (ccSelMenu ?? []).join(' | ') === ['', ...CC_PHASES].join(' | '),
    (ccSelMenu ?? []).join(' | ') || 'kein Menü',
  );
  // `CustomCell` passes `allowEmpty` and the Status branch does not, so the empty entry is the one
  // thing that tells the two uses of the same pill apart — „it lists the categories" does not.
  check(
    '…die Status-Spalte daneben nicht: dieselbe Pille, zwei Verträge',
    Array.isArray(ccStatusMenu) && ccStatusMenu.length > 0 && !ccStatusMenu.includes(''),
    (ccStatusMenu ?? []).join(' | ') || 'kein Menü',
  );

  // ======================================================================== AN · what a cell refuses
  //
  // The other half of „does the type work": what must *not* be written. Every refusal below is
  // paired with the acceptance that proves the cell was reachable at all — AM is that pair for the
  // three positive cases, and the two that need one of their own carry it in the same check.
  console.log('\nAN · Was eine Zelle verwirft — und was sie nicht verlieren darf');

  /**
   * Every task PATCH this page issues, so „nothing was written" is a reading and not a hope.
   * @type {string[]}
   */
  const ccPatches = [];
  cc.on('request', (r) => {
    if (r.method() === 'PATCH' && r.url().includes('/api/tasks/')) ccPatches.push(r.url());
  });

  // 1 · a half-typed date, in an **empty** cell: typing a segment into a filled one replaces that
  // segment and the value stays complete, so the same check would pass vacuously there.
  ccPatches.length = 0;
  await clickIfThere(ccCell(CC_OTHER, 'Zusage bis').locator('button'));
  const ccHalf = ccCell(CC_OTHER, 'Zusage bis').locator('input');
  if (await shown(ccHalf, 4000)) await cc.keyboard.type('12');
  const ccBad = await ccHalf
    .first()
    .evaluate((el) => {
      const input = /** @type {HTMLInputElement} */ (el);
      return { value: input.value, bad: input.validity.badInput };
    })
    .catch(() => null);
  // Asserted as its own precondition: on a browser whose date segments are ordered differently,
  // two digits might complete the field and everything below would pass without a repro.
  check(
    'zwei Ziffern in einer leeren Datumszelle sind noch kein Datum — der Browser sagt es selbst',
    ccBad?.bad === true && ccBad?.value === '',
    JSON.stringify(ccBad),
  );
  await ccPress(ccHalf, 'Enter');
  await sleep(600);
  const ccStillOpen = await ccCell(CC_OTHER, 'Zusage bis').locator('input').count();
  check(
    'Enter schreibt darauf nichts und lässt den Editor offen, damit das Datum fertig getippt werden kann (WP-43)',
    ccStillOpen === 1 && ccPatches.length === 0,
    `${ccStillOpen} Feld(er), ${ccPatches.length} PATCH`,
  );
  await cc.keyboard.press('Escape');
  await gone(ccCell(CC_OTHER, 'Zusage bis').locator('input'), 4000);
  const ccOtherValues = await ccValues(CC_OTHER);
  check(
    '…und Escape wirft die Ziffern weg, statt eine leere Zelle daraus zu machen',
    Object.keys(ccOtherValues).length === 0 && ccPatches.length === 0,
    `${JSON.stringify(ccOtherValues)}, ${ccPatches.length} PATCH`,
  );

  // 2 · Escape in a text cell that *has* a value: the draft goes, the stored value stands.
  ccPatches.length = 0;
  await clickIfThere(ccCell(CC_TASK, 'Zuständig').locator('button'));
  const ccDraft = ccCell(CC_TASK, 'Zuständig').locator('input');
  if (await shown(ccDraft, 4000)) {
    await ccFill(ccDraft, 'Etwas ganz anderes');
    await ccPress(ccDraft, 'Escape');
  }
  await sleep(600);
  const ccKept = (await ccValues(CC_TASK))[ccKey(ccText)];
  check(
    'Escape in einer Textzelle verwirft den Entwurf, ohne zu schreiben',
    ccPatches.length === 0 && ccKept === 'Merle Dahlke',
    `${ccPatches.length} PATCH, ${JSON.stringify(ccKept)}`,
  );

  // 3 · the pair only the API witnesses: an emptied custom cell keeps its key with an empty value
  // (`empty: 'raw'`), an emptied Fällig really becomes NULL (`empty: 'clear'`). Both are „—".
  const ccDueBefore = (await api(CC(`/tasks/${CC_TASK}`))).due_date;
  await ccType(CC_TASK, 'Zuständig', '');
  const ccCleared = await until(() => ccValues(CC_TASK), (v) => v[ccKey(ccText)] === '', 8000);
  check(
    'eine geleerte eigene Textspalte behält ihren Schlüssel mit leerem Wert',
    ccKey(ccText) in ccCleared && ccCleared[ccKey(ccText)] === '',
    JSON.stringify(ccCleared),
  );
  await ccType(CC_TASK, 'Fällig', '');
  const ccDueAfter = await until(
    () => api(CC(`/tasks/${CC_TASK}`)).then((t) => t.due_date),
    (v) => v === null,
    8000,
  );
  check(
    '…während das geleerte eingebaute „Fällig“ daneben wirklich NULL wird',
    !!ccDueBefore && ccDueAfter === null,
    `${ccDueBefore} → ${JSON.stringify(ccDueAfter)}`,
  );
  const ccDashes = await until(
    () => ccRender(CC_TASK, { text: ccAt('Zuständig'), due: ccAt('Fällig') }),
    (r) => r.text?.text === '—' && r.due?.text === '—',
    8000,
  );
  check(
    '…und beide zeigen denselben Strich: der Unterschied steht nur in der Datenbank',
    ccDashes.text?.text === '—' && ccDashes.due?.text === '—',
    `${ccDashes.text?.text} / ${ccDashes.due?.text}`,
  );

  // 4 · unticking writes `false` rather than dropping the key — a checkbox has no „unset".
  await clickIfThere(ccCell(CC_TASK, 'Vertrag').locator('input[type="checkbox"]'));
  const ccUnticked = await until(() => ccValues(CC_TASK), (v) => v[ccKey(ccBox)] === false, 8000);
  check(
    'die abgehakte Checkbox schreibt `false`, statt den Schlüssel zu entfernen',
    ccKey(ccBox) in ccUnticked && ccUnticked[ccKey(ccBox)] === false,
    JSON.stringify(ccUnticked),
  );

  // 5 · the built-in that renders and takes nothing, on purpose — with the pair that says the row
  // was reachable at all. („Erstellt am" is the other one and ships hidden.)
  const ccReadOnly = await ccRender(CC_TASK, {
    upd: ccAt('Zuletzt bearbeitet'),
    text: ccAt('Zuständig'),
  });
  check(
    '„Zuletzt bearbeitet“ zeigt einen Wert und bietet kein einziges Bedienelement an …',
    ccReadOnly.upd?.controls === 0 && (ccReadOnly.upd?.text ?? '').length > 0,
    JSON.stringify(ccReadOnly.upd),
  );
  check(
    '…die eigene Textspalte derselben Zeile dagegen genau eines',
    ccReadOnly.text?.controls === 1,
    JSON.stringify(ccReadOnly.text),
  );
  await clickIfThere(ccCell(CC_TASK, 'Zuletzt bearbeitet'));
  await sleep(400);
  check(
    'ein Klick darauf öffnet nichts — ein fehlender Knopf ist nicht dasselbe wie ein fehlender Handler',
    (await ccCell(CC_TASK, 'Zuletzt bearbeitet').locator('input').count()) === 0,
  );

  // 6 · two cells written before the row's own refetch has landed (TTU-23). `commitCustom` sends
  // the changed key alone and the server merges it; a version that sent the whole blob would
  // rebuild it from the `task` captured at render time and silently undo the first write. The GET
  // has to be held, or the refetch beats the second click and both versions pass — measured on
  // this page: PATCH 1 at +0 ms, its refetch issued at +11 ms and held, PATCH 2 at +61 ms.
  // `continue()` is guarded: an in-flight handler that is still sleeping when the `unroute` below
  // runs rejects with „Route is already handled", and a route callback is outside this file's try
  // — the rejection took the whole run down rather than one assertion.
  await cc.route('**/api/tasks*', async (route) => {
    if (route.request().method() === 'GET') await sleep(1200);
    await route.continue().catch(() => {});
  });
  await clickIfThere(ccCell(CC_TASK, 'Vertrag').locator('input[type="checkbox"]'));
  await ccOpenPill(CC_TASK, 'Phase');
  await clickIfThere(cc.locator(`[role="option"][data-value="${CC_PHASES[1]}"]`));
  const ccBoth = await until(
    () => ccValues(CC_TASK),
    (v) => v[ccKey(ccBox)] === true && v[ccKey(ccSel)] === CC_PHASES[1],
    12_000,
  );
  await cc.unroute('**/api/tasks*');
  check(
    'zwei Zellen kurz hintereinander, bevor die Zeile neu geladen ist: beide Werte stehen (TTU-23)',
    ccBoth[ccKey(ccBox)] === true && ccBoth[ccKey(ccSel)] === CC_PHASES[1],
    JSON.stringify(ccBoth),
  );

  // ======================================================================== AO · hiding across the types
  //
  // Case G asserts the write shape for one global built-in on an artist page. Here: what the same
  // 👁 does in the *other* list, three types hidden in one burst, and what hiding a column does to
  // a sort that is running on it — which is only reachable from a page's own scope group, because
  // the manager sits on the page and the table therefore stays mounted across the write.
  console.log('\nAO · Ein- und Ausblenden quer über die Typen');

  // One category per task, chosen so all three candidate orders differ: the season default is
  // 35 40 34, the configured category order 34 40 35, and a plain string compare over the stored
  // values would give 40 35 34. Written over the API and reloaded — the pill is AM's ground, and
  // what this case is about starts at the header.
  const CC_ORDER = { 34: CC_PHASES[0], 40: CC_PHASES[1], 35: CC_PHASES[2] };
  for (const [id, value] of Object.entries(CC_ORDER)) {
    await send('PATCH', CC(`/tasks/${id}`), { custom_values: { [ccKey(ccSel)]: value } });
  }
  const ccConfigured = CC_PHASES.map((p) => Object.keys(CC_ORDER).find((id) => CC_ORDER[id] === p));
  const ccAlphabetical = Object.keys(CC_ORDER).sort((a, b) => (CC_ORDER[a] < CC_ORDER[b] ? -1 : 1));

  await cc.goto(`${UI}/#/project/2`);
  await cc.reload();
  await ready(cc);
  ccHeadRow = await until(ccHeads, (h) => h.some((x) => x.includes('Phase')), 8000);
  const ccDefaultOrder = await until(() => rowIds(cc), (r) => r.length === 3, 8000);
  check(
    'die drei Zeilen stehen in der Reihenfolge der Saison-Regel',
    ccDefaultOrder.join(' ') === '35 40 34',
    ccDefaultOrder.join(' ') || 'keine Zeilen',
  );

  const ccTh = (name) => cc.locator('table thead th').filter({ hasText: new RegExp(name, 'i') }).first();
  /** The ⠿'s tooltip: the bare sentence, or the one naming the sort that has disabled it. */
  const ccHandleTitle = () =>
    cc
      .locator('tr[data-task-id] td:first-child span[title]')
      .first()
      .getAttribute('title')
      .catch(() => '');
  const ccTitleBefore = await ccHandleTitle();

  await clickIfThere(ccTh('Phase'));
  // „changed at all" rather than „is the expected order", deliberately: a build that sorts by the
  // wrong key still changes the order, and this way the assertion below reports *that* order
  // instead of timing out and reporting the one it started from. Canary 11 is what it looks like.
  const ccSorted = await until(() => rowIds(cc), (r) => r.join(' ') !== ccDefaultOrder.join(' '), 8000);
  check(
    'ein Klick auf den „Phase“-Kopf ordnet nach der eingestellten Kategorien-Reihenfolge (TTU-19)',
    ccSorted.join(' ') === ccConfigured.join(' '),
    `${ccSorted.join(' ')} (erwartet ${ccConfigured.join(' ')})`,
  );
  check(
    '…und nicht alphabetisch nach dem gespeicherten Wert — die drei Reihenfolgen sind alle verschieden',
    ccConfigured.join(' ') !== ccAlphabetical.join(' ') &&
      ccConfigured.join(' ') !== ccDefaultOrder.join(' ') &&
      ccSorted.join(' ') !== ccAlphabetical.join(' '),
    `konfiguriert ${ccConfigured.join(' ')}, alphabetisch ${ccAlphabetical.join(' ')}, Vorgabe ${ccDefaultOrder.join(' ')}`,
  );
  const ccMarker = await ccTh('Phase').innerText().catch(() => '');
  check(
    '…der Kopf zeigt die Richtung, und der ⠿ sagt, warum er gerade nicht zieht',
    ccMarker.includes('▲') && (await ccHandleTitle())?.startsWith('Spaltensortierung aktiv'),
    `${ccMarker.replace(/\n/g, ' ')} / ${await ccHandleTitle()}`,
  );

  await clickIfThere(cc.getByRole('button', { name: '⚙ Spalten' }).first());
  const ccMgr2 = topDialog(cc);
  const ccMgr2Up = await shown(ccMgr2.getByRole('heading', { name: 'Spalten verwalten' }), 8000);
  await clickIfThere(
    ccMgr2.locator('[data-column-row]').filter({ hasText: 'Phase' }).first().locator('button[title="Ausblenden"]'),
  );
  const ccConfirm = topDialog(cc);
  const ccConfirmText = (
    await ccConfirm.evaluate((el) => (el.textContent ?? '').trim()).catch(() => '')
  ).replace(/\s+/g, ' ');
  check(
    'die eigene Spalte auszublenden fragt erst nach — und sagt, dass die Werte bleiben',
    ccMgr2Up &&
      ccConfirmText.includes('Spalte „Phase“ ausblenden') &&
      ccConfirmText.includes('Die vorhandenen Werte bleiben erhalten'),
    ccConfirmText || 'kein Dialog',
  );
  await clickIfThere(ccConfirm.getByRole('button', { name: 'Ausblenden' }));
  const ccHiddenFlag = await until(
    () => ccOwnCols().then((cols) => cols.find((c) => c.id === ccSel?.id)?.enabled),
    (v) => v === 0,
    8000,
  );
  // The discriminator against case G: the same 👁, one list further down, writes the column's
  // season default and leaves this page's own map alone.
  const ccPageMap = (await ccProject()).task_columns;
  check(
    '…und schreibt dann die Saison-Vorgabe der Spalte, nicht die Karte der Seite',
    ccHiddenFlag === 0 && ccPageMap === null,
    `enabled ${ccHiddenFlag}, task_columns ${JSON.stringify(ccPageMap)}`,
  );

  await cc.keyboard.press('Escape');
  await gone(cc.getByRole('heading', { name: 'Spalten verwalten' }), 5000);
  ccHeadRow = await until(ccHeads, (h) => !h.some((x) => x.includes('Phase')), 8000);
  check('der Kopf ist damit weg', !ccHeadRow.some((x) => x.includes('Phase')), ccHeadRow.join(' | '));
  const ccBackToDefault = await until(
    () => rowIds(cc),
    (r) => r.join(' ') === ccDefaultOrder.join(' '),
    8000,
  );
  check(
    'die Sortierung nach ihr hört auf zu wirken, ohne dass die Tabelle neu geladen wurde (WP-59, TTU-18)',
    ccBackToDefault.join(' ') === ccDefaultOrder.join(' '),
    ccBackToDefault.join(' '),
  );
  check(
    '…und der ⠿ zieht wieder',
    ccTitleBefore === 'Zum Verschieben ziehen' && (await ccHandleTitle()) === ccTitleBefore,
    `${await ccHandleTitle()} (vorher ${ccTitleBefore})`,
  );

  await clickIfThere(cc.getByRole('button', { name: '⚙ Spalten' }).first());
  const ccMgr3 = topDialog(cc);
  await shown(ccMgr3.getByRole('heading', { name: 'Spalten verwalten' }), 8000);
  await clickIfThere(
    ccMgr3.locator('[data-column-row]').filter({ hasText: 'Phase' }).first().locator('button[title="Einblenden"]'),
  );
  const ccShownFlag = await until(
    () => ccOwnCols().then((cols) => cols.find((c) => c.id === ccSel?.id)?.enabled),
    (v) => v === 1,
    8000,
  );
  const ccResorted = await until(() => rowIds(cc), (r) => r.join(' ') === ccConfigured.join(' '), 8000);
  // Showing asks nothing — `toggleEnabled` writes straight through — which is also why the flag
  // above can only be 1 if no confirmation was waiting for a click.
  check(
    'wieder eingeblendet ordnet sie erneut: die Sortierung war ausgesetzt, nicht gelöscht',
    ccShownFlag === 1 && ccResorted.join(' ') === ccConfigured.join(' '),
    `enabled ${ccShownFlag}, ${ccResorted.join(' ')}`,
  );

  // Three types in one burst — the case the per-page map exists to survive (SHL-10): every write
  // persists the whole map, so a toggle computed from the pre-first-toggle value undoes its
  // predecessor. Against localhost the writes settle between two clicks, so the entity PATCH is
  // held back and the burst really is one.
  await cc.route('**/api/projects/*', async (route) => {
    if (route.request().method() === 'PATCH') await sleep(400);
    await route.continue().catch(() => {}); // see the guard above
  });
  for (const name of CC_GLOBALS) {
    await clickIfThere(
      ccMgr3.locator('[data-column-row]').filter({ hasText: name }).first().locator('button[title="Ausblenden"]'),
    );
  }
  const ccMap = await until(
    () => ccProject().then((p) => JSON.parse(p.task_columns ?? 'null')),
    (v) => !!v && Object.keys(v).length === 3,
    12_000,
  );
  await cc.unroute('**/api/projects/*');
  const ccGlobalIds = CC_GLOBALS.map((n) => ccAllCols.find((c) => c.name === n)?.id);
  check(
    'drei Spalten dreier Typen nacheinander ausgeblendet: alle drei stehen in der Karte der Seite (SHL-10)',
    Object.keys(ccMap ?? {}).length === 3 && ccGlobalIds.every((id) => ccMap?.[`custom:${id}`] === false),
    JSON.stringify(ccMap),
  );
  const ccBadges = await ccMgr3
    .locator('[data-column-row]')
    .evaluateAll((els) =>
      els.map((el) => [(el.textContent ?? '').replace(/\s+/g, ' ').trim(), (el.textContent ?? '').includes('abweichend')]),
    );
  check(
    '…und genau diese drei Zeilen tragen „abweichend“',
    ccBadges.filter(([, flagged]) => flagged).length === 3 &&
      CC_GLOBALS.every((n) => ccBadges.some(([text, flagged]) => flagged && text.includes(n))),
    ccBadges.filter(([, f]) => f).map(([t]) => t).join(' | ') || 'keine',
  );
  check(
    '„Auf Saison-Vorgabe zurücksetzen“ wird jetzt angeboten',
    (await ccMgr3.getByRole('button', { name: /Saison-Vorgabe/ }).count()) === 1,
  );
  await cc.keyboard.press('Escape');
  await gone(cc.getByRole('heading', { name: 'Spalten verwalten' }), 5000);
  // The predicate carries everything the assertion below reads, all three names and not just the
  // first: a canary that hid only one of them satisfied a poll keyed on „Bereich" while the other
  // two were still on screen, which is the assertion passing or failing on a coin toss.
  ccHeadRow = await until(
    ccHeads,
    (h) => CC_GLOBALS.every((n) => !h.some((x) => x.includes(n))),
    8000,
  );
  check(
    'die drei Köpfe sind von dieser Seite weg, die vier eigenen stehen weiter da',
    CC_GLOBALS.every((n) => !ccHeadRow.some((h) => h.includes(n))) &&
      CC_NAMES.every((n) => ccHeadRow.some((h) => h.includes(n))),
    ccHeadRow.join(' | '),
  );

  // The other page of the same season: the departure belongs to project 2 and to nothing else —
  // and project 2's own four columns are not there either, which is the scope half (WP-51).
  await cc.goto(`${UI}/#/project/3`);
  await cc.reload();
  await ready(cc);
  const ccNeighbour = await until(
    ccHeads,
    (h) => h.includes('Aufgabe') && CC_GLOBALS.every((n) => h.some((x) => x.includes(n))),
    8000,
  );
  check(
    'die Nachbarseite zeigt alle drei weiterhin — und keine der vier fremden',
    CC_GLOBALS.every((n) => ccNeighbour.some((h) => h.includes(n))) &&
      CC_NAMES.every((n) => !ccNeighbour.some((h) => h.includes(n))),
    ccNeighbour.join(' | '),
  );

  await cc.goto(`${UI}/#/project/2`);
  await cc.reload();
  await ready(cc);
  await clickIfThere(cc.getByRole('button', { name: '⚙ Spalten' }).first());
  const ccMgr4 = topDialog(cc);
  await shown(ccMgr4.getByRole('heading', { name: 'Spalten verwalten' }), 8000);
  await clickIfThere(ccMgr4.getByRole('button', { name: /Saison-Vorgabe/ }));
  const ccReset = await until(() => ccProject().then((p) => p.task_columns), (v) => v === null, 8000);
  check(
    '„Auf Saison-Vorgabe zurücksetzen“ nimmt die ganze Karte zurück, nicht einen Eintrag',
    ccReset === null,
    JSON.stringify(ccReset),
  );
  await cc.keyboard.press('Escape');
  await gone(cc.getByRole('heading', { name: 'Spalten verwalten' }), 5000);
  ccHeadRow = await until(
    ccHeads,
    (h) => CC_GLOBALS.every((n) => h.some((x) => x.includes(n))),
    8000,
  );
  check(
    '…und alle drei Köpfe stehen wieder da',
    CC_GLOBALS.every((n) => ccHeadRow.some((h) => h.includes(n))),
    ccHeadRow.join(' | '),
  );

  console.log(`\n${failures ? `✗ ${failures} Fehler` : '✓ alles ok'} (${checks} Prüfungen)`);
} catch (err) {
  check('run completed', false, err instanceof Error ? err.message : String(err));
  if (stackLog) console.error(`\n--- Stack-Ausgabe (Ende) ---\n${stackLog.slice(-2000)}`);
} finally {
  if (browser) await browser.close();
  // Sweep every fixture season, including leftovers of a killed earlier run.
  const reg = await api('/seasons').catch(() => ({ seasons: [] }));
  for (const s of reg.seasons ?? []) {
    if (s.label?.startsWith(FIXTURE) && s.id !== reg.activeId) {
      await send('DELETE', `/seasons/${s.id}`).catch(() => {});
    }
  }
}

await shutdown(failures === 0 ? 0 : 1);
