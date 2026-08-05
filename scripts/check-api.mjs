/**
 * Regression guard for the server's data invariants. There is no test framework in this repo,
 * so this is a standalone script — a sibling of `check-backup.mjs` and `check-dates.mjs`: it
 * boots the real server against a throwaway data dir and drives the API over HTTP.
 *
 * Everything asserted here is a *server* invariant, deliberately. They do not move when the UI
 * changes, they are all reachable without a browser, and each one is something the 2026-07
 * review found broken at least once — the class of defect `npm run typecheck` cannot see.
 *
 *   npm run check:api
 *
 * The purge cases need a restart (the sweep runs at startup), so the script boots the server
 * twice around a direct sqlite backdating step. That is also why it spawns `tsx` on index.ts
 * rather than `npm run dev`: `tsx watch` leaves a supervisor behind that would answer the
 * second boot's health check from the first run's process.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(REPO, 'server', 'package.json'));
const Database = require('better-sqlite3');

const PORT = 4323; // not 4317/4319/4321: dev server, check:backup and check:dates own those
const API = `http://localhost:${PORT}/api`;

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

/**
 * Refuse to run when something already holds the port — same guard and same reasoning as
 * `check-backup.mjs`: a leaked server from an earlier run answers against its own (deleted)
 * data dir, and every failure that follows reads as a product bug.
 */
async function requireFreePort() {
  const probe = createServer();
  try {
    await new Promise((res, rej) => {
      probe.once('error', rej);
      probe.listen(PORT, '127.0.0.1', res);
    });
  } catch (err) {
    if (err?.code !== 'EADDRINUSE') throw err;
    console.error(
      `FAIL  Port ${PORT} ist belegt — vermutlich ein übrig gebliebener Server aus einem\n` +
        `      früheren Lauf. Beenden mit:  lsof -ti tcp:${PORT} | xargs kill`,
    );
    process.exit(1);
  }
  await new Promise((res) => probe.close(res));
}

await requireFreePort();

const dataDir = mkdtempSync(join(tmpdir(), 'auftakt-check-api-'));

let server = null;
let serverLog = '';

