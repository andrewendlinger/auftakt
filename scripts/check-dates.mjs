/**
 * Regression guard for the date/timestamp convention: every stored timestamp and every date
 * window is naive local time. A standalone script, a sibling of `check-backup.mjs`, and the only
 * automated cover the convention has.
 *
 * **Standalone by decision, not by default.** This file used to open „there is no test framework
 * in this repo"; that has been false since 2026-08-06, when going commercial reversed it („No
 * test framework — REVERSED", `docs/DECISIONS.md`). That reversal added Vitest over the pure
 * modules and a committed browser gate, and left these scripts „exactly as they are". This one
 * in particular is unportable by construction: it proves itself by re-running the *whole* server
 * under two `TZ` values 25 hours apart, which is a process boundary, not a test case.
 *
 * It is worth having because `npm run typecheck` cannot see a single thing it catches. One
 * `toISOString()` or one bare `date('now')` silently reports the wrong calendar day between
 * local midnight and the UTC offset, and everything downstream (archive, „Erledigt am" in the
 * .xlsx export, backup folder names, the purge countdown) inherits it.
 *
 * No clock mocking needed. The run repeats under TZ=Pacific/Kiritimati (UTC+14) and
 * TZ=Pacific/Midway (UTC-11), 25 hours apart — at any instant at least one of them sits on a
 * different calendar day than UTC, so a UTC-anchored stamp or window is guaranteed to fail.
 * A zone that happens to share the UTC day reports itself as a weak run and proves nothing.
 *
 *   npm run check:dates                     # both zones
 *   node scripts/check-dates.mjs <TZ>       # one zone (child mode, also usable directly)
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createCheck, MARKERS } from './lib/check.mjs';
import { request } from './lib/http.mjs';
import { requireFreePorts } from './lib/ports.mjs';
import { tailLog } from './lib/server.mjs';
import { waitUntil } from './lib/wait.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ZONES = ['Pacific/Kiritimati', 'Pacific/Midway'];
const PORT = 4321; // not 4317/4319: never collide with a dev server or check:backup

/* ---------- parent: run the child once per zone ---------- */

if (!process.env.TZ_CHECK_CHILD) {
  const zones = process.argv[2] ? [process.argv[2]] : ZONES;
  let failed = false;
  for (const tz of zones) {
    console.log(`\n════ TZ=${tz} ════`);
    const r = spawnSync(process.execPath, [process.argv[1], tz], {
      stdio: 'inherit',
      env: { ...process.env, TZ: tz, TZ_CHECK_CHILD: '1' },
    });
    if (r.status !== 0) failed = true;
  }
  console.log(failed ? '\n✗ FEHLGESCHLAGEN' : '\n✓ alles ok');
  process.exit(failed ? 1 : 0);
}

/* ---------- child ---------- */

const require = createRequire(join(REPO, 'server/package.json'));
const Database = require('better-sqlite3');

const { check, count } = createCheck(MARKERS.narrow);

const pad = (n, w = 2) => String(n).padStart(w, '0');
const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
const dayOffset = (n) => localDay(new Date(Date.now() + n * 86400000));
const SPACE_STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

console.log(`  (local day ${localDay()}, UTC day ${utcDay()} — ${localDay() === utcDay() ? 'SAME, weak run' : 'different, the off-by-one window'})`);

/* ---------- 1. the shared helper ---------- */

// shared/time.ts is TypeScript, so read its output through tsx the way the server runs it.
const helper = (() => {
  const out = spawnSync(
    join(REPO, 'server/node_modules/.bin/tsx'),
    ['-e', `import {localStamp,fileStamp,localDay} from '${join(REPO, 'shared/time.ts')}';
            const a = fileStamp();
            const t0 = Date.now(); while (Date.now() - t0 < 2) {}   // same second, later millisecond
            console.log(JSON.stringify({a, b: fileStamp(), s: localStamp(), d: localDay()}));`],
    { encoding: 'utf8', env: process.env, cwd: join(REPO, 'server') },
  );
  // The **last** line, because tsx may print a warning before the payload. A run that printed
  // nothing at all is the helper having failed to start; the old `|| '{}'` swallow let the first
  // assertion print a „FAIL" naming the wrong culprit before the next line threw a bare
  // TypeError. Stop with the reason instead.
  const lines = (out.stdout ?? '').trim().split('\n');
  const payload = lines[lines.length - 1];
  if (!payload) throw new Error(`tsx gab nichts aus (Status ${out.status})\n${out.stderr ?? ''}`);
  return JSON.parse(payload);
})();

