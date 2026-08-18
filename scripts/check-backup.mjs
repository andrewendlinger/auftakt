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
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'server', 'package.json'));
const Database = require('better-sqlite3');

const PORT = 4319; // not 4317: never collide with a dev server the user has running
const api = (p) => `http://localhost:${PORT}/api/${p}`;

/**
 * Refuse to run when something already holds :4319.
 *
 * Without this the script happily talks to whatever answers there — typically a leaked `tsx
 * watch` supervisor from an earlier run or another session, still pointing at a long-deleted
 * temp data dir. The run then fails at the second-season fixture with `no such table: artists`,
 * which reads as a product bug and is not one. Fail here instead, naming the real problem.
 */
async function requireFreePort() {
  const probe = createServer();
  try {
    await /** @type {Promise<void>} */ (
      new Promise((res, rej) => {
        probe.once('error', rej);
        probe.listen(PORT, '127.0.0.1', () => res());
      })
    );
  } catch (err) {
    if (err?.code !== 'EADDRINUSE') throw err;
    console.error(
      `FAIL  Port ${PORT} ist belegt — vermutlich ein übrig gebliebener Server aus einem\n` +
        `      früheren Lauf. Dieser Lauf würde gegen dessen (gelöschtes) Datenverzeichnis\n` +
        `      prüfen und mit „no such table“ scheitern.\n` +
        `      Beenden mit:  lsof -ti tcp:${PORT} | xargs kill`,
    );
    process.exit(1);
  }
  await new Promise((res) => probe.close(res));
}

await requireFreePort();

const dataDir = mkdtempSync(join(tmpdir(), 'auftakt-check-'));
const workDir = mkdtempSync(join(tmpdir(), 'auftakt-work-'));
const backupDir = join(workDir, 'backups');
mkdirSync(backupDir, { recursive: true });

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

/**
 * `Response.json()` is typed `Promise<unknown>` and every assertion below reads a field off the
 * result; narrowing each would mean restating the API's response shape inside the script whose
 * job is to catch the server disagreeing with it.
 * @returns {Promise<{ status: number, body: any }>}
 */
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
  // Own process group, so killServer() can signal the whole tree at once. Windows has no
  // groups — it gets the taskkill branch instead, and `detached` there opens a console window.
  detached: process.platform !== 'win32',
});

/**
 * Stop the server AND everything it spawned. `shell: true` means the pid we hold belongs to
 * the shell, with npm and the tsx/node process actually bound to :4319 underneath it, so
 * server.kill() only ever signalled the top of that chain and left reaping the rest to
 * whatever the shell and npm happen to forward — nothing on Windows, where kill() cannot
 * reach a grandchild at all. A survivor makes the next run either talk to a stale server
 * pointing at this run's deleted temp dir, or wait out 30s of EADDRINUSE and fail with
 * "Server kam nicht hoch" though nothing is broken (DBW-10).
 */
function killServer() {
  if (!server.pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      process.kill(-server.pid, 'SIGTERM'); // negative pid = the whole process group
    }
  } catch {
    /* already gone */
  }
}

let cleanedUp = false;
/** Last-ditch cleanup for the 'exit' handler, where nothing may be awaited. */
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  killServer();
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
  killServer();
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
function rows(path, table, where = '') {
  const db = new Database(path, { readonly: true });
  try {
    return db.prepare(`SELECT COUNT(*) AS n FROM ${table}${where ? ` WHERE ${where}` : ''}`).get().n;
  } finally {
    db.close();
  }
}

await waitForServer();
console.log('\nBackup & Import\n');

// --- fixtures: two seasons, both with data, the active one written via the API ---
await post('backup/dir', { dir: backupDir });
await post('artists', { name: 'Aktive Saison Künstlerin' });
const second = (await post('seasons', { label: 'Zweite Saison' })).body;
{
  const db = new Database(join(dataDir, second.file));
  db.prepare('INSERT INTO artists (name) VALUES (?)').run('Zweite Saison Künstler');
  db.close();
}

