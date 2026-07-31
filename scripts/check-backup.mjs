/**
 * Regression guard for the backup/import path (WP-D). There is no test framework in
 * this repo, so this is a standalone script: it boots the real server against a
 * throwaway data dir and drives the /api/backup endpoints over HTTP.
 *
 * It covers the parts that can be checked without a GUI. The Electron half —
 * dialogs, relaunch, the Windows crash — stays in docs/BACKUP-TESTING.md.
 *
 *   npm run check:backup
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'server', 'package.json'));
const Database = require('better-sqlite3');

const PORT = 4319; // not 4317: never collide with a dev server the user has running
const api = (p) => `http://localhost:${PORT}/api/${p}`;

const dataDir = mkdtempSync(join(tmpdir(), 'auftakt-check-'));
const workDir = mkdtempSync(join(tmpdir(), 'auftakt-work-'));
const backupDir = join(workDir, 'backups');
mkdirSync(backupDir, { recursive: true });

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function post(path, body) {
  const r = await fetch(api(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const server = spawn('npm', ['--prefix', 'server', 'run', 'dev'], {
  cwd: root,
  env: { ...process.env, AUFTAKT_DATA_DIR: dataDir, AUFTAKT_PORT: String(PORT) },
  stdio: 'ignore',
  shell: true,
});

let cleanedUp = false;
/** Last-ditch cleanup for the 'exit' handler, where nothing may be awaited. */
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
}
process.on('exit', cleanup);

/**
 * Stop the server, wait for it to actually be gone, then drop the temp dirs. The order matters
 * when a request is still in flight: the server re-creates its data dir on the next registry
 * write (saveRegistry mkdirs it), so removing the dir first leaves it behind.
 */
async function shutdown(code) {
  server.kill();
  await Promise.race([once(server, 'exit'), new Promise((r) => setTimeout(r, 2000))]);
  cleanup();
  process.exit(code);
}

// The run stays alive for seconds (dozens of awaited round-trips and 250ms polls), so Ctrl-C
// during it is normal. Without a listener Node terminates via the default signal action and
// never emits 'exit', so cleanup() never ran: the server kept :4319 and both temp dirs stayed
// behind, once per interrupted run (DBW-11).
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void shutdown(130);
  });
}

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(api('health'))).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Server kam nicht hoch');
}

/** Count rows in a snapshot on disk — the whole point is that copies are not empty. */
function rows(path, table) {
  const db = new Database(path, { readonly: true });
  try {
    return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  } finally {
    db.close();
  }
}

await waitForServer();
console.log('\nBackup & Import\n');

// --- fixtures: two seasons, both with data, the active one written via the API ---
await fetch(api('settings'), {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ backup_dir: backupDir }),
});
await post('artists', { name: 'Aktive Saison Künstlerin' });
const second = (await post('seasons', { label: 'Zweite Saison' })).body;
{
  const db = new Database(join(dataDir, second.file));
  db.prepare('INSERT INTO artists (name) VALUES (?)').run('Zweite Saison Künstler');
  db.close();
}

// --- [1a] a backup covers every season, and the copies are not empty ---
const backup = await post('backup', { dir: backupDir });
const point = backup.body.dir;
check('backup writes a dated restore point', existsSync(point ?? ''), point);
check('restore point holds seasons.json', existsSync(join(point, 'seasons.json')));

const seasons = (await (await fetch(api('seasons'))).json()).seasons;
check('restore point holds every season', seasons.every((s) => existsSync(join(point, s.file))), `${seasons.length} Saisons`);
for (const s of seasons) {
  const n = rows(join(point, s.file), 'artists');
  check(`  ${s.file} contains rows (WAL captured)`, n > 0, `${n} artists`);
}

// --- import validation: nothing is destroyed by a bad file ---
const junk = join(workDir, 'not-a-db.db');
mkdirSync(dirname(junk), { recursive: true });
await import('node:fs').then((fs) => fs.writeFileSync(junk, 'this is not sqlite'));
const junkCheck = await post('backup/import/check', { path: junk });
check('a non-SQLite file is rejected', junkCheck.body.ok === false, junkCheck.body.error);