function startServer() {
  serverLog = '';
  server = spawn(join(REPO, 'server/node_modules/.bin/tsx'), [join(REPO, 'server/src/index.ts')], {
    env: { ...process.env, AUFTAKT_DATA_DIR: dataDir, AUFTAKT_PORT: String(PORT) },
    cwd: join(REPO, 'server'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (b) => (serverLog += b));
  server.stderr.on('data', (b) => (serverLog += b));
  return waitForServer();
}

async function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    try {
      if ((await fetch(`${API}/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Server-Start Zeitüberschreitung\n${serverLog.slice(-600)}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function stopServer() {
  if (!server) return;
  const dead = new Promise((res) => server.once('exit', res));
  server.kill();
  await dead;
  server = null;
}

/** Raw request: returns status and parsed body, and never throws on a non-2xx. */
async function req(method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

/** …and the same, asserting success, for fixture setup where a failure is not the point. */
async function ok(method, path, body) {
  const r = await req(method, path, body);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

const seasonFile = (name) => join(dataDir, name);

/** Carried across the stop/start boundary, where the purge and the on-disk checks run. */
let copyTarget = null;
let projectCopyTarget = null;
let purge = {};
let deepTree = [];

function cleanup() {
  rmSync(dataDir, { recursive: true, force: true });
}
process.on('exit', cleanup);

try {
  await startServer();

  // ------------------------------------------------------------------ writable allowlist
  // A column absent from `writable` is dropped without a word — 200, no error, value gone
  // (CCL-24). That silence is the whole hazard, so assert the drop rather than an error.
  console.log('\n== writable allowlist (CCL-24)');
  {
    const a = await ok('POST', '/artists', {
      name: 'Allowlist',
      deleted_at: '2020-01-01 00:00:00',
      created_at: '1999-01-01 00:00:00',
      id: 9999,
    });
    check('an unlisted deleted_at is dropped on create', a.deleted_at === null, String(a.deleted_at));
    check('an unlisted created_at is dropped on create', !a.created_at.startsWith('1999'), a.created_at);
    check('an unlisted id is dropped on create', a.id !== 9999, String(a.id));

    const before = (await ok('GET', `/artists/${a.id}`)).created_at;
    const patched = await ok('PATCH', `/artists/${a.id}`, { name: 'Allowlist 2', created_at: '1999-01-01 00:00:00' });
    check('an unlisted created_at is dropped on patch', patched.created_at === before, patched.created_at);
    check('the listed column on the same payload still writes', patched.name === 'Allowlist 2', patched.name);
  }

  // ------------------------------------------------------------------ per-entity layout (WP-25)
  // The positive counterpart of the section above: `layout` *is* on both allowlists, is stored as
  // JSON text via `jsonColumns`, and reads back unparsed — the client's `parseEntityLayout` is
  // written against that. `null` has to survive as SQL NULL, because NULL is the "never arranged"
  // sentinel a page falls back to its artist_layout/project_layout template on.
  console.log('\n== an entity carries its own layout (WP-25)');
  {
    const entries = [{ key: 'termine', width: 'half' }, { key: 'aufgaben', width: 'full' }];
    const owner = await ok('POST', '/artists', { name: 'Anordnung' });
    for (const [path, create] of [
      ['/artists', { name: 'Anordnung Künstler' }],
      ['/projects', { name: 'Anordnung Projekt', code: 'L1', artist_id: owner.id }],
    ]) {
      const row = await ok('POST', path, create);
      check(`a fresh ${path} row has no layout`, row.layout === null, String(row.layout));

      const set = await ok('PATCH', `${path}/${row.id}`, { layout: entries });
      check(`${path}: an array layout is stored as JSON text`, set.layout === JSON.stringify(entries), String(set.layout));

      const read = await ok('GET', `${path}/${row.id}`);
      check(`${path}: the layout reads back unparsed`, read.layout === JSON.stringify(entries), String(read.layout));

      const cleared = await ok('PATCH', `${path}/${row.id}`, { layout: null });
      check(`${path}: null clears it back to the template`, cleared.layout === null, String(cleared.layout));
    }
  }

  // ------------------------------------------------------------------ colour validation (CCL-12)
  // Keyed off `writable.includes('color')` in the factory, so this covers every table at once.
  console.log('\n== colours are validated on write (CCL-12)');
  {
    const bad = await req('POST', '/artists', { name: 'Farbe', color: 'rot' });
    check('a non-hex colour is refused on create', bad.status === 400, String(bad.status));
    check('…with a German message', /Hex-Wert/.test(bad.body?.error ?? ''), bad.body?.error);

    const a = await ok('POST', '/artists', { name: 'Farbe', color: '#4f46e5' });
    check('a #rrggbb colour is accepted', a.color === '#4f46e5', a.color);

    const short = await req('PATCH', `/artists/${a.id}`, { color: '#abc' });
    check('a #rgb shorthand is accepted (hexToRgb expands it)', short.status === 200, String(short.status));

    const cleared = await ok('PATCH', `/artists/${a.id}`, { color: '' });
    check('an empty colour still clears', cleared.color === '', JSON.stringify(cleared.color));

    const badPatch = await req('PATCH', `/artists/${a.id}`, { color: 'javascript:alert(1)' });
    check('a non-hex colour is refused on patch too', badPatch.status === 400, String(badPatch.status));

    // The other four tables that make `color` writable go through the same factory gate.
    const p = await req('POST', '/projects', { artist_id: a.id, name: 'P', code: 'C', color: 'blau' });
    check('the same guard covers projects', p.status === 400, String(p.status));
    const t = await req('POST', '/tasks', { title: 'T', artist_id: a.id, color: 'grün' });
    check('…and tasks', t.status === 400, String(t.status));
    const l = await req('POST', '/links', { artist_id: a.id, label: 'L', url: 'https://e.com', color: 'x' });
    check('…and links', l.status === 400, String(l.status));
    const c = await req('POST', '/contacts', { artist_id: a.id, name: 'K', color: 'x' });
    check('…and contacts', c.status === 400, String(c.status));
  }

  // ------------------------------------------------------------------ list filters (SRV-09)
  // An invalid filter used to fail *open* — invalid meant unfiltered, i.e. every row — and a
  // repeated param threw a 500 out of better-sqlite3.
  console.log('\n== list filter params (SRV-09)');
  {
    const artist = await ok('POST', '/artists', { name: 'Filter' });
    await ok('POST', '/contacts', { artist_id: artist.id, name: 'Kontakt A' });
    const scoped = await ok('GET', `/contacts?artist_id=${artist.id}`);
    check('a valid filter narrows the list', scoped.length === 1, `${scoped.length} rows`);

    // The array case is the one that actually reaches the guard. A nested `?f[x]=` cannot:
    // Express 5 defaults to the `simple` query parser, so that arrives as the literal key
    // "artist_id[x]" and simply never matches a filter name.
    const repeated = await req('GET', '/contacts?artist_id=1&artist_id=2');
    check('a repeated filter param is a 400, not a 500', repeated.status === 400, String(repeated.status));

    const bogus = await ok('GET', '/contacts?artist_id=nonsense');
    check('an unmatched filter value returns nothing, it does not fail open', bogus.length === 0, `${bogus.length} rows`);

    const empty = await ok('GET', '/contacts?artist_id=');
    check('an empty filter means "no filter", not "match 0" (SDL-09)', empty.length >= 1, `${empty.length} rows`);
  }

  // ------------------------------------------------------------------ settings (SDL-06)
  console.log('\n== settings validation (SDL-06)');
  {
    const scalar = await req('PATCH', '/settings', { task_sort: 'nonsense' });
    check('a scalar task_sort is refused', scalar.status === 400, String(scalar.status));

    const list = await req('PATCH', '/settings', { task_sort: [] });
    check('an array task_sort is accepted', list.status === 200, String(list.status));

    const unknown = await ok('PATCH', '/settings', { luftschloss: 'x' });
    check('an unlisted settings key is dropped', unknown.luftschloss === undefined);

    const settings = await ok('GET', '/settings');
    check('the retention constants ride on the response (PGS-24)', settings.purge_after_days === 30 && settings.archive_after_days === 30);
    const readonly = await ok('PATCH', '/settings', { purge_after_days: 1 });
    check('…and are read-only by construction', readonly.purge_after_days === 30, String(readonly.purge_after_days));

    // The saved layout is a *second* store beside the standard new pages inherit (WP-31). It is
    // only useful if writing one leaves the other alone, which is the whole point of the split —
    // and it has to be on ARRAY_KEYS, or it round-trips as a string and the client reads no layout.
    const entries = [{ key: 'termine', width: 'half' }];
    const saved = await ok('PATCH', '/settings', { artist_layout_saved: entries });
    check('a saved layout round-trips parsed', JSON.stringify(saved.artist_layout_saved) === JSON.stringify(entries), JSON.stringify(saved.artist_layout_saved));
    check('…and left the standard alone', saved.artist_layout === undefined, JSON.stringify(saved.artist_layout));
    const savedScalar = await req('PATCH', '/settings', { project_layout_saved: 'nonsense' });
    check('a scalar saved layout is refused', savedScalar.status === 400, String(savedScalar.status));
  }

  // ------------------------------------------------------------------ task tree (SRV-11)
  // The two-level rule is an API invariant, enforced only here — see migrateFlattenDeepSubtasks
  // in db.ts for the back door that raw SQL used to leave open.
  console.log('\n== task parent_id rules (SRV-11, FIX-10)');
  {
    const artist = await ok('POST', '/artists', { name: 'Baum' });
    const root = await ok('POST', '/tasks', { title: 'Wurzel', artist_id: artist.id });
    const child = await ok('POST', '/tasks', { title: 'Kind', artist_id: artist.id, parent_id: root.id });
    check('a first-level subtask is accepted', child.parent_id === root.id, String(child.parent_id));

    const third = await req('POST', '/tasks', { title: 'Enkel', artist_id: artist.id, parent_id: child.id });
    check('a third level is refused', third.status === 400, String(third.status));

    const self = await req('PATCH', `/tasks/${root.id}`, { parent_id: root.id });
    check('self-reference is refused', self.status === 400, String(self.status));

    const cycle = await req('PATCH', `/tasks/${root.id}`, { parent_id: child.id });
    check('a cycle is refused', cycle.status === 400, String(cycle.status));
  }

  // ------------------------------------------------------------- delete/restore (SRV-13, FIX-08)
  console.log('\n== delete & restore semantics (SRV-13, FIX-08)');
  {
    const artist = await ok('POST', '/artists', { name: 'Papierkorb' });
    const first = await ok('DELETE', `/artists/${artist.id}`);
    check('a delete reports that it removed the row', first.deleted === true);

    const second = await ok('DELETE', `/artists/${artist.id}`);
    check('a repeat delete answers {deleted:false}, not 404', second.deleted === false, JSON.stringify(second));

    const restored = await ok('POST', `/artists/${artist.id}/restore`);
    check('restore brings the row back', restored.deleted_at === null);

    const missing = await req('POST', '/artists/999999/restore');
    check('restoring a row that no longer exists is a 404', missing.status === 404, String(missing.status));
  }

  // ------------------------------------------------------------------ priority order (TTU-11)
  // The server's CASE is generated from the configured Priorität option order (priorityValues),
  // so renaming the categories must not drop every task into ELSE while the client ranks them.
  console.log('\n== task order follows renamed priority options (TTU-11)');
  {
    const artist = await ok('POST', '/artists', { name: 'Reihenfolge' });
    const cols = await ok('GET', '/custom-columns');
    const priority = cols.find((c) => c.key === 'priority');
    const renamed = [
      { value: 'A-dringend', label: 'A dringend' },
      { value: 'B-normal', label: 'B normal' },
      { value: 'C-später', label: 'C später' },
    ];
    await ok('PATCH', `/custom-columns/${priority.id}`, { options: JSON.stringify(renamed) });
    await ok('PATCH', '/settings', { task_sort: [] });

    // Created in reverse, so any ordering that ignores priority returns them in insertion order.
    for (const p of ['C-später', 'B-normal', 'A-dringend']) {
      await ok('POST', '/tasks', { title: `Prio ${p}`, artist_id: artist.id, priority: p });
    }
    const tasks = (await ok('GET', `/tasks?artist_id=${artist.id}`)).map((t) => t.priority);
    check(
      'renamed priority options still rank in their configured order',
      JSON.stringify(tasks) === JSON.stringify(['A-dringend', 'B-normal', 'C-später']),
      tasks.join(' < '),
    );
  }

  // ------------------------------------------------------------------ season copy (DBW-06)
  // Every child row is gated on the parent that *actually arrived*, not on the group flag.
  // `includeEvents` forces artists along (db.ts closes that edge) but NOT projects — so an
  // event hanging off a project has no parent in the target and must stay behind. Copying it
  // anyway is DBW-06, and it stays invisible until a foreign_key_check or an export.
  console.log('\n== season copy leaves no dangling rows (DBW-06)');
  {
    const artist = await ok('POST', '/artists', { name: 'Kopie' });
    const project = await ok('POST', '/projects', { artist_id: artist.id, name: 'Projekt', code: 'K1' });
    await ok('POST', '/events', { artist_id: artist.id, type: 'Auftritt', title: 'Termin am Künstler', start_at: '2026-09-01', all_day: 1 });
    await ok('POST', '/events', { project_id: project.id, type: 'Auftritt', title: 'Termin am Projekt', start_at: '2026-09-02', all_day: 1 });

    // Arranged before the copy: `layout` is in COPY_COLS, so a season copy has to carry the
    // arrangement over. It is the one column of these two tables that holds no user *content*,
    // which is exactly why it is easy to forget there (WP-25).
    await ok('PATCH', `/artists/${artist.id}`, { layout: [{ key: 'kontakte', width: 'half' }] });
    await ok('PATCH', `/projects/${project.id}`, { layout: [{ key: 'termine', width: 'half' }] });

    const season = await ok('POST', '/seasons', { label: 'Kopie ohne Projekte', copyFrom: 1, includeEvents: true });
    check('the copy reported no error', season.copyError === undefined, String(season.copyError));
    copyTarget = seasonFile(season.file);

    // A second copy, this one *with* projects, so the project half of the layout is reachable.
    const withProjects = await ok('POST', '/seasons', { label: 'Kopie mit Projekten', copyFrom: 1, includeProjects: true });
    check('the second copy reported no error', withProjects.copyError === undefined, String(withProjects.copyError));
    projectCopyTarget = seasonFile(withProjects.file);
  }

  // ------------------------------------------------------- purge fixtures (SDL-01 / DBW-02)
  console.log('\n== purge fixtures');
  {
    const parent = await ok('POST', '/artists', { name: 'Eltern mit lebendem Kind' });
    const kid = await ok('POST', '/projects', { artist_id: parent.id, name: 'Lebendes Projekt', code: 'P1' });
    await ok('DELETE', `/artists/${parent.id}`); // only the parent goes to the trash
    purge = { parentId: parent.id, kidId: kid.id };

    const lone = await ok('POST', '/artists', { name: 'Eltern ohne Kind' });
    await ok('DELETE', `/artists/${lone.id}`);
    purge.loneId = lone.id;
    check('the fixture is set up: parent trashed, child still live', (await ok('GET', `/projects/${kid.id}`)).deleted_at === null);
  }

  await stopServer();

  // ------------------------------------------------------------------ the copy, on disk
  {
    const db = new Database(copyTarget, { readonly: true });
    const dangling = db.prepare('PRAGMA foreign_key_check').all();
    check('PRAGMA foreign_key_check is clean on the copy', dangling.length === 0, `${dangling.length} dangling`);
    check('projects were not copied', db.prepare('SELECT COUNT(*) c FROM projects').get().c === 0);
    const titles = db.prepare('SELECT title FROM events ORDER BY id').all().map((e) => e.title);
    check('the artist-owned event came over', titles.includes('Termin am Künstler'), titles.join(', '));
    check('the project-owned event stayed behind (DBW-06)', !titles.includes('Termin am Projekt'), titles.join(', '));
    const artistLayout = db.prepare("SELECT layout FROM artists WHERE name = 'Kopie'").get()?.layout;
    check('the artist layout travelled with the copy (WP-25)', artistLayout === '[{"key":"kontakte","width":"half"}]', String(artistLayout));
    db.close();
  }

  // -------------------------------------------------- the project layout, in the second copy
  {
    const db = new Database(projectCopyTarget, { readonly: true });
    const layout = db.prepare("SELECT layout FROM projects WHERE name = 'Projekt'").get()?.layout;
    check('the project layout travelled with the copy (WP-25)', layout === '[{"key":"termine","width":"half"}]', String(layout));
    db.close();
  }

  // ------------------------------- backdate, and plant a deep tree the API would have refused
  {
    const db = new Database(seasonFile('auftakt.db'));
    db.prepare(
      `UPDATE artists SET deleted_at = datetime('now', 'localtime', '-60 days') WHERE deleted_at IS NOT NULL`,
    ).run();

    // Raw SQL, exactly as a bulk importer writes: four levels, bypassing the transform.
    const ins = db.prepare(
      `INSERT INTO tasks (title, status, parent_id, created_at, updated_at)
       VALUES (?, 'new', ?, datetime('now','localtime'), datetime('now','localtime'))`,
    );
    let parent = null;
    deepTree = [];
    for (const level of ['Ebene 1', 'Ebene 2', 'Ebene 3', 'Ebene 4']) {
      parent = Number(ins.run(level, parent).lastInsertRowid);
      deepTree.push(parent);
    }
    db.close();
  }

  console.log('\n== purge never destroys live children (SDL-01)');
  await startServer(); // purgeExpired() runs here
  await stopServer();
  {
    // Read the file, not the API: `GET /:id` 404s on soft-deleted rows too (crud.ts), so over
    // HTTP a parked row and a purged one look identical. The whole point is telling them apart.
    const db = new Database(seasonFile('auftakt.db'), { readonly: true });
    const exists = (table, id) => db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE id = ?`).get(id).c === 1;
    check('an expired parent with a live child survives the sweep', exists('artists', purge.parentId));
    check('…and its live child is untouched', exists('projects', purge.kidId));
    check('an expired row nothing references is purged', !exists('artists', purge.loneId));
    check('the sweep left no dangling rows behind', db.prepare('PRAGMA foreign_key_check').all().length === 0);

    // The deep tree planted by raw SQL above: startup must have flattened it to two levels.
    const parentOf = (id) => db.prepare('SELECT parent_id FROM tasks WHERE id = ?').get(id).parent_id;
    const [root, l2, l3, l4] = deepTree;
    check('a raw-SQL 4-level tree is flattened at startup', [parentOf(l2), parentOf(l3), parentOf(l4)].every((p) => p === root), `${parentOf(l2)}/${parentOf(l3)}/${parentOf(l4)} vs root ${root}`);
    check('the root itself keeps no parent', parentOf(root) === null, String(parentOf(root)));
    const deep = db.prepare(
      `SELECT COUNT(*) c FROM tasks t JOIN tasks p ON p.id = t.parent_id WHERE p.parent_id IS NOT NULL`,
    ).get().c;
    check('no task is deeper than one level anywhere', deep === 0, `${deep} too deep`);
    db.close();
  }

  // Idempotence: a second boot must lift nothing and change nothing.
  console.log('\n== the flatten migration is idempotent');
  {
    const snapshot = () => {
      const db = new Database(seasonFile('auftakt.db'), { readonly: true });
      const rows = JSON.stringify(db.prepare('SELECT id, parent_id FROM tasks ORDER BY id').all());
      db.close();
      return rows;
    };
    const before = snapshot();
    await startServer();
    await stopServer();
    check('a second launch leaves the tree untouched', snapshot() === before);
  }

  // `links.notes` (WP-26) is an ensureColumn, but `migrateLinksSectionParent` *rebuilds* the
  // table from a hardcoded column list that does not name it — so the two are order-dependent
  // and the wrong order costs the column again on any database that jumps both versions in one
  // open. Silently: nothing re-adds it before the next launch, and by then the write that
  // filled it has already been dropped. Plant a pre-WP-S links table and boot once.
  console.log('\n== a pre-WP-S links table gains section_id *and* notes (WP-26)');
  {
    const db = new Database(seasonFile('auftakt.db'));
    db.exec(`
      DROP TABLE links;
      CREATE TABLE links (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        artist_id  INTEGER REFERENCES artists(id),
        project_id INTEGER REFERENCES projects(id),
        event_id   INTEGER REFERENCES events(id),
        task_id    INTEGER REFERENCES tasks(id),
        label      TEXT NOT NULL,
        url        TEXT,
        color      TEXT,
        category   TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        deleted_at TEXT,
        CHECK ((artist_id IS NOT NULL) + (project_id IS NOT NULL) + (event_id IS NOT NULL) + (task_id IS NOT NULL) = 1)
      );
      INSERT INTO links (id, task_id, label, url, category, sort_order)
        VALUES (1, ${deepTree[0]}, 'Altdokument', 'https://e.org/a', 'technik', 3);
    `);
    db.close();

    await startServer();
    await stopServer();

    const db2 = new Database(seasonFile('auftakt.db'), { readonly: true });
    const cols = db2.prepare('PRAGMA table_info(links)').all().map((c) => c.name);
    check('the section_id rebuild ran', cols.includes('section_id'), cols.join(','));
    check('…and notes survived it', cols.includes('notes'), cols.join(','));
    const row = db2.prepare('SELECT * FROM links WHERE id = 1').get();
    check(
      'the pre-existing row came through intact',
      row?.label === 'Altdokument' && row?.category === 'technik' && row?.sort_order === 3,
      JSON.stringify(row),
    );
    check('a row written before the column reads NULL, not ""', row?.notes === null, String(row?.notes));
    db2.close();
  }

  // The whole WP-25 fallback rests on NULL meaning "never arranged": an upgraded database has to
  // read back NULL, not '', or every existing page would show an *empty* layout instead of the
  // artist_layout/project_layout template it showed before the column existed.
  console.log('\n== a pre-WP-25 database gains the layout column, reading NULL');
  {
    const db = new Database(seasonFile('auftakt.db'));
    db.exec(`
      ALTER TABLE artists DROP COLUMN layout;
      ALTER TABLE projects DROP COLUMN layout;
    `);
    db.close();

    await startServer();
    await stopServer();

    const db2 = new Database(seasonFile('auftakt.db'), { readonly: true });
    for (const table of ['artists', 'projects']) {
      const cols = db2.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
      check(`${table}.layout was re-added`, cols.includes('layout'), cols.join(','));
      const row = db2.prepare(`SELECT layout FROM ${table} LIMIT 1`).get();
      check(`a ${table} row from before the column reads NULL, not ""`, row?.layout === null, String(row?.layout));
    }
    db2.close();
  }
} catch (err) {
  check('run completed', false, String(err));
  if (serverLog) console.log(serverLog.slice(-900));
  await stopServer();
}

console.log(failures === 0 ? '\n✓ alles ok' : `\n✗ ${failures} Fehler`);
process.exit(failures === 0 ? 0 : 1);