// A hand-installed announcement (WP-63). It lives in `seasons.json` and nowhere else — no route
// writes it, which is exactly why its survival has to be asserted here: there is no season
// database to carry it, and „ride along in backups automatically" is the reason the registry was
// chosen over the settings table in the first place. Written directly, the way the real one is.
{
  const reg = JSON.parse(readFileSync(join(dataDir, 'seasons.json'), 'utf8'));
  reg.announcements = [{ id: 'testfest', title: 'Testfest', body: 'Eine Zeile.', date: '03-14' }];
  reg.announcementsSeen = { version: '0.0.1', ids: { testfest: '2027-03-14' } };
  writeFileSync(join(dataDir, 'seasons.json'), JSON.stringify(reg, null, 2));
}

// --- [1a] a backup covers every season, and the copies are not empty ---
const backup = await post('backup', { dir: backupDir });
const point = backup.body.dir;
check('backup writes a dated restore point', existsSync(point ?? ''), point);
check('restore point holds seasons.json', existsSync(join(point, 'seasons.json')));

const seasons = /** @type {any} */ (await (await fetch(api('seasons'))).json()).seasons;
check('restore point holds every season', seasons.every((s) => existsSync(join(point, s.file))), `${seasons.length} Saisons`);
for (const s of seasons) {
  const n = rows(join(point, s.file), 'artists');
  check(`  ${s.file} contains rows (WAL captured)`, n > 0, `${n} artists`);
}

// The registry copy has to be the registry, not just a file of the right name: restoring is a
// hand copy over the data directory, so anything living only in `seasons.json` — the landing
// content, the season terms, and since WP-63 the announcements and what has already been seen —
// is only as safe as this copy.
{
  const copied = JSON.parse(readFileSync(join(point, 'seasons.json'), 'utf8'));
  check(
    'the copied registry carries the announcements',
    copied.announcements?.[0]?.id === 'testfest',
    JSON.stringify(copied.announcements),
  );
  check(
    '…and what has already been seen, so a restore does not replay it',
    copied.announcementsSeen?.ids?.testfest === '2027-03-14' && copied.announcementsSeen?.version === '0.0.1',
    JSON.stringify(copied.announcementsSeen),
  );
}

// --- [1c] the folder explains itself: sub-folders, README, MANIFEST (WP-41) ---
// The customer's complaint was that the backup folder is unreadable, so these two files and
// the sub-folder split are the deliverable, not decoration. The CRLF/BOM assertions are the
// load-bearing part: the folder sits on a Windows machine in Google Drive, and without them
// Notepad shows one endless line of mojibake — which is the state this package fixes.
check(
  'restore points live under backups/',
  (point ?? '').startsWith(join(backupDir, 'backups') + sep),
  point,
);

/**
 * Read a file the app wrote for the customer, asserting the Windows encoding it needs.
 * The existence check comes before the read: a missing file must be a red line in this list,
 * not an ENOENT stack that takes the remaining assertions down with it.
 */
function windowsDoc(name, path) {
  if (!existsSync(path)) {
    check(`${name} exists`, false, path);
    return '';
  }
  const raw = readFileSync(path);
  check(`${name} exists`, raw.length > 0, path);
  check(`  ${name} starts with a UTF-8 BOM`, raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf);
  const text = raw.toString('utf8');
  check(`  ${name} uses CRLF line endings`, text.includes('\r\n') && !/[^\r]\n/.test(text));
  check(`  ${name} survived the umlauts`, text.includes('ä') || text.includes('ö') || text.includes('ü'));
  return text;
}

const readme = windowsDoc('README.txt', join(backupDir, 'README.txt'));
check('README explains the restore (data dir + the -wal trap)', /%APPDATA%/.test(readme) && /-wal/.test(readme));
check('README does not mention flat backups it has none of', !readme.includes('auftakt-<Zeitstempel>.db'));
// Since WP-68 step 5 names the data directory outright instead of describing where it usually
// lives. It is the one line the reader has to act on with no app in front of him, and a wrong
// path there sends him somewhere real and empty. Only *this* machine's rendering is reachable
// from here — the other platform's is covered by client/src/lib/backupDocs.test.ts.
check('README names this machine’s data directory', readme.includes(dataDir), dataDir);