const foreign = join(workDir, 'foreign.db');
{
  const db = new Database(foreign);
  db.exec('CREATE TABLE something_else (id INTEGER PRIMARY KEY)');
  db.close();
}
const foreignCheck = await post('backup/import/check', { path: foreign });
check('a non-Auftakt SQLite file is rejected', foreignCheck.body.ok === false, foreignCheck.body.error);

const before = rows(join(dataDir, seasons.find((s) => s.id === 1).file), 'artists');
const rejected = await post('backup/import', { path: foreign });
check('rejected import returns an error', rejected.status === 400, rejected.body.error);
check(
  'rejected import leaves the database untouched',
  rows(join(dataDir, seasons.find((s) => s.id === 1).file), 'artists') === before,
);

// --- [2a] a real import replaces the data instead of corrupting it ---
// Built larger than the live DB on purpose: that is the shape that used to leave a
// stale WAL replaying over the imported file → "database disk image is malformed".
const incoming = join(workDir, 'incoming.db');
{
  const db = new Database(incoming);
  // sqlite_sequence is maintained by SQLite itself and cannot be created by hand.
  const schema = new Database(join(dataDir, seasons[0].file), { readonly: true })
    .prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.sql)
    .join(';\n');
  db.exec(schema);
  const ins = db.prepare('INSERT INTO artists (name, notes) VALUES (?, ?)');
  for (let i = 0; i < 2000; i++) ins.run(`Importiert ${i}`, 'x'.repeat(300));
  db.close();
}

const imported = await post('backup/import', { path: incoming });
check('import succeeds', imported.status === 200, imported.body.error ?? '');
check('pre-import backup was written', existsSync(imported.body.backup ?? ''), imported.body.backup);
check(
  'pre-import backup is NOT empty (the old bug)',
  existsSync(imported.body.backup) && rows(imported.body.backup, 'artists') === before,
  existsSync(imported.body.backup ?? '') ? `${rows(imported.body.backup, 'artists')} artists` : 'fehlt',
);

const activePath = join(dataDir, seasons.find((s) => s.id === 1).file);
check('no stale -wal survives the import', !existsSync(`${activePath}-wal`));
check('no stale -shm survives the import', !existsSync(`${activePath}-shm`));

// The decisive one: reopen exactly as getDb() would on the next launch.
try {
  const db = new Database(activePath);
  const integrity = db.pragma('integrity_check')[0].integrity_check;
  const n = db.prepare('SELECT COUNT(*) AS n FROM artists').get().n;
  db.close();
  check('reopens cleanly after import', integrity === 'ok', integrity);
  check('reopened database holds the IMPORTED rows', n === 2000, `${n} artists`);
} catch (err) {
  check('reopens cleanly after import', false, err.message);
}

check(
  'pre-import backup lands in the backup folder',
  (imported.body.backup ?? '').startsWith(backupDir),
  imported.body.backup,
);

// --- pruning keeps the newest KEEP restore points and drops the oldest ---
const points = () =>
  readdirSync(backupDir).filter((f) => /^auftakt-/.test(f) && statSync(join(backupDir, f)).isDirectory());
for (let d = 1; d <= 33; d++) mkdirSync(join(backupDir, `auftakt-2020-01-${String(d).padStart(2, '0')}-00-00-00`));
const legacy = join(backupDir, 'auftakt-2019-01-01-00-00-00.db');
await import('node:fs').then((fs) => fs.writeFileSync(legacy, 'legacy flat backup'));

await post('backup', { dir: backupDir });
const kept = points();
check('pruning caps restore points at 30', kept.length === 30, `${kept.length} übrig`);
check('pruning drops the oldest first', !kept.includes('auftakt-2020-01-01-00-00-00'));
check('pruning keeps the newest', kept.includes(kept.slice().sort().reverse()[0]));
check('legacy flat backups are left alone', existsSync(legacy));

console.log(`\n${failures === 0 ? 'alles ok' : `${failures} fehlgeschlagen`}\n`);
await shutdown(failures === 0 ? 0 : 1);
