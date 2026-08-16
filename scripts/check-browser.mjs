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
 * editor).
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
 * Refuse to run while anything holds either port.
 *
 * Not politeness: the stack below rebuilds `.demo` from nothing, so starting beside a running
 * `npm run demo` would leave that session's server answering from a deleted inode — the trap
 * `docs/VERIFYING.md` records as costing a full verification run.
 */
async function requireFreePorts() {
  for (const port of [PORT, 5317]) {
    const probe = createServer();
    try {
      await /** @type {Promise<void>} */ (
        new Promise((res, rej) => {
          probe.once('error', rej);
          probe.listen(port, '127.0.0.1', () => res());
        })
      );
    } catch (err) {
      if (err?.code !== 'EADDRINUSE') throw err;
      console.error(
        `FAIL  Port ${port} ist belegt — vermutlich ein laufendes \`npm run demo\` oder ein\n` +
          `      übrig gebliebener Server. Dieser Lauf würde dessen Datenbank neu aufbauen.\n` +
          `      Beenden mit:  lsof -ti tcp:4325 -ti tcp:5317 | xargs kill\n` +
          `      (das -i muss wiederholt werden — macOS' lsof liest das zweite tcp: sonst als Datei)`,
      );
      process.exit(1);
    }
    await new Promise((res) => probe.close(res));
  }
}

/**
 * The stack is `scripts/demo.mjs`, not a hand-rolled spawn pair: it already rebuilds `.demo`
 * before starting, already runs the two dev servers in their own process group and already
 * reaps that group. `AUFTAKT_PORT` reaches both halves — the server binds it and Vite proxies
 * `/api` to it (client/vite.config.ts) — and `server/src/demo.ts` pins `AUFTAKT_DATA_DIR` to
 * `<repo>/.demo` itself and refuses an inherited one, so this cannot touch `.data/`.
 */
const stack = spawn(process.execPath, [join(root, 'scripts', 'demo.mjs')], {
  cwd: root,
  env: { ...process.env, AUFTAKT_PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: process.platform !== 'win32',
});

/** Last ~8 KB of the stack's output, dumped when it fails to come up or a case explodes. */
let stackLog = '';
for (const s of [stack.stdout, stack.stderr]) {
  s.setEncoding('utf8');
  s.on('data', (chunk) => {
    stackLog = (stackLog + chunk).slice(-8000);
  });
}

function killStack() {
  if (!stack.pid) return;
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
  await Promise.race([once(stack, 'exit'), new Promise((r) => setTimeout(r, 3000))]);
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

/** Both halves have to answer: the API on :4325 and Vite on :5317. */
async function waitForStack() {
  const deadline = Date.now() + 120_000;
  let apiUp = false;
  while (Date.now() < deadline) {
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

/**
 * `reducedMotion: 'reduce'` is the documented escape hatch: it removes the boot overlay
 * outright (DECISIONS.md) instead of racing its phases. The overlay does not exist on the dev
 * server anyway, but row animations do.
 */
async function launch() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    reducedMotion: 'reduce',
    viewport: { width: 1400, height: 1000 },
  });
  return { browser, context };
}

/** Interactive, not `networkidle` — which lies when a query 500s or hangs. */
const ready = (page, timeout = 20_000) =>
  page.waitForSelector('html[data-app-ready]', { timeout }).then(() => page);

/** `#/dashboard` is Übersicht; bare `#/` is the season landing page — different screens. */
async function open(context, hashPath = '/dashboard') {
  const page = await context.newPage();
  page.on('pageerror', (e) => check(`no page error (${hashPath})`, false, e.message));
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

/** Toasts stack and hold 6 s, so filter by the text under test — never `.first()`, never a sleep. */
const toast = (page, re) => page.locator('.pointer-events-auto').filter({ hasText: re });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `staleTime: 5_000` — a focus inside five seconds of the last fetch legitimately refetches nothing. */
const STALE_MS = 5_000;

// ---------------------------------------------------------------------------- the run

await requireFreePorts();
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

try {
  const { browser: chrome, context } = await launch();
  browser = chrome;

  const data = await makeSeason('Daten', true);

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
  // Every Modal is a `.fixed.inset-0` and the topmost is the last of them. Scoping to it is not
  // tidiness: the task table's row 🗑 carries `title="Löschen"` too, so page-wide button
  // selectors are ambiguous on any page that has tasks on it — which is this one.
  const dialog = d.locator('.fixed.inset-0').last();
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