const manifest = windowsDoc('MANIFEST.txt', join(point, 'MANIFEST.txt'));
// The whole point of the manifest: the season NAME, which the file names cannot carry.
// Compared as strings, not as a built regex: a label may legally contain ( + [ * , which would
// either throw and abort the run or silently loosen the assertion.
for (const s of seasons) {
  const line = manifest.split('\r\n').find((l) => l.includes(s.file));
  check(`  MANIFEST names ${s.file} → „${s.label}“`, (line ?? '').includes(`=  ${s.label}`), line);
}
check('MANIFEST names the app version', /App-Version: \S+/.test(manifest));

// --- [1d] a vanished backup folder is refused, not silently recreated (WP-65) ---
// runBackup opened with mkdirSync(target, { recursive: true }), i.e. mkdir -p, so a folder the
// user had renamed, moved or left on an unplugged drive came back empty with a fresh README and
// one restore point in it. The run succeeded, nothing threw, and the startup backup's error
// dialog was therefore never reached: the customer kept backing up somewhere other than where his
// older restore points were. Reported from the macOS pass as „es kam nie eine Warnung".
{
  const ghostRoot = join(workDir, 'weg');
  const ghost = join(ghostRoot, 'auftakt-backups');
  const missing = await post('backup', { dir: ghost });
  check('a vanished backup folder is refused', missing.status >= 400, `${missing.status} ${missing.body.error ?? ''}`);
  check('the refusal names the folder', (missing.body.error ?? '').includes(ghost), missing.body.error);
  check('a vanished backup folder is NOT recreated (the old bug)', !existsSync(ghostRoot), ghostRoot);

  // The trap this must not spring: the folder picker runs with `createDirectory`, so the very
  // first backup goes into a folder that was created seconds ago and is empty — no README, no
  // backups/ below it. Checking anything but the *configured* folder would refuse that.
  const fresh = join(workDir, 'frisch-gewaehlt');
  mkdirSync(fresh);
  const first = await post('backup', { dir: fresh });
  check(
    'a first backup into a brand-new empty folder still runs',
    first.status === 200 && existsSync(first.body.dir ?? ''),
    first.body.error ?? first.body.dir,
  );

  // A file where the folder is expected: mkdir -p fails there anyway, but with a raw EEXIST the
  // user is left to decode. The message names the cause instead.
  const notADir = join(workDir, 'kein-ordner');
  writeFileSync(notADir, 'not a folder');
  const refused = await post('backup', { dir: notADir });
  check(
    'a file in place of the backup folder is refused',
    refused.status >= 400 && /Datei/.test(refused.body.error ?? ''),
    `${refused.status} ${refused.body.error ?? ''}`,
  );
}

// --- [1b] the backup folder is season-independent (WP-39) ---
// It used to live in the active season's settings table, so switching season left an empty
// backup_dir behind: no backup, and — where an older build had already marked first_run_done
// on that season — no prompt and no error either. That is how a real installation ran for two
// days with backups silently off. Switching must change nothing about the folder.
{
  await post('backup/prompted'); // what Electron does once the first-run prompt was answered
  await post(`seasons/${second.id}/activate`);
  const status = /** @type {any} */ (await (await fetch(api('backup/status'))).json());
  check('a season switch keeps the backup folder', status.backupDir === backupDir, status.backupDir);
  check('a season switch keeps the prompt answered', status.prompted === true);
  const fromOtherSeason = await post('backup', {}); // no dir in the body: the server must find it
  check(
    'a backup still runs from the other season',
    fromOtherSeason.status === 200 && existsSync(fromOtherSeason.body.dir ?? ''),
    fromOtherSeason.body.error ?? fromOtherSeason.body.dir,
  );
  await post('seasons/1/activate');
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
  // One long-expired soft-deleted row — the item a user imports an old backup to recover.
  // Marked rather than added, so the 2000-row count below still holds.
  db.prepare(`UPDATE artists SET deleted_at = datetime('now', 'localtime', '-60 days') WHERE name = ?`).run(
    'Importiert 0',
  );
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
  'pre-import backup lands under pre-import/ in the backup folder',
  (imported.body.backup ?? '').startsWith(join(backupDir, 'pre-import') + sep),
  imported.body.backup,
);

