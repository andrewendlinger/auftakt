/**
 * Regression guard for the boot gesture — the one surface `npm run check:browser` deliberately
 * cannot reach.
 *
 *   npm run check:boot
 *
 * Three properties make this its own gate rather than a handful of cases over there (issue #115):
 *
 * 1. **The overlay only exists in a built bundle.** `#boot-overlay` in `client/index.html` is
 *    gated on `'%PROD%' !== 'true'`, and the dev server the browser gate drives reads `false`, so
 *    the node is removed before React mounts. This one therefore builds the client and serves it
 *    the way the packaged app does — from the real Express server, on its own port.
 * 2. **Its outcome is measured at runtime.** The frame watchdog decides per launch whether the
 *    gesture survives, so an outcome is not a property of the build. What this gate does about
 *    that is the whole design, below.
 * 3. **`reducedMotion: 'reduce'` removes it outright**, and that escape hatch is what every other
 *    driving script in `docs/VERIFYING.md` — all 621 assertions of `check:browser` among them —
 *    relies on to get past the overlay. A gate for the gesture cannot use it, and case L is here
 *    to make sure nobody breaks it for the others.
 *
 * **What is asserted, in three tiers.**
 *
 * (a) *Invariants*, on every single boot: the legal outcome/why sets, `v: 3`, the clocks in order
 *     and inside `endMs`, `frames` present exactly when the gesture started, `abort:hitch` if and
 *     only if a judged delta reached `HITCH_MS`, `drops <= n` (the WP-61b cap, as arithmetic), the
 *     reveal beating bootBail, the report fitting the cap `electron/appLog.ts` applies to it, and
 *     the two channels — `localStorage` and the `bootSettled` bridge — carrying the same object.
 * (b) *State*: `.boot-show` observed as „svg visible while every clock but the dead man's switch
 *     still sits paused", and the phase-A invariant that a cross which never played shows nothing.
 * (c) *Caused outcomes only*: an outcome is asserted where — and only where — this file injected
 *     the cause (a slot-addressed main-thread block, a delayed asset, a dispatched pointerdown).
 *
 * **Nothing here asserts an uncaused timing.** No bound on `readyMs`, `med` or `p95`; no „must not
 * abort" without an injected reason. A red therefore means the accounting changed, never that the
 * runner was busy.
 *
 * Four bounds do read a clock, and they are listed here because a bound nobody declared is how
 * this discipline rots. Three of them read the *CSS* clock, which is wall time the machine does
 * not move: a played gesture's `endMs − startMs` inside a 300 ms band (measured 2599 ms at full
 * speed against 2613 ms at 20× CPU throttling), the same quantity under 2500 ms for a run that
 * aborted, and `endMs < 7000`, which is the statement that a live reveal beats bootBail's dead
 * man's switch. The fourth is a floor of twenty judged frames on a played gesture: a 2.6 s
 * animation misses it only below about eight frames a second, where nothing else here would hold
 * either. The one genuinely machine-dependent thing — that a cold boot is ready inside the 1200 ms
 * deadline at all — is decided by the *cache* rather than by the machine (83 ms warm against
 * 1574 ms cold-and-throttled, see `docs/VERIFYING.md`), which is why case L2 runs first and leaves
 * the caches warm.
 *
 * **Injected shapes are sized from the cadence the run itself reports**, never absolutely: 50 ms
 * is a tolerated gap at 120 Hz and a `hitch` at 60. And every shape clears its threshold by a
 * computed margin — a shape sitting *on* `drops >= n/4` is flaky by construction, which cost four
 * reds in six runs before it was understood (docs/VERIFYING.md).
 *
 * **What it does not touch.** The animation itself, aesthetics, exact durations, anything that
 * needs the packaged app (the `app-log.jsonl` writer, its fallback lines, the German digest, the
 * one-time rename off the pre-WP-69 `boot-log.jsonl` and the filtering that keeps runtime lines
 * out of a boot summary are `client/src/lib/appLog.test.ts`'s, under `check:unit` — this gate runs
 * no Electron main and asserts against the report object the *page* produces, so none of that is
 * reachable from here), and the open WP-61b question of whether pre-rastering also makes the
 * following frames cheap — that is a trace pair on real hardware, not something a headless browser
 * can answer. This gate asserts the mechanism, never the benefit.
 *
 * It runs on :4327 with a throwaway data dir and needs neither :5317 nor `.demo`, so unlike
 * `check:browser` it can run beside a live `npm run demo`. It does rebuild `client/dist`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createCheck } from './lib/check.mjs';
import { requireFreePorts } from './lib/ports.mjs';
import { group, tailLog } from './lib/server.mjs';
import { waitUntil } from './lib/wait.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 4317 is the dev server; 4319/4321/4323/4325 belong to check-backup/dates/api/browser. Unlike
// the browser gate there is no second port: the built client is served by this very server, which
// is what the packaged app does — `AUFTAKT_CLIENT_DIST` also flips `isPackaged`, dropping the two
// :5317 entries from ALLOWED_ORIGINS, so the origin under test is the production one.
const PORT = 4327;
const BASE = `http://localhost:${PORT}`;

/**
 * The three constants this file computes its injected shapes against.
 *
 * A second copy, deliberately. They belong to `client/index.html`; keeping them here as well means
 * that moving one and not the other is a red (`assertBundle` below), rather than a gate that
 * quietly re-derives its own shapes from the changed value and goes on passing — which is exactly
 * how the `HITCH_MS` 50 → 58 revert would otherwise slip through case E3.
 */
const HITCH_MS = 58;
const WARM_FRAMES = 2;
/** The uniformly-slow test's floor. Case F has to clear it to abort at all — see there. */
const SLOW_MS = 22;

/** Every door the report may name. An unknown one is a report this gate has not been taught. */
const WHYS = new Set([
  'done',
  'deadline',
  'click',
  'app-failed',
  'hold-max',
  'gesture-max',
  'warm',
  'secondary',
  'reduced-motion',
  'no-prod',
  'abort:hitch',
  'abort:slow',
  'abort:drops',
  'abort:starved',
]);