check('localStamp() is the SQLite space format', SPACE_STAMP.test(helper.s), helper.s);
check('localStamp() lands on the local calendar day', helper.s.slice(0, 10) === localDay(), `${helper.s.slice(0, 10)} vs ${localDay()}`);
check('localDay() is the local calendar day', helper.d === localDay());
const f1 = helper.a;
const f2 = helper.b;
check('fileStamp() is filesystem-safe, local, with ms', /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-\d{3}$/.test(f1), f1);
check('fileStamp() starts on the local day', f1.slice(0, 10) === localDay(), `${f1.slice(0, 10)} vs ${localDay()}`);
// 2 ms apart: identical at whole-second resolution, distinct with milliseconds. (Whether the
// pair happens to straddle a second boundary is incidental — the ms field is what must differ.)
check('two fileStamp() calls 2 ms apart differ (DBW-09)', f1 !== f2, `${f1} / ${f2}`);

/* ---------- 2. the migration, without a server ---------- */

{
  const dir = mkdtempSync(join(tmpdir(), 'auftakt-tz-mig-'));
  const script = `
    process.env.AUFTAKT_DATA_DIR = ${JSON.stringify(dir)};
    const { getDb, closeDb, getSetting, snapshotDb, createSeason, copySeasonData, activateSeason } =
      await import('${join(REPO, 'server/src/db.ts')}');
    let db = getDb();
    const fresh = getSetting(db, 'stamps_localtime');
    db.prepare("INSERT INTO tasks (title, status, created_at, updated_at, erledigt_am, deleted_at) VALUES ('t','new','2026-03-04 23:30:00','2026-03-04 23:30:00','2026-03-04T23:30:00.000Z','2026-03-04 23:30:00')").run();
    db.prepare("DELETE FROM settings WHERE key = 'stamps_localtime'").run();  // pretend it predates FIX-06
    closeDb();
    db = getDb();
    const once = db.prepare('SELECT created_at, updated_at, deleted_at, erledigt_am FROM tasks').get();
    closeDb();
    db = getDb();
    const twice = db.prepare('SELECT created_at FROM tasks').get();
    const marker = getSetting(db, 'stamps_localtime');
    // a copied season must not be converted a second time
    closeDb();
    const s = createSeason('Zweite');
    copySeasonData(s.id, 1, { artists: true, contacts: false, events: false, projects: false, tasks: true, columns: true, settings: false });
    activateSeason(s.id);
    const copiedMarker = getSetting(getDb(), 'stamps_localtime');
    const snap = ${JSON.stringify(join(dir, 'snap.db'))};
    snapshotDb(${JSON.stringify(join(dir, 'season-2.db'))}, snap);
    closeDb();
    console.log('@@' + JSON.stringify({ fresh, once, twice, marker, copiedMarker, snap }));
  `;
  // A .mts file, not `tsx -e`: the inline form compiles to CJS and rejects top-level await.
  const scriptPath = join(dir, 'mig.mts');
  writeFileSync(scriptPath, script);
  const out = spawnSync(join(REPO, 'server/node_modules/.bin/tsx'), [scriptPath], { encoding: 'utf8', env: process.env, cwd: join(REPO, 'server') });
  const line = (out.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) {
    check('migration harness ran', false, (out.stderr || out.stdout || '').slice(-400));
  } else {
    const r = JSON.parse(line.slice(2));
    const expected = localStampOf('2026-03-04T23:30:00Z');
    check('a fresh database is marked, not converted', r.fresh === '1');
    check('legacy created_at shifts to local', r.once.created_at === expected, `${r.once.created_at} (erwartet ${expected})`);
    check('legacy deleted_at shifts to local', r.once.deleted_at === expected);
    check("legacy ISO-'T' erledigt_am is normalised to space format", r.once.erledigt_am === expected, r.once.erledigt_am);
    check('a second open shifts nothing (idempotent)', r.twice.created_at === r.once.created_at, `${r.once.created_at} → ${r.twice.created_at}`);
    check('the marker is set after converting', r.marker === '1');
    check('a copied season is already marked (no double shift)', r.copiedMarker === '1');
    const snapMarker = existsSync(r.snap)
      ? new Database(r.snap, { readonly: true }).prepare("SELECT value FROM settings WHERE key = 'stamps_localtime'").get()?.value
      : null;
    check('the marker survives VACUUM INTO (backup/export)', snapMarker === '1', String(snapMarker));
  }
  rmSync(dir, { recursive: true, force: true });
}