// --- [2c] the first request after an import must not purge the imported trash ---
// getDb() sweeps a season's expired soft-deleted rows on its first request-context open
// (PR50-07) and the import evicts the pooled handle, so the very next request re-opened the
// freshly imported file and hard-deleted its 60-day-old trash — the very rows a user imports
// an old backup to recover, gone before the Papierkorb could list them. skipPurgeOnOpen
// disarms exactly that one open; the season purges normally again from the next one.
await fetch(api('artists')); // the first request-context open of the imported file
check(
  'an import survives the first request with its trash intact',
  rows(activePath, 'artists', 'deleted_at IS NOT NULL') === 1,
  `${rows(activePath, 'artists', 'deleted_at IS NOT NULL')} im Papierkorb`,
);

// --- [2b] a failing copy must not destroy the live database (DBW-04) ---
// The import used to copy the picked file straight over the season file, so a copy that
// died halfway (ENOSPC/EIO/EACCES) left a truncated database behind while the user was
// told "die bisherige Datenbank wurde nicht verändert". A read-only data dir is the
// cheapest way to make the staged copy fail at exactly that point.
if (process.platform === 'win32' || process.getuid?.() === 0) {
  console.log('  ..   failing-copy case skipped (needs POSIX permissions as a non-root user)');
} else {
  // The import above replaced the active season with a database carrying its own (empty)
  // settings. Before WP-39 that wiped backup_dir and the pre-import snapshot had nowhere to
  // go, so this case had to restore it first; the folder lives in the registry now, which an
  // import does not touch. Assert that rather than re-setting it — and it doubles as the
  // request that leaves the server holding an open connection before the chmod.
  const survived = /** @type {any} */ (await (await fetch(api('backup/status'))).json()).backupDir;
  check('an import leaves the backup folder configured', survived === backupDir, survived);
  // Same reasoning one key over (WP-63): an import replaces a season database and never the
  // registry, so the announcement state has to be exactly where it was — otherwise importing a
  // backup would replay every announcement the user has already dismissed.
  const feed = /** @type {any} */ (await (await fetch(api('announcements'))).json());
  check('an import leaves the announcement state alone', feed.version === '0.0.1', String(feed.version));
  const intact = rows(activePath, 'artists');
  chmodSync(dataDir, 0o500);
  let failed;
  try {
    failed = await post('backup/import', { path: incoming });
  } finally {
    chmodSync(dataDir, 0o700);
  }
  check('a failing copy reports an error', failed.status === 400, failed.body.error);
  const after = rows(activePath, 'artists');
  check('a failing copy leaves the database intact', after === intact, `${after} artists`);
  check('a failing copy leaves no staged file behind', !existsSync(`${activePath}.import-tmp`));
  try {
    const db = new Database(activePath);
    const integrity = db.pragma('integrity_check')[0].integrity_check;
    db.close();
    check('database still reopens after a failing import', integrity === 'ok', integrity);
  } catch (err) {
    check('database still reopens after a failing import', false, err.message);
  }
}

// --- [2d] an import must not resurrect a vanished backup folder (WP-65) ---
// The other door into the same silence. The pre-import safety copy goes to
// <backupDir>/pre-import/… through the same mkdir -p, so an import recreated the folder the
// startup backup had just refused — and the import is exactly what a user reaches for after
// that warning. From the next launch backups would run into the resurrected empty folder again,
// with the new warning satisfied and the real restore points still under the old name. The copy
// falls back to the data dir instead: the rescue survives, nothing is recreated.
{
  const ghost = join(workDir, 'weg-beim-import');
  mkdirSync(ghost);
  await post('backup/dir', { dir: ghost }); // configured while it existed…
  rmSync(ghost, { recursive: true, force: true }); // …and renamed away while the app was closed
  const rescued = await post('backup/import', { path: incoming });
  check('an import still runs with the backup folder gone', rescued.status === 200, rescued.body.error ?? '');
  check('…and does not recreate it (the old bug)', !existsSync(ghost), ghost);
  check(
    '…while the safety copy lands beside the database',
    (rescued.body.backup ?? '').startsWith(`${activePath}.pre-import-`) && rescued.body.backup.endsWith('.bak'),
    rescued.body.backup,
  );
  check(
    '…and holds the data it is supposed to rescue',
    existsSync(rescued.body.backup ?? '') && rows(rescued.body.backup, 'artists') > 0,
    existsSync(rescued.body.backup ?? '') ? `${rows(rescued.body.backup, 'artists')} artists` : 'fehlt',
  );
  await post('backup/dir', { dir: backupDir }); // back to the real folder for what follows
}