const { check, count, pin } = createCheck();

/**
 * Every assertion a full run makes, exactly — pinned only when nothing failed and nothing stood
 * down, so a machine whose cadence stands E/E2/E3 (or F) down is never a red. The total is
 * quoted in prose that cannot be typechecked; a new case moves this number too, deliberately.
 */
const EXPECTED_CHECKS = 210;

/**
 * A case that could not be exercised, with the evidence for why.
 *
 * There are exactly two reasons and both are measurements, never a guess: a cadence too slow for
 * the shape the case needs, or an injected gap that overshot `HITCH_MS` because the runner added a
 * frame on top of it. Counted and printed twice — as it happens and in the summary — for the same
 * reason `check:browser` counts its reloads: „this run skipped its way to green" must never be
 * readable as „this run was green".
 */
let notExercised = 0;
/** Which cases stood down, so the summary can ask whether anything is left. */
const stoodDown = new Set();
function skipCase(name, why) {
  notExercised++;
  stoodDown.add(name);
  console.log(`  --    ${name} — nicht ausgeführt: ${why}`);
}

/**
 * The cases that carry the drops arithmetic, and the reason there is a floor under standing down.
 *
 * Each of E, E2 and E3 may stand down on measured evidence, and each reason is sound on its own.
 * All three at once is not: on a runner whose median passes ~29 ms the tolerated band stops
 * holding two frame intervals, every one of them declines, and the gate would otherwise report a
 * clean green having asserted nothing whatever about WP-61b — „skipped its way to green", read as
 * „was green", which is the one outcome the counter above exists to prevent. So it is a check
 * rather than a note, and it fails.
 */
const DROPS_CASES = ['E', 'E2', 'E3'];

// ---------------------------------------------------------------------------- the stack

/**
 * Build the client here rather than requiring one.
 *
 * `vite build` is 0.4 s of rolldown; a stale `client/dist` is a silent false green, which is the
 * one failure mode a gate may not have. Announced because it overwrites whatever `npm run build`
 * left there.
 */
function buildClient() {
  console.log('client wird gebaut (überschreibt client/dist) …');
  const t = Date.now();
  // Output captured rather than inherited: a successful build's only message is rolldown's
  // chunk-size advice, which is not this gate's news. A failed one prints everything it had.
  const built = spawnSync('npm', ['--prefix', 'client', 'run', 'build'], {
    cwd: root,
    encoding: 'utf8',
    shell: true,
  });
  if (built.status !== 0) {
    console.error(`FAIL  vite build ist fehlgeschlagen (Code ${built.status})\n${built.stdout}\n${built.stderr}`);
    process.exit(1);
  }
  console.log(`… gebaut in ${Date.now() - t} ms`);
}

const dataDir = mkdtempSync(join(tmpdir(), 'auftakt-boot-'));

/** @type {import('node:child_process').ChildProcess | null} */
let server = null;
/** Last ~8 KB of the server's output, dumped when it fails to come up. */
const serverLog = tailLog(8000);

const { adopt, shutdown } = group({
  graceMs: 3000,
  cleanup: () => {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* a temp dir that outlives the run is not worth failing over */
    }
  },
});