/** What a UTC instant must become once converted to this machine's local wall clock. */
function localStampOf(iso) {
  const d = new Date(iso);
  return `${localDay(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/* ---------- 2b. copying out of a season that was never migrated ---------- */

// `erledigt_am` is the one stamp column COPY_COLS carries. Copy it out of a season that has
// never been active — so never ran the conversion — and it lands in a target createSeason has
// already marked `stamps_localtime = '1'`, where the migration will never look at it again.
// A permanently 2h-wrong „erledigt am", with nothing left to repair it.
{
  const dir = mkdtempSync(join(tmpdir(), 'auftakt-tz-copy-'));
  const script = `
    process.env.AUFTAKT_DATA_DIR = ${JSON.stringify(dir)};
    const { getDb, closeDb, createSeason, copySeasonData, activateSeason } =
      await import('${join(REPO, 'server/src/db.ts')}');
    const db = getDb();
    db.prepare("INSERT INTO tasks (title, status, erledigt_am) VALUES ('t','done','2026-03-04 23:30:00')").run();
    db.prepare("DELETE FROM settings WHERE key = 'stamps_localtime'").run();  // never migrated
    closeDb();                                                                // and never re-opened
    const s = createSeason('Zweite');
    copySeasonData(s.id, 1, { artists: false, contacts: false, events: false, projects: false, tasks: true, columns: true, settings: false });
    activateSeason(s.id);
    const copied = getDb().prepare('SELECT erledigt_am FROM tasks').get();
    closeDb();
    console.log('@@' + JSON.stringify({ copied }));
  `;
  const scriptPath = join(dir, 'copy.mts');
  writeFileSync(scriptPath, script);
  const out = spawnSync(join(REPO, 'server/node_modules/.bin/tsx'), [scriptPath], { encoding: 'utf8', env: process.env, cwd: join(REPO, 'server') });
  const line = (out.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) {
    check('copy-from-unmigrated harness ran', false, (out.stderr || out.stdout || '').slice(-400));
  } else {
    const r = JSON.parse(line.slice(2));
    const expected = localStampOf('2026-03-04T23:30:00Z');
    check(
      'erledigt_am copied out of an unmigrated season is converted',
      r.copied.erledigt_am === expected,
      `${r.copied.erledigt_am} (erwartet ${expected})`,
    );
  }
  rmSync(dir, { recursive: true, force: true });
}

/* ---------- 3. the live API ---------- */

const dataDir = mkdtempSync(join(tmpdir(), 'auftakt-tz-api-'));
/**
 * Refuse to run when something already holds the port — same guard, same reasoning as
 * `check-backup.mjs`: a leaked server from an earlier run answers happily against its own
 * (long-deleted) data dir, and the failures that follow read as product bugs.
 */
await requireFreePorts(
  [PORT],
  (port) =>
    `Port ${port} ist belegt — vermutlich ein übrig gebliebener Server aus einem ` +
    `früheren Lauf. Beenden mit:  lsof -ti tcp:${port} | xargs kill`,
  { hosts: ['127.0.0.1'] },
);

const server = spawn(join(REPO, 'server/node_modules/.bin/tsx'), [join(REPO, 'server/src/index.ts')], {
  env: { ...process.env, AUFTAKT_DATA_DIR: dataDir, AUFTAKT_PORT: String(PORT) },
  cwd: join(REPO, 'server'),
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverLog = tailLog();
serverLog.attach(server);

try {
  await waitUntil(() => fetch(`http://localhost:${PORT}/api/health`).then((r) => r.ok), {
    timeoutMs: 20_000,
    intervalMs: 150,
    onTimeout: () => `Server-Start Zeitüberschreitung\n${serverLog.read().slice(-600)}`,
  });

  /**
   * `Response.json()` is typed `Promise<unknown>` and every assertion below reads a field off the
   * result; narrowing each would mean restating the API's response shape inside the script whose
   * job is to catch the server disagreeing with it.
   * @returns {Promise<any>}
   */
  const api = async (method, path, body) => {
    const r = await request(`http://localhost:${PORT}/api${path}`, { method, body, empty: null });
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };

  // the editable "done" value, read the way the server does
  const cols = await api('GET', '/custom-columns');
  const status = cols.find((c) => c.key === 'status');
  const doneValue = JSON.parse(status.options).find((o) => o.done)?.value;

  const artist = await api('POST', '/artists', { name: 'TZ-Test' });
  check('created_at is stamped on the local day', artist.created_at.slice(0, 10) === localDay(), artist.created_at);
  check('created_at is the space format', SPACE_STAMP.test(artist.created_at), artist.created_at);

  const patched = await api('PATCH', `/artists/${artist.id}`, { notes: 'x' });
  check('updated_at is stamped on the local day (CCL-05)', patched.updated_at.slice(0, 10) === localDay(), patched.updated_at);

  // erledigt_am (SDL-07) — and the export renders exactly this slice
  const task = await api('POST', '/tasks', { title: 'TZ-Aufgabe', artist_id: artist.id });
  const done = await api('PATCH', `/tasks/${task.id}`, { status: doneValue });
  check('erledigt_am is the space format (SRV-08/SDB-07)', SPACE_STAMP.test(done.erledigt_am), done.erledigt_am);
  check('erledigt_am lands on the local calendar day (SDL-07)', done.erledigt_am.slice(0, 10) === localDay(), done.erledigt_am);
  check('the .xlsx "Erledigt am" slice agrees', done.erledigt_am.slice(0, 10) === localDay());

  // the dashboard's upcoming list (SDL-10)
  //
  // The 14-day split moved to the client (client/src/lib/eventGroups.ts, covered by check:unit), so
  // the server computes no offset here any more and the +14/+15 edge is no longer its property.
  // What it still owns is the *today* edge — „from today onwards, running multi-day events
  // included" — and that is exactly the comparison a bare date('now') gets wrong, in both
  // directions: Kiritimati (UTC+14) would let „gestern" in, Midway (UTC-11) would drop „heute".
  const mk = (title, start_at, /** @type {string | null} */ end_at = null) =>
    api('POST', '/events', { artist_id: artist.id, type: 'Auftritt', title, start_at, end_at, all_day: 1 });
  await mk('heute', dayOffset(0));
  await mk('gestern', dayOffset(-1));
  await mk('laeuft', dayOffset(-2), dayOffset(2));
  await mk('vorbei', dayOffset(-3), dayOffset(-1));
  await mk('spaet', dayOffset(400));
  // „Datum offen" carries no date and therefore no all_day either (lib/eventTime.ts).
  await api('POST', '/events', { artist_id: artist.id, type: 'Auftritt', title: 'offen', start_at: null, all_day: 0 });
  const dash = await api('GET', '/dashboard');
  const titles = dash.upcoming.map((e) => e.title);
  check('the list includes an event starting today (SDL-10)', titles.includes('heute'), titles.join(', '));
  check('the list excludes yesterday (SDL-10)', !titles.includes('gestern'), titles.join(', '));
  check('a multi-day event running across today stays in (SDL-10)', titles.includes('laeuft'), titles.join(', '));
  check('a multi-day event that ended yesterday is gone', !titles.includes('vorbei'), titles.join(', '));
  check('„Datum offen" is listed, and first', titles[0] === 'offen', titles.join(', '));
  check('nothing is capped — an event 400 days out is listed', titles.includes('spaet'), titles.join(', '));

  // deleted_at + the purge countdown (PGS-12)
  await api('DELETE', `/tasks/${task.id}`);
  const trash = await api('GET', '/deleted');
  const row = trash.find((i) => i.type === 'task' && i.id === task.id);
  check('deleted_at is stamped on the local day', row.deleted_at.slice(0, 10) === localDay(), row.deleted_at);
  // exactly what the client's daysUntil() does: whole calendar days, both sides naive local
  const asDay = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const daysLeft = Math.round((asDay(row.purge_at) - asDay(localDay())) / 86400000);
  check('the purge countdown is 30 days, not 29 (PGS-12)', daysLeft === 30, `${daysLeft} (purge_at ${row.purge_at})`);

  // backup folder names (ELP-09/DBW-09)
  // Created here rather than left to the run: since WP-65 a backup refuses a configured folder
  // that does not exist instead of recreating it, because that is how a renamed or unplugged one
  // was silently replaced by an empty one. The picker only ever hands over a folder that exists,
  // so creating it is what makes this harness match the product's caller.
  const backupDir = join(dataDir, 'backups');
  mkdirSync(backupDir, { recursive: true });
  const b1 = await api('POST', '/backup', { dir: backupDir });
  const b2 = await api('POST', '/backup', { dir: backupDir });
  const name = b1.dir.split('/').pop();
  check('the backup folder is named on the local day (ELP-09)', name.startsWith(`auftakt-${localDay()}`), name);
  check('two backups in a row are two folders (DBW-09)', b1.dir !== b2.dir, `${b1.dir} / ${b2.dir}`);
} catch (err) {
  check('API run', false, String(err));
  if (serverLog.read()) console.log(serverLog.read().slice(-800));
} finally {
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(count.failures === 0 ? '  → alles ok' : `  → ${count.failures} Fehler`);
process.exit(count.failures === 0 ? 0 : 1);