// --- pruning keeps the newest KEEP restore points and drops the oldest, and the old flat
//     layout is migrated into the sub-folders on the way (WP-41) ---
// The fixtures are written at the TOP level on purpose: that is the shape every installation
// from before WP-41 has, so this doubles as the migration test. What must come out is one pool
// of 30 per kind, in the sub-folder — not 30 in each of two places, and not an untouched pile
// at the old level that nothing writes to and pruning can therefore never shrink.
const folders = (prefix, dir = backupDir) =>
  existsSync(dir)
    ? readdirSync(dir).filter((f) => f.startsWith(`${prefix}-`) && statSync(join(dir, f)).isDirectory())
    : [];
const points = () => folders('auftakt', join(backupDir, 'backups'));
for (let d = 1; d <= 33; d++) mkdirSync(join(backupDir, `auftakt-2020-01-${String(d).padStart(2, '0')}-00-00-00`));
// Pre-import snapshots were never pruned at all, so the folder grew with every import (DBW-12).
for (let d = 1; d <= 33; d++) mkdirSync(join(backupDir, `pre-import-2020-01-${String(d).padStart(2, '0')}-00-00-00`));
// The newest fixture survives the 30-cap, so it is the one whose contents must come along.
writeFileSync(join(backupDir, 'auftakt-2020-01-33-00-00-00', 'seasons.json'), '{"seasons":[]}');
const legacy = join(backupDir, 'auftakt-2019-01-01-00-00-00.db');
await import('node:fs').then((fs) => fs.writeFileSync(legacy, 'legacy flat backup'));

// The customer renamed „Saison" in Einstellungen, so the two files he reads when his data is
// gone must not be the last place still calling it that (WP-68). Renamed before this run
// because the README is rewritten on every one.
await fetch(api('seasons/terms'), {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ season: 'Festival', seasonPlural: 'Festivals' }),
});

const renamedRun = await post('backup', { dir: backupDir });
{
  const renamed = readFileSync(join(backupDir, 'README.txt'), 'utf8');
  check(
    'the README uses the word the user picked for a season',
    renamed.includes('je Festival') && !/Saison/.test(renamed),
    renamed.match(/.*Saison.*/)?.[0],
  );
  const renamedManifest = readFileSync(join(renamedRun.body.dir, 'MANIFEST.txt'), 'utf8');
  check(
    '…and so does the MANIFEST',
    renamedManifest.includes('Diese Festivals sind gesichert:'),
    renamedManifest.split('\r\n')[4],
  );
}

const preImport = folders('pre-import', join(backupDir, 'pre-import'));
check('pruning caps pre-import snapshots at 30', preImport.length === 30, `${preImport.length} übrig`);
check('pruning drops the oldest pre-import snapshot first', !preImport.includes('pre-import-2020-01-01-00-00-00'));
const kept = points();
check('pruning caps restore points at 30', kept.length === 30, `${kept.length} übrig`);
check('pruning drops the oldest first', !kept.includes('auftakt-2020-01-01-00-00-00'));
check('pruning keeps the newest', kept.includes(kept.slice().sort().reverse()[0]));
check('legacy flat backups are left alone', existsSync(legacy));
check(
  'the old top level keeps no dated folders',
  folders('auftakt').length === 0 && folders('pre-import').length === 0,
  readdirSync(backupDir).join(', '),
);
check(
  'a migrated restore point arrives with its contents',
  existsSync(join(backupDir, 'backups', 'auftakt-2020-01-33-00-00-00', 'seasons.json')),
);
// The README is regenerated on every run, and now there IS a flat backup to explain.
check(
  'the README explains the flat backups once they exist',
  readFileSync(join(backupDir, 'README.txt'), 'utf8').includes('auftakt-<Zeitstempel>.db'),
);

