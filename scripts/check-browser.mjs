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
  // The commit is asynchronous — the reader comes back only once the write resolved, so waiting
  // for it is what makes the API read below meaningful.
  await d.locator('.prose-md').first().waitFor({ timeout: 8000 });
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
  check(
    '…und die Übergabe wartet darauf, statt einen Namen zu raten',
    (await u.locator('.fixed.inset-0').count()) === 1 && !(await topDialog(u).getByRole('button', { name: 'Weiter' }).isEnabled()),
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

  await topDialog(u).getByRole('button', { name: 'Fertig' }).click();
  check('der Hinweis nennt die Datei beim Namen', await shown(toast(u, new RegExp(file2))));
  await u.close();

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