function startServer() {
  server = adopt(
    spawn('npm', ['--prefix', 'server', 'run', 'start'], {
      cwd: root,
      env: {
        ...process.env,
        AUFTAKT_DATA_DIR: dataDir,
        AUFTAKT_PORT: String(PORT),
        // The whole point: with this set the server serves `client/dist` at its own origin, exactly
        // as the packaged app does, and `isPackaged` drops the dev origins from ALLOWED_ORIGINS.
        AUFTAKT_CLIENT_DIST: join(root, 'client', 'dist'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      // Own process group, so the whole tree goes down at once. `shell: true` means the pid held
      // here belongs to the shell, with npm and tsx bound to :4327 underneath it (DBW-10).
      detached: process.platform !== 'win32',
    }),
  );
  serverLog.attach(server);
}

const waitForServer = () =>
  waitUntil(() => fetch(`${BASE}/api/health`).then((r) => r.ok), {
    timeoutMs: 60_000,
    intervalMs: 200,
    dead: () => (server?.exitCode == null ? null : `Server ist beendet (Code ${server.exitCode})\n${serverLog.read()}`),
    onTimeout: () => `Server kam nicht hoch\n${serverLog.read()}`,
  });

/**
 * Believe nothing until the served document is the production overlay.
 *
 * Every case below is vacuous against a bundle whose `%PROD%` never got replaced — the overlay
 * would remove itself before React mounts and each report would read `skip / no-prod`, which is a
 * green-looking nothing. This is the cheap guard against that, and against the two constants the
 * injected shapes are computed from moving underneath this file.
 *
 * @returns {Promise<string>} the served index.html
 */
async function assertBundle() {
  const html = await (await fetch(`${BASE}/`)).text();
  // All three read literals out of the served document, which is fail-closed but assumes Vite goes
  // on leaving an inline `<script>` in index.html alone. If it ever minifies one, all three fail
  // at once and none of the three messages would say why — hence the shared hint.
  const hint = 'kein Treffer — wenn alle drei Zeilen rot sind, minifiziert der Build inzwischen das Inline-Skript';
  check('the served document carries the overlay', html.includes('id="boot-overlay"'), hint);
  check(
    "…and it is a production build ('%PROD%' replaced)",
    html.includes("'true' !== 'true'"),
    html.includes('%PROD%') ? 'unersetzt' : hint,
  );
  check(
    `…and still declares HITCH_MS ${HITCH_MS} / WARM_FRAMES ${WARM_FRAMES} / SLOW_MS ${SLOW_MS}, which this gate's shapes are derived from`,
    html.includes(`var HITCH_MS = ${HITCH_MS};`) &&
      html.includes(`var WARM_FRAMES = ${WARM_FRAMES};`) &&
      html.includes(`var SLOW_MS = ${SLOW_MS};`),
    hint,
  );
  return html;
}

/**
 * The cap the main process applies to a report before it reaches `app-log.jsonl`, read out of
 * `electron/appLog.ts` so the two cannot drift.
 *
 * A renderer report that outgrows this is not a smaller diagnostic, it is *no* diagnostic: main
 * writes `{"outcome":"invalid-report"}` instead. Nothing else in the repository checks that the
 * report the overlay actually produces fits — `check:unit` exercises the writer against fixtures.
 * A regex that stops matching fails the case rather than passing it, which is why it is read here
 * and not defaulted.
 */
function reportCap() {
  const src = readFileSync(join(root, 'electron', 'appLog.ts'), 'utf8');
  const m = /BOOT_REPORT_MAX_CHARS\s*=\s*(\d+)/.exec(src);
  return m ? Number(m[1]) : NaN;
}

// ---------------------------------------------------------------------------- the browser

/**
 * Everything this gate observes from inside the page, installed with `addInitScript` — the only
 * moment early enough, since `data-boot` gets its first value while the document is parsed.
 *
 * Four jobs, all of them recorders rather than drivers except where a case asks for a cause:
 *
 * - the **bridge stub**, which is how the report is captured. `bootSettled` is the channel the
 *   Electron main process reads and `app-log.jsonl` is written from, so recording it is the
 *   faithful route; the `localStorage` copy is read afterwards and compared against it. The stub
 *   is omitted entirely for case M, which is what a plain browser looks like.
 * - the **phase log** (`data-boot`) and the **overlay's class log**, each sampled with the svg's
 *   computed visibility and the play state of every animation — that pair is what makes
 *   `.boot-show` assertable as a state instead of as a timestamp.
 * - **slot-addressable injection**: a `MutationObserver` callback is a microtask, so an observer
 *   registered here runs after the watchdog's own rAF in every frame from `data-boot="play"`
 *   onwards, and blocking inside our rAF callback *k* inflates measured delta *k*, where delta 1
 *   is `warm` (docs/VERIFYING.md).
 * - the two **dispatched pointerdowns**, which are the only way to hit the hold and the show
 *   frames without racing them.
 *
 * `observe(document, { subtree: true })` and not `observe(document.documentElement, …)`: there is
 * no `documentElement` yet when an init script runs, and the throw would take the rest of this
 * function with it — silently, since the overlay would still behave perfectly.
 */
function pageHarness(opts) {
  const w = /** @type {any} */ (window);
  w.__boot = [];
  w.__phase = [];
  w.__marks = [];
  if (opts.bridge) {
    // Only `bootSettled` is a recorder; the rest is what the app touches during a boot, so that
    // the presence of a bridge does not itself change the run under test.
    w.auftakt = {
      bootSettled: (r) => {
        w.__boot.push(r);
        return Promise.resolve();
      },
      getVersion: () => Promise.resolve('0.0.0-test'),
      onBackupConfigChanged: () => () => {},
      platform: 'darwin',
    };
  }
  if (opts.mode === 'throw') {
    // `window.onerror` → `signalFailed()` → `html[data-app-failed]`, which `start()` reads. The
    // listener is on `auftakt:mounted` because that fires before readiness is announced.
    document.addEventListener('auftakt:mounted', () => {
      throw new Error('boom (injected by check:boot)');
    });
  }
  const plan = opts.plan ?? [];
  const obs = new MutationObserver((records) => {
    for (const rec of records) {
      const el = /** @type {any} */ (rec.target);
      if (rec.attributeName === 'data-boot') {
        const phase = document.documentElement.dataset.boot;
        w.__phase.push({ phase, inert: !!(/** @type {any} */ (document.getElementById('root'))?.inert) });
        if (phase === 'hold' && opts.mode === 'hold-click') {
          document.getElementById('boot-overlay')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        }
        if (phase === 'play' && plan.length > 0) {
          const last = plan[plan.length - 1].slot;
          let k = 0;
          const step = () => {
            k++;
            for (const p of plan) {
              if (p.slot !== k) continue;
              const until = performance.now() + p.ms;
              while (performance.now() < until) {
                /* block the main thread, which is what the watchdog measures */
              }
            }
            if (k <= last) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }
      }
      if (rec.attributeName === 'class' && el?.id === 'boot-overlay') {
        const svg = el.querySelector('svg');
        const anims = document.getAnimations();
        w.__marks.push({
          cls: el.className,
          phase: document.documentElement.dataset.boot,
          vis: svg ? getComputedStyle(svg).visibility : 'weg',
          paused: anims.filter((a) => a.playState === 'paused').length,
          running: anims
            .filter((a) => a.playState === 'running')
            .map((a) => /** @type {any} */ (a).animationName ?? '?'),
        });
        if (opts.mode === 'show-click' && el.className.includes('boot-show')) {
          el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        }
      }
    }
  });
  obs.observe(document, { attributes: true, subtree: true, attributeFilter: ['data-boot', 'class'] });
}

/** @type {import('playwright-core').Browser | null} */
let browser = null;
/** @type {import('playwright-core').BrowserContext | null} */
let ctx = null;
/** @type {import('playwright-core').BrowserContext | null} */
let reduceCtx = null;

/**
 * One cold boot, harvested.
 *
 * A fresh page per case rather than a reload, because sessionStorage is per tab: a new page in the
 * same context is a cold start that still shares the context's HTTP and code caches, which is what
 * an installed app's second launch onwards looks like — and what keeps `readyMs` two orders of
 * magnitude clear of the 1200 ms deadline (docs/VERIFYING.md).
 */
async function boot({ plan = [], mode = null, delayMs = 0, reduce = false, bridge = true, noboot = false } = {}) {
  const page = await /** @type {import('playwright-core').BrowserContext} */ (reduce ? reduceCtx : ctx).newPage();
  /** @type {string[]} */
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(pageHarness, { plan, mode, bridge });
  if (delayMs > 0) {
    // The bundle, held back — the only honest way to reach the deadline, the hold's failsafe and a
    // hold long enough to click into. The emoji chunk and the stylesheet do not match this glob.
    await page.route('**/assets/index-*.js', async (route) => {
      await new Promise((r) => setTimeout(r, delayMs));
      await route.continue();
    });
  }
  await page.goto(`${BASE}/${noboot ? '?noboot=1' : ''}`);
  const settled = await page
    .waitForSelector('html[data-boot="done"]', { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  const got = await page.evaluate(() => {
    const w = /** @type {any} */ (window);
    let ls = null;
    try {
      ls = JSON.parse(localStorage.getItem('auftakt-boot-report') ?? 'null');
    } catch {
      ls = 'unparsbar';
    }
    return {
      bridge: w.__boot ?? [],
      phase: w.__phase ?? [],
      marks: w.__marks ?? [],
      ls,
      overlay: !!document.getElementById('boot-overlay'),
      rootInert: !!(/** @type {any} */ (document.getElementById('root'))?.inert),
    };
  });
  await page.close();
  const r = got.bridge[0] ?? got.ls ?? null;
  console.log(
    `  ·     ${r?.outcome ?? '?'}/${r?.why ?? '?'} · bereit ${r?.readyMs} · show ${r?.showMs} · start ${r?.startMs} · ende ${r?.endMs}` +
      (r?.frames
        ? ` · lead ${r.frames.lead} warm ${r.frames.warm}/${r.frames.warm2} · n ${r.frames.n} med ${r.frames.med} p95 ${r.frames.p95} worst ${r.frames.worst} drops ${r.frames.drops}`
        : ''),
  );
  return { settled, errs, ...got, r };
}

/** The `.boot-show` samples that precede `.boot-play` — the two paused, visible frames (WP-61b). */
const showFrames = (g) =>
  g.marks.filter((m) => m.cls.includes('boot-show') && !m.cls.includes('boot-play') && !m.cls.includes('boot-cross'));

const CAP = reportCap();

/**
 * Tier (a): what every boot must satisfy, whatever door it left by.
 *
 * All of it is internal consistency or field discipline — nothing here reads a wall clock except
 * `endMs < 7000`, which is not a timing bound but the statement that a live reveal always beats
 * bootBail's dead man's switch (that delay moved 6000 → 7000 in WP-61b for exactly this reason).
 */
function invariants(tag, g) {
  const r = g.r;
  check(`${tag}: settled, the node is gone and #root is live`, g.settled && !g.overlay && !g.rootInert);
  check(`${tag}: no page error`, g.errs.length === 0, g.errs[0] ?? '');
  check(`${tag}: the report is v:3`, r?.v === 3, `v=${r?.v}`);
  check(`${tag}: the outcome is one of play/cross/skip`, ['play', 'cross', 'skip'].includes(r?.outcome), String(r?.outcome));
  check(`${tag}: the door has a name this gate knows`, WHYS.has(r?.why), String(r?.why));
  const clocks = ['readyMs', 'showMs', 'startMs'].map((k) => r?.[k]).filter((v) => typeof v === 'number');
  check(
    `${tag}: ready → show → start → end, in order and all inside endMs`,
    clocks.every((v, i) => v >= 0 && (i === 0 || v >= clocks[i - 1])) && clocks.every((v) => v <= r?.endMs),
    `${r?.readyMs} / ${r?.showMs} / ${r?.startMs} / ${r?.endMs}`,
  );
  check(
    `${tag}: a gesture that started was shown first (startMs ⇒ showMs)`,
    r?.startMs === null || typeof r?.showMs === 'number',
    `show ${r?.showMs}, start ${r?.startMs}`,
  );
  check(
    `${tag}: frames are recorded exactly when the gesture started`,
    (typeof r?.startMs === 'number') === (r?.frames !== null && r?.frames !== undefined),
    `start ${r?.startMs}, frames ${r?.frames ? 'ja' : 'nein'}`,
  );
  check(`${tag}: the reveal beat bootBail (endMs < 7000)`, r?.endMs < 7000, `${r?.endMs}`);
  const len = JSON.stringify(r ?? null).length;
  check(
    `${tag}: the report fits the cap main applies to it (${CAP})`,
    Number.isFinite(CAP) && len <= CAP,
    Number.isFinite(CAP) ? `${len} Zeichen` : 'BOOT_REPORT_MAX_CHARS nicht gefunden',
  );
  if (r?.frames) {
    const f = r.frames;
    check(
      `${tag}: abort:hitch if and only if a judged delta reached ${HITCH_MS}`,
      (r.why === 'abort:hitch') === (f.worst >= HITCH_MS),
      `why ${r.why}, worst ${f.worst}`,
    );
    check(`${tag}: every late delta was billed once (drops ≤ n)`, f.drops <= f.n, `${f.drops} / ${f.n}`);
    check(
      `${tag}: lead and both exempt head frames are recorded`,
      [f.lead, f.warm, f.warm2].every((v) => typeof v === 'number'),
      `lead ${f.lead}, warm ${f.warm}, warm2 ${f.warm2}`,
    );
  }
  if (g.bridge.length > 0) {
    check(
      `${tag}: the bridge and localStorage carry the same report`,
      JSON.stringify(g.bridge[0]) === JSON.stringify(g.ls),
      JSON.stringify(g.ls)?.slice(0, 120),
    );
  }
}

// ---------------------------------------------------------------------------- the run

/*
 * Refuse to run while anything holds :4327 — before the build, because a run that talks to a
 * stranger's server measures a bundle nobody built here.
 */
await requireFreePorts(
  [PORT],
  (port, host) =>
    `FAIL  Port ${port} ist belegt (${host}) — vermutlich ein übrig gebliebener Server aus einem\n` +
    `      früheren Lauf. Dieser Lauf würde gegen dessen Bundle prüfen.\n` +
    `      Beenden mit:  lsof -ti tcp:${port} | xargs kill`,
);
buildClient();
startServer();
await waitForServer();
console.log(`\nBundle auf ${BASE} (Datenverzeichnis ${dataDir})\n`);

try {
  await assertBundle();
  browser = await chromium.launch();
  ctx = await browser.newContext({ reducedMotion: 'no-preference', viewport: { width: 1400, height: 1000 } });
  // Its own context, because `reducedMotion` is a context property — and contexts do not share a
  // cache, which is why L runs last rather than as the warm-up.
  reduceCtx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1400, height: 1000 } });

  // ---- L2: a secondary window skips — and warms the caches for everything below ----------------
  {
    const g = await boot({ noboot: true });
    check(
      'L2: ?noboot skips the gesture as `secondary`',
      g.r?.outcome === 'skip' && g.r?.why === 'secondary',
      `${g.r?.outcome}/${g.r?.why}`,
    );
    check('L2: …and never holds', g.phase.map((p) => p.phase).join('→') === 'done', g.phase.map((p) => p.phase).join('→'));
    invariants('L2', g);
  }

  // ---- A: a cold boot of the built bundle plays the gesture to its end -------------------------
  const first = await boot();
  invariants('A', first);
  const played = check(
    'A: a cold boot plays the gesture through to `done`',
    first.r?.outcome === 'play' && first.r?.why === 'done',
    `${first.r?.outcome}/${first.r?.why}, bereit ${first.r?.readyMs} ms` +
      (first.r?.why === 'deadline' ? ' — die App war nicht binnen GESTURE_DEADLINE bereit' : ''),
  );
  check(
    'A: the phases walk hold → play → done',
    first.phase.map((p) => p.phase).join('→') === 'hold→play→done',
    first.phase.map((p) => p.phase).join('→'),
  );
  check(
    'A: #root is inert while the overlay holds and free once it is gone',
    first.phase.some((p) => p.phase === 'hold' && p.inert) && first.rootInert === false,
    JSON.stringify(first.phase),
  );
  const span = (first.r?.endMs ?? 0) - (first.r?.startMs ?? 0);
  check(
    'A: the reveal came from the gesture’s own fade, not a failsafe (2500 < endMs − startMs < 2800)',
    played && span > 2500 && span < 2800,
    `${Math.round(span)} ms`,
  );
  check(
    'A: the watchdog judged well past its first window',
    (first.r?.frames?.n ?? 0) > 20,
    `n ${first.r?.frames?.n}, med ${first.r?.frames?.med}`,
  );

  /**
   * The cadence this machine actually delivers, and the two gap sizes derived from it.
   *
   * A block of `b` ms inside an rAF callback produces a delta of `floor(b / med) * med` — the
   * frame it started in is lost and the panel presents the next one on its own grid — so a gap of
   * `k` intervals is asked for as `k * med + 1`. Measured at both cadences this gate has run on:
   * 45 ms gives 41.7 at an 8.3 ms median (five intervals) and 33.3 at 16.7 (two).
   *
   * `STEPS` is the top of the tolerated band: the most intervals that still fit under `HITCH_MS`,
   * which is **three** at 60 Hz and **six** at 120. `GAP_A` asks for exactly that — at 60 Hz it is
   * the customer's 50.1 ms gap — and `GAP_B` for about half, so the pair re-enacts his aborted
   * window (50.1 + 33.3) rather than two equal blocks. That pairing is what makes case E
   * discriminate the WP-61b cap at *both* refresh rates; a lone gap cannot at 60 Hz, where capped
   * and uncapped differ by one lost slot and no bound has room for both that and the runner's own
   * noise. Hardcoded sizes cannot do it either: 45 ms is five intervals at 120 Hz and two at 60.
   *
   * The `med + 0.2` is not decoration either. `med` is reported to one decimal and the true
   * interval jitters under it, so a machine reading 8.2 one run and 8.3 the next flips
   * `floor(57.9 / med)` between **seven** and six — and seven intervals of a real 8.33 ms frame is
   * 58.3, over the bound. That happened: one run in three asked for 58.4 ms, all three drops cases
   * stood down on the overshoot, and the family check below went red for arithmetic. The margin
   * makes the choice stable across the reading's own noise.
   *
   * `STEPS_SAFE` is one interval lower, and it is what case E2 uses. E2 needs its gaps to be
   * *late*, not to sit at the top of the band, so giving it the robust size means an unlucky
   * overshoot in E and E3 can never take the whole drops family — and therefore the run — with it.
   *
   * The constant `HITCH_MS` itself is guarded by `assertBundle`'s declaration line, and that is
   * the guarantee rather than a belt: WP-61 placed 58 at the midpoint *between* two steps a panel
   * can produce, so the top step sits a hair from the value the constant had before it (50.0 at
   * 120 Hz, 50.1 at 60) and whether a revert to 50 makes E and E3 abort is decided in the first
   * decimal. Measured, it does at both cadences — that is a bonus, not something to rely on. The
   * `abort:hitch` invariant is what catches a change to the judge that quotes the constant.
   */
  const med = first.r?.frames?.med ?? 0;
  const STEPS = med > 0 ? Math.floor((HITCH_MS - 0.1) / (med + 0.2)) : 0;
  const STEPS_SAFE = Math.max(2, STEPS - 1);
  const gap = (k) => Math.round(k * med) + 1;
  const GAP_A = gap(STEPS);
  const GAP_B = gap(Math.ceil(STEPS / 2));
  const GAP_SAFE = gap(STEPS_SAFE);
  // Below two intervals a gap cannot be billed as a lost slot at all, so the drops shapes would
  // assert nothing. Stated as the arithmetic rather than as a millisecond threshold, and the cases
  // stand down on it with the number rather than producing a red that means „slow panel".
  const gapsUsable = played && STEPS >= 2;
  console.log(
    `\n  Kadenz: med ${med} ms — die tolerierte Bandbreite fasst ${STEPS} Bilder;` +
      ` Lücken ${GAP_A}/${GAP_B} ms, robuste ${GAP_SAFE} ms\n`,
  );

  /**
   * Did an injected gap land on the far side of `HITCH_MS` after all?
   *
   * The runner adding a frame on top of the block is the one thing that can turn a shape about the
   * drops arithmetic into a shape about the hitch test, and the cases below stand down on it with
   * the measured number rather than reporting a defect. The `abort:hitch` invariant still holds
   * over such a run, so nothing goes unchecked — only the claim that needed a tolerated gap.
   */
  const overshot = (g) => (g.r?.frames?.worst ?? 0) >= HITCH_MS;

  /**
   * Boot a shape, and if the run's own dropped frames put `drops` over the ceiling, boot it once
   * more and believe the second reading.
   *
   * The ceiling is the only assertion here whose subject the runner also contributes to: capped,
   * an injected gap bills one lost slot, and so does every frame the machine happens to drop
   * beside it. A run on this machine measured `drops: 8` against two injected gaps and a ceiling
   * of four — six late frames of its own — which is a red with no defect behind it, and no fixed
   * ceiling separates that from the +5 an uncapped bill would add at 120 Hz.
   *
   * One re-measurement separates them, because the two differ in *reproducibility*: an uncapped
   * sum is over the ceiling every single time, machine noise almost never twice running. Bounded
   * to one retry, announced on its own line as it happens, and the second reading is what the
   * assertion sees — so this can rescue a noisy run but never a defect. It is deliberately not a
   * stand-down: nothing is skipped, the same claim is simply measured again.
   */
  async function bootUnderCeiling(label, opts, ceiling) {
    let g = await boot(opts);
    if (!overshot(g) && (g.r?.frames?.drops ?? 0) > ceiling) {
      console.log(
        `  ⚠     ${label}: drops ${g.r?.frames?.drops} über der Schranke ${ceiling} — der Lauf hatte eigene` +
          ` Aussetzer, wird einmal wiederholt`,
      );
      g = await boot(opts);
    }
    return g;
  }

  // ---- B: `.boot-show` — visible while every clock but the bail still sits at zero -------------
  {
    const g = await boot();
    const s = showFrames(g);
    check('B: .boot-show lands before .boot-play, once', s.length === 1, JSON.stringify(g.marks.map((m) => m.cls)));
    check(
      'B: the svg is visible while the overlay is still holding',
      s[0]?.vis === 'visible' && s[0]?.phase === 'hold',
      JSON.stringify(s[0] ?? null),
    );
    check(
      'B: …and nothing but the dead man’s switch is running',
      s[0]?.paused === 11 && s[0]?.running.join() === 'bootBail',
      `${s[0]?.paused} pausiert, laufend: ${s[0]?.running.join() || 'nichts'}`,
    );
    check(
      'B: the raster is paid between showMs and startMs',
      typeof g.r?.showMs === 'number' && typeof g.r?.startMs === 'number' && g.r.showMs <= g.r.startMs,
      `${g.r?.showMs} → ${g.r?.startMs}`,
    );
  }

  // ---- C / C2: the two exempt head frames (WP-61) ----------------------------------------------
  for (const slot of [2, 1]) {
    const tag = slot === 2 ? 'C' : 'C2';
    const field = slot === 2 ? 'warm2' : 'warm';
    const g = await boot({ plan: [{ slot, ms: 150 }] });
    invariants(tag, g);
    check(
      `${tag}: a 150 ms block in slot ${slot} is recorded as ${field}`,
      (g.r?.frames?.[field] ?? 0) >= 140,
      `${field} ${g.r?.frames?.[field]}`,
    );
    check(
      `${tag}: …and judged by nobody`,
      g.r?.why !== 'abort:hitch' && (g.r?.frames?.worst ?? 999) < HITCH_MS,
      `why ${g.r?.why}, worst ${g.r?.frames?.worst}`,
    );
  }

  // ---- D: past the exemption a real hitch still aborts ------------------------------------------
  {
    const g = await boot({ plan: [{ slot: WARM_FRAMES + 1, ms: 150 }] });
    invariants('D', g);
    check(
      `D: the same 150 ms in slot ${WARM_FRAMES + 1} — the first judged delta — crosses as abort:hitch`,
      g.r?.outcome === 'cross' && g.r?.why === 'abort:hitch',
      `${g.r?.outcome}/${g.r?.why}`,
    );
    check('D: …on the injected delta itself', (g.r?.frames?.worst ?? 0) >= 140, `worst ${g.r?.frames?.worst}`);
  }

  // ---- E: the customer's window, re-enacted (WP-61b) --------------------------------------------
  if (!gapsUsable) skipCase('E', `die tolerierte Bandbreite fasst nur ${STEPS} Bilder (med ${med} ms)`);
  else {
    const g = await bootUnderCeiling(
      'E',
      {
        plan: [
          { slot: 5, ms: GAP_A },
          { slot: 7, ms: GAP_B },
        ],
      },
      4,
    );
    invariants('E', g);
    if (overshot(g)) skipCase('E', `die eingespielte Lücke ist übergelaufen (${g.r?.frames?.worst} ≥ ${HITCH_MS})`);
    else {
      check(
        'E: two tolerated gaps in one window play through to `done`',
        g.r?.outcome === 'play' && g.r?.why === 'done',
        `${g.r?.outcome}/${g.r?.why}, worst ${g.r?.frames?.worst}`,
      );
      // Both bounds are exact arithmetic rather than a product of the *rounded* median: `2 * med`
      // against a `med` reported to one decimal is how this line first went red on a 60 Hz runner,
      // at 33.3 against a bound of 33.4. Below: each injected gap must have been billed as a lost
      // slot at all (the judge saw them), and capped it bills exactly one — two frames of room for
      // a stray late one of the runner's own. Uncapped the pair bills three at 60 Hz and seven at
      // 120, which is what makes this the WP-61b canary at either rate.
      check(
        'E: both gaps were late enough to be billed, and each was billed once',
        (g.r?.frames?.drops ?? 0) >= 2 && (g.r?.frames?.drops ?? 99) <= 4,
        `drops ${g.r?.frames?.drops}, worst ${g.r?.frames?.worst}, med ${g.r?.frames?.med}`,
      );
    }
  }

  // ---- E2: a fourth late frame in the same window still crosses ---------------------------------
  if (!gapsUsable) skipCase('E2', `die tolerierte Bandbreite fasst nur ${STEPS} Bilder (med ${med} ms)`);
  else {
    // `GAP_SAFE`, not `GAP_A`: this case needs four *late* frames, not four frames at the top of
    // the tolerated band, so it takes the size an overshoot cannot reach — which is what keeps the
    // family check below satisfiable when E and E3 stand down.
    const g = await boot({ plan: [5, 7, 9, 11].map((slot) => ({ slot, ms: GAP_SAFE })) });
    invariants('E2', g);
    // Four rather than three: three sits exactly on `drops >= n / 4` at an 8.3 ms median — the
    // window needs `c >= 9.03` clean frames to close and the abort needs `c <= 9` — and was flaky
    // two runs in six. docs/VERIFYING.md carries the arithmetic.
    if (overshot(g)) skipCase('E2', `die eingespielte Lücke ist übergelaufen (${g.r?.frames?.worst} ≥ ${HITCH_MS})`);
    else
      check(
        'E2: four late frames in one window cross anyway (drops or starved)',
        g.r?.outcome === 'cross' && /^abort:(drops|starved)$/.test(g.r?.why),
        `${g.r?.outcome}/${g.r?.why}, drops ${g.r?.frames?.drops}`,
      );
  }

  // ---- E3: the largest gap HITCH_MS still calls noise --------------------------------------------
  if (!gapsUsable) skipCase('E3', `die tolerierte Bandbreite fasst nur ${STEPS} Bilder (med ${med} ms)`);
  else {
    const g = await bootUnderCeiling('E3', { plan: [{ slot: 6, ms: GAP_A }] }, 3);
    invariants('E3', g);
    const worst = g.r?.frames?.worst ?? 0;
    if (overshot(g)) skipCase('E3', `die eingespielte Lücke ist übergelaufen (${worst} ≥ ${HITCH_MS})`);
    else {
      check(
        `E3: a lone ${worst} ms gap inside the tolerated band plays on`,
        g.r?.outcome === 'play' && g.r?.why === 'done',
        `${g.r?.outcome}/${g.r?.why}, worst ${worst}`,
      );
      // Uncapped this one gap alone bills `round(worst/med) - 1` — five at an 8.3 ms median, which
      // is the 120 Hz false abort WP-61b repaired. Capped it bills one; the ceiling leaves two
      // frames of room for a stray late one of the runner's own.
      //
      // The floor is not decoration. Without it the pair „plays to `done`" and „drops ≤ 3" is
      // satisfied by a boot with **no gap in it at all** — so the one case that carries the 120 Hz
      // half of the WP-61b canary would read green if the injection silently stopped running,
      // which is this file's own war story (docs/VERIFYING.md, the init-script observer). E has
      // the same floor for the same reason.
      check(
        'E3: …and is billed once, not per slot it spans',
        (g.r?.frames?.drops ?? 0) >= 1 && (g.r?.frames?.drops ?? 99) <= 3,
        `drops ${g.r?.frames?.drops}, worst ${worst}`,
      );
    }
  }

  // ---- F: cadence that degrades after two clean windows aborts ----------------------------------
  //
  // The last shape here that was ever a hardcoded number, and it inverted its own outcome below
  // ~34 Hz: a flat 30 ms block yields a delta of `floor(30 / med) * med`, which at a 33 ms median
  // is 33 and at a 58 ms one is a `hitch` — so the run left by a door this case rejects, with no
  // injected cause for the difference. Asked for in intervals now, like every other shape.
  //
  // `SLOW_FACTOR_STEPS` is the smallest number of intervals whose product with `med` clears the
  // uniformly-slow test's *floor*: `nominal > max(SLOW_MS, quick * 1.35)`, where `quick` stays near
  // `med` because the first 29 frames are clean, so the 1.35 term is satisfied by any k ≥ 2 and the
  // floor is what decides. Two at 60 Hz (33.4 > 22), three at 120 (24.9 > 22).
  if (!gapsUsable) skipCase('F', `die tolerierte Bandbreite fasst nur ${STEPS} Bilder (med ${med} ms)`);
  else {
    const k = Math.max(2, Math.floor(SLOW_MS / med) + 1);
    if (k > STEPS) skipCase('F', `eine Verlangsamung um ${k} Bilder überschritte HITCH_MS (med ${med} ms)`);
    else {
      // From slot 30, so `quick` has a low tenth percentile behind it before the median flips —
      // uniform slowness from the first frame is the watchdog's documented blind spot, not a defect.
      const block = Math.round(k * med) + 1;
      const g = await boot({ plan: Array.from({ length: 60 }, (_, i) => ({ slot: i + 30, ms: block })) });
      invariants('F', g);
      check(
        'F: a cadence that degrades mid-gesture aborts (slow or drops — the door is not fixed)',
        g.r?.outcome === 'cross' && /^abort:(slow|drops)$/.test(g.r?.why),
        `${g.r?.outcome}/${g.r?.why}, ${k} Bilder à ${med} ms, med ${g.r?.frames?.med}, quick ${g.r?.frames?.quick}`,
      );
      // Against the *gesture's* clock, not the run's: the injection starts at slot 30, whose wall
      // time is `30 * med` and therefore four times longer at 30 Hz than at 120 — a fixed ceiling
      // on `endMs` silently stops meaning anything on a slower runner. `endMs - startMs` is the
      // same quantity case A bounds from below, and it is CSS wall time, which the machine does
      // not move (2599 ms at full speed, 2613 ms at 20× throttling).
      check(
        'F: …and does not reach the gesture’s own fade',
        (g.r?.endMs ?? 9999) - (g.r?.startMs ?? 0) < 2500,
        `${Math.round((g.r?.endMs ?? 0) - (g.r?.startMs ?? 0))} ms nach dem Start`,
      );
    }
  }

  // ---- G: a click during the hold forfeits the gesture and shows nothing -------------------------
  {
    const g = await boot({ mode: 'hold-click', delayMs: 900 });
    invariants('G', g);
    check(
      'G: a pointerdown in the hold crosses as `click`, with the gesture never started',
      g.r?.outcome === 'cross' && g.r?.why === 'click' && g.r?.startMs === null && g.r?.showMs === null,
      `${g.r?.outcome}/${g.r?.why}, show ${g.r?.showMs}, start ${g.r?.startMs}`,
    );
    check(
      'G: the phase-A promise holds — nothing was ever drawn',
      g.marks.every((m) => m.vis !== 'visible'),
      JSON.stringify(g.marks.map((m) => [m.cls, m.vis])),
    );
  }

  // ---- H: a click inside the show frames — the v:3 signature -------------------------------------
  {
    const g = await boot({ mode: 'show-click' });
    invariants('H', g);
    check(
      'H: a cross inside the show frames files showMs with startMs null',
      typeof g.r?.showMs === 'number' && g.r?.startMs === null && g.r?.why === 'click',
      `show ${g.r?.showMs}, start ${g.r?.startMs}, why ${g.r?.why}`,
    );
    check(
      'H: the parked hand does not ride the fade — .boot-show is stripped',
      g.marks.filter((m) => m.cls.includes('boot-cross')).every((m) => m.vis === 'hidden'),
      JSON.stringify(g.marks.map((m) => [m.cls, m.vis])),
    );
  }

  // ---- I: past the deadline the gesture is forfeit ------------------------------------------------
  {
    const g = await boot({ delayMs: 1500 });
    invariants('I', g);
    check(
      'I: readiness past GESTURE_DEADLINE crosses as `deadline`',
      g.r?.outcome === 'cross' && g.r?.why === 'deadline' && (g.r?.readyMs ?? 0) > 1200,
      `${g.r?.outcome}/${g.r?.why}, bereit ${g.r?.readyMs}`,
    );
    check('I: …showing nothing on the way out', g.marks.every((m) => m.vis !== 'visible'));
  }

  // ---- J: the hold has a floor -------------------------------------------------------------------
  {
    const g = await boot({ delayMs: 4200 });
    invariants('J', g);
    check(
      'J: an app that never signals is revealed by hold-max',
      g.r?.why === 'hold-max' && g.r?.outcome === 'cross',
      `${g.r?.outcome}/${g.r?.why}`,
    );
    check(
      'J: …at HOLD_MAX plus its cross-fade, far short of the bail',
      (g.r?.endMs ?? 0) > 3400 && (g.r?.endMs ?? 9999) < 4200,
      `${g.r?.endMs} ms`,
    );
  }

  // ---- K: an app that collapsed reveals without celebrating ---------------------------------------
  {
    const g = await boot({ mode: 'throw' });
    check(
      'K: a throw before readiness crosses as `app-failed`',
      g.r?.outcome === 'cross' && g.r?.why === 'app-failed',
      `${g.r?.outcome}/${g.r?.why}`,
    );
  }

  // ---- M: without a bridge the report still files --------------------------------------------------
  {
    const g = await boot({ bridge: false });
    check('M: a page with no window.auftakt throws nothing', g.errs.length === 0 && g.bridge.length === 0, g.errs[0] ?? '');
    check(
      'M: …and localStorage still carries the report',
      g.ls?.v === 3 && g.ls?.outcome === 'play',
      `${g.ls?.outcome}/${g.ls?.why}`,
    );
  }

  // ---- L: reduced motion removes it outright — the hatch the whole suite depends on ----------------
  {
    const g = await boot({ reduce: true });
    check(
      'L: prefers-reduced-motion skips the gesture outright',
      g.r?.outcome === 'skip' && g.r?.why === 'reduced-motion',
      `${g.r?.outcome}/${g.r?.why}`,
    );
    check(
      'L: …without ever holding, so no driving script waits for a phase',
      g.phase.map((p) => p.phase).join('→') === 'done',
      g.phase.map((p) => p.phase).join('→'),
    );
    check('L: …and #root is never inert', g.phase.every((p) => !p.inert) && !g.rootInert);
    check('L: the overlay node is gone', !g.overlay);
  }

  const anyDrops = DROPS_CASES.some((c) => !stoodDown.has(c));
  check(
    'the drops arithmetic was exercised at all (E, E2 or E3)',
    anyDrops,
    anyDrops ? '' : `alle drei standen ab — med ${med} ms, die tolerierte Bandbreite fasst ${STEPS} Bilder`,
  );

  if (count.failures === 0 && notExercised === 0) pin(EXPECTED_CHECKS);

  console.log(
    `\n${count.failures ? `✗ ${count.failures} Fehler` : '✓ alles ok'} (${count.checks} Prüfungen)` +
      (notExercised ? ` — ${notExercised}× nicht ausgeführt (siehe -- oben)` : ''),
  );
} catch (err) {
  check('run completed', false, err instanceof Error ? err.message : String(err));
  if (serverLog.read()) console.error(`\n--- Server-Ausgabe (Ende) ---\n${serverLog.read().slice(-2000)}`);
} finally {
  if (browser) await browser.close();
}

await shutdown(count.failures === 0 ? 0 : 1);