/* ---------- the WP-39 adoption migration, without a server ---------- */

/**
 * Run a snippet against `server/src/db.ts` in its own data dir, the way check-dates.mjs drives
 * the stamp migration. No server: the adoption is a pure registry/database operation, and the
 * states worth testing are ones only an *older* build could produce.
 *
 * A .mts file, not `tsx -e`: the inline form compiles to CJS and rejects top-level await.
 */
function runAgainstDb(body) {
  const dir = mkdtempSync(join(tmpdir(), 'auftakt-adopt-'));
  const scriptPath = join(dir, 'adopt.mts');
  const importPath = join(root, 'server/src/db.ts');
  writeFileSync(
    scriptPath,
    `process.env.AUFTAKT_DATA_DIR = ${JSON.stringify(dir)};\n` +
      `const db = await import(${JSON.stringify(importPath)});\n` +
      `const { getDb, closeDb, setSetting, createSeason, activateSeason, adoptLegacyBackupConfig, getBackupConfig, setBackupDir } = db;\n` +
      `${body}\n`,
  );
  const out = spawnSync(join(root, 'server/node_modules/.bin/tsx'), [scriptPath], {
    encoding: 'utf8',
    env: process.env,
    cwd: join(root, 'server'),
  });
  const line = (out.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  rmSync(dir, { recursive: true, force: true });
  return line ? JSON.parse(line.slice(2)) : { harnessError: (out.stderr || out.stdout || '').slice(-400) };
}

// The exact state a real installation was found in: the folder was set while season 1 was
// active, then a second season became active carrying first_run_done from a pre-ELP-05 build.
// No folder, no prompt, no error — and no backup since.
{
  const r = runAgainstDb(`
    setSetting(getDb(), 'backup_dir', '/tmp/kunden-backups');
    closeDb();
    const s = createSeason('Allgemein');
    activateSeason(s.id);
    setSetting(getDb(), 'first_run_done', '1');   // pre-ELP-05: marked without a folder saved
    closeDb();
    const broken = getBackupConfig();
    adoptLegacyBackupConfig();
    const repaired = getBackupConfig();
    setBackupDir('/tmp/spaeter-geaendert');       // a later user choice must survive
    adoptLegacyBackupConfig();
    const stable = getBackupConfig();
    console.log('@@' + JSON.stringify({ broken, repaired, stable }));
  `);
  if (r.harnessError) {
    check('adoption harness ran', false, r.harnessError);
  } else {
    check('before adoption the folder is invisible', r.broken.dir === '', r.broken.dir);
    check(
      'adoption lifts the folder out of the inactive season',
      r.repaired.dir === '/tmp/kunden-backups',
      r.repaired.dir,
    );
    check('adoption marks the prompt as answered', r.repaired.prompted === true);
    check('adoption does not re-run over a later choice', r.stable.dir === '/tmp/spaeter-geaendert', r.stable.dir);
  }
}

// The other half of the same bug: prompted, but no folder in any season. Carrying that flag
// over would leave the prompt dead forever, so it is re-derived from what was actually adopted.
{
  const r = runAgainstDb(`
    setSetting(getDb(), 'first_run_done', '1');   // marked, but nothing was ever saved
    closeDb();
    adoptLegacyBackupConfig();
    console.log('@@' + JSON.stringify({ cfg: getBackupConfig() }));
  `);
  if (r.harnessError) {
    check('dead-prompt harness ran', false, r.harnessError);
  } else {
    check('a prompt marked without a folder is reset', r.cfg.prompted === false && r.cfg.dir === '', JSON.stringify(r.cfg));
  }
}

console.log(`\n${failures === 0 ? 'alles ok' : `${failures} fehlgeschlagen`}\n`);
await shutdown(failures === 0 ? 0 : 1);
