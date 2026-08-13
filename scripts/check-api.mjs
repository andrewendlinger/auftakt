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
// The .xlsx export is asserted by reading the sheet back, so the check needs the same reader
// the route writes with. Both come from the server's own node_modules.
const ExcelJS = require('exceljs');

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

/**
 * Raw request: returns status and parsed body, and never throws on a non-2xx.
 *
 * `body` is `any` on purpose. `Response.json()` is typed `Promise<unknown>`, and every assertion
 * below reads a field off it — narrowing each one would mean restating the API's whole response
 * shape in a check script whose job is to catch the server disagreeing with that shape.
 * @returns {Promise<{ status: number, body: any }>}
 */
async function req(method, path, body, headers = {}) {
  const r = await fetch(API + path, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

/**
 * …and the same, asserting success, for fixture setup where a failure is not the point.
 * @returns {Promise<any>}
 */
async function ok(method, path, body, headers) {
  const r = await req(method, path, body, headers);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

const seasonFile = (name) => join(dataDir, name);

/** Carried across the stop/start boundary, where the purge and the on-disk checks run. */
let copyTarget = null;
let projectCopyTarget = null;
let seasonScopeCopy = null;
let seasonScopeBare = null;
/**
 * Row ids the purge section plants before the restart and asserts on after it. Typed as a bag
 * because it is filled across two statements — `{ parentId, kidId }` then `.loneId` — and
 * inference from the first assignment alone would make the second one an error.
 * @type {Record<string, number>}
 */
let purge = {};
let deepTree = [];
/**
 * Same shape for the non-default-season sweep (PR50-07): planted before the restart,
 * backdated on disk, asserted around the second boot.
 * @type {Record<string, number | string>}
 */
let sweep = {};

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

  // ------------------------------------------------------------------ season scope (WP-47)
  // Contacts, events and links may sit directly on the season — every parent FK NULL — like
  // tasks and custom sections before them. `scope=season` is the only way to list them: an
  // equality filter cannot express "no parent at all", and `?season=` already means a window
  // pin (the middleware answers 410 for a non-integer value before any route runs).
  console.log('\n== season scope: parentless contacts, events and links (WP-47)');
  {
    const artist = await ok('POST', '/artists', { name: 'Saison-Ebene' });
    const project = await ok('POST', '/projects', { artist_id: artist.id, name: 'Saison-Projekt', code: 'SZ1' });
    const cases = [
      { path: '/contacts', seasonBody: { name: 'Saison-Kontakt' }, parentedBody: { name: 'Künstler-Kontakt', artist_id: artist.id }, fks: ['artist_id', 'project_id'] },
      { path: '/events', seasonBody: { type: 'Auftritt', title: 'Saison-Termin', start_at: '2026-09-10', all_day: 1 }, parentedBody: { type: 'Auftritt', title: 'Künstler-Termin', artist_id: artist.id, start_at: '2026-09-11', all_day: 1 }, fks: ['artist_id', 'project_id'] },
      { path: '/links', seasonBody: { label: 'Saison-Dokument', url: 'https://e.org/saison' }, parentedBody: { label: 'Künstler-Dokument', url: 'https://e.org/kuenstler', artist_id: artist.id }, fks: ['artist_id', 'project_id', 'event_id', 'task_id', 'section_id'] },
    ];
    for (const { path, seasonBody, parentedBody, fks } of cases) {
      const row = await ok('POST', path, seasonBody);
      check(`${path}: a parentless create is accepted`, fks.every((fk) => row[fk] === null), JSON.stringify(row));
      await ok('POST', path, parentedBody);

      const scoped = await ok('GET', `${path}?scope=season`);
      check(`${path}?scope=season returns the season row`, scoped.some((r) => r.id === row.id), `${scoped.length} rows`);
      check(`${path}?scope=season returns only parentless rows`, scoped.every((r) => fks.every((fk) => r[fk] === null)), JSON.stringify(scoped));
      const all = await ok('GET', path);
      check(`${path}: the unscoped list keeps carrying everything`, all.some((r) => r.id === row.id) && all.length > scoped.length, `${all.length} vs ${scoped.length} rows`);

      await ok('DELETE', `${path}/${row.id}`);
      const gone = await ok('GET', `${path}?scope=season`);
      check(`${path}: a deleted season row leaves the scoped list`, !gone.some((r) => r.id === row.id), `${gone.length} rows`);
      await ok('POST', `${path}/${row.id}/restore`);
      const back = await ok('GET', `${path}?scope=season`);
      check(`${path}: restore brings it back season-scoped`, back.some((r) => r.id === row.id), `${back.length} rows`);

      // The relaxation is "at most one parent", not "any": two still violate the CHECK, which
      // the error middleware maps to a 400.
      const two = await req('POST', path, { ...seasonBody, artist_id: artist.id, project_id: project.id });
      check(`${path}: two parents are still refused`, two.status === 400, String(two.status));
    }
  }

  // ------------------------------------------------ /reorder follows the allowlist (WP-35)
  //
  // The endpoint is not declared per resource: `crud.ts` mounts it wherever `sort_order` is
  // client-writable. That coupling is invisible to typecheck, so dropping `sort_order` from a
  // `writable` list — a plausible tidy-up — would silently 404 the endpoint and leave the client's
  // drag handles pointing at nothing. Contacts and artists are the two the UI reorders since
  // WP-35; tasks have their own coverage further down.
  console.log('\n== /reorder is mounted wherever sort_order is writable (WP-35)');
  {
    const artist = await ok('POST', '/artists', { name: 'Sortierbar' });
    const made = [];
    for (const name of ['Erster', 'Zweiter', 'Dritter']) {
      made.push(await ok('POST', '/contacts', { artist_id: artist.id, name }));
    }
    const ids = made.map((c) => c.id).reverse();
    await ok('POST', '/contacts/reorder', { ids });
    const rows = await ok('GET', `/contacts?artist_id=${artist.id}`);
    check(
      'a contact reorder is persisted and renumbers to 0..n-1',
      JSON.stringify(rows.map((c) => c.id)) === JSON.stringify(ids) && rows.every((c, i) => c.sort_order === i),
      rows.map((c) => `${c.name}:${c.sort_order}`).join(', '),
    );

    // Artists are the dashboard's card grid, which sends the whole live list.
    const others = (await ok('GET', '/artists')).map((a) => a.id);
    const flipped = [...others].reverse();
    await ok('POST', '/artists/reorder', { ids: flipped });
    const listed = (await ok('GET', '/artists')).map((a) => a.id);
    check(
      'an artist reorder is persisted',
      JSON.stringify(listed) === JSON.stringify(flipped),
      listed.join(','),
    );

    // The 409 arm, on a resource that had no coverage for it: a half-applied batch would leave
    // two rows sharing an ordinal, so a stale id has to roll the whole transaction back.
    //
    // The batch has to *permute* the rows, not repeat the order they are already in. Sending
    // `ids` again would write 0,1,2 onto rows that already hold 0,1,2 — the endpoint would still
    // 409, and „nothing moved" would still pass with the rollback deleted. The assertion has to
    // be able to fail.
    const staleIds = [...ids].reverse();
    const stale = await req('POST', '/contacts/reorder', { ids: [...staleIds, 999999] });
    check('a stale id rolls the whole batch back', stale.status === 409, String(stale.status));
    const unchanged = await ok('GET', `/contacts?artist_id=${artist.id}`);
    check(
      '…and the rows it did reach kept their old order',
      JSON.stringify(unchanged.map((c) => c.id)) === JSON.stringify(ids),
      unchanged.map((c) => c.id).join(','),
    );
  }

  // ------------------------------------------------- the dashboard's event columns (WP-33)
  //
  // `upcomingEvents` has its own column list instead of `EVENT_SELECT`'s `e.*`, because the
  // dashboard refetches after every write and `notes` is rich-text HTML it never renders. Nothing
  // in typecheck can see that: the query returns `unknown[]`, so putting `e.*` back would ship the
  // notes again and still compile. Asserted here rather than in check:dates, whose 31 properties
  // per zone are a documented count (docs/ARCHITECTURE.md).
  console.log('\n== the dashboard ships no event notes (WP-33)');
  {
    const artist = await ok('POST', '/artists', { name: 'Dashboard' });
    await ok('POST', '/events', {
      artist_id: artist.id,
      type: 'Auftritt',
      title: 'Termin mit Notiz',
      start_at: '2099-09-01',
      all_day: 1,
      notes: '<p>lange Notiz</p>',
    });
    const dash = await ok('GET', '/dashboard');
    const row = dash.upcoming.find((e) => e.title === 'Termin mit Notiz');
    check('the event is on the dashboard', row != null, JSON.stringify(dash.upcoming.map((e) => e.title)));
    // `in`, not `== null`: a selected-but-NULL column is still a shipped column, and the point
    // here is that the query stopped asking for it at all.
    check('no upcoming row carries notes', !dash.upcoming.some((e) => 'notes' in e), JSON.stringify(Object.keys(row ?? {})));
    // The other half of the contract — UpcomingEvent in client/src/api/types.ts. A column dropped
    // by accident is a blank cell on the page, and nothing else would catch it.
    const want = ['id', 'project_id', 'title', 'start_at', 'end_at', 'all_day', 'location',
      'resolved_artist_id', 'artist_name', 'artist_color', 'project_code', 'project_color'];
    const missing = want.filter((k) => !(k in (row ?? {})));
    check('every column the page renders is there', missing.length === 0, missing.join(', '));
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

  // --------------------------------------------------------------- delete preview (WP-34)
  // The numbers behind „Löschen" on an artist or a project. This is a *soft* delete: it stamps
  // one row and `parentLive` hides the rest, so the count describes what stops being visible,
  // not what is destroyed — which is why it must skip rows already in the Papierkorb. Getting
  // that wrong overstates the cost of a click that costs nothing permanent.
  console.log('\n== delete preview counts live descendants only (WP-34)');
  {
    const artist = await ok('POST', '/artists', { name: 'Vorschau' });
    const keep = await ok('POST', '/projects', { artist_id: artist.id, name: 'Bleibt', code: 'V1' });
    const gone = await ok('POST', '/projects', { artist_id: artist.id, name: 'Schon weg', code: 'V2' });
    await ok('POST', '/tasks', { title: 'Aufgabe am Künstler', artist_id: artist.id });
    await ok('POST', '/tasks', { title: 'Aufgabe am Projekt', project_id: keep.id });
    await ok('POST', '/contacts', { project_id: keep.id, name: 'Kontakt am Projekt' });
    await ok('POST', '/events', { project_id: gone.id, type: 'Auftritt', title: 'Termin am toten Projekt', start_at: '2026-09-03', all_day: 1 });

    const full = await ok('GET', `/artists/${artist.id}/dependents`);
    check('the artist counts both projects while both are live', full.byType.project === 2, JSON.stringify(full.byType));

    // Soft-deleting the second project must remove it *and* its event from the count: the walk
    // stops at a trashed row rather than stepping through it, exactly as `liveSubtreeIds` does.
    await ok('DELETE', `/projects/${gone.id}`);
    const live = await ok('GET', `/artists/${artist.id}/dependents`);
    check('a trashed project drops out of the count', live.byType.project === 1, JSON.stringify(live.byType));
    check('…and so does the event underneath it', live.byType.event === undefined, JSON.stringify(live.byType));
    check('tasks are counted through the project as well as directly', live.byType.task === 2, JSON.stringify(live.byType));
    check('a project-level contact reaches the artist count', live.byType.contact === 1, JSON.stringify(live.byType));
    check('total agrees with the parts', live.total === Object.values(live.byType).reduce((a, b) => a + b, 0), JSON.stringify(live));

    // The project arm answers for itself, and never counts its own artist — the walk only ever
    // goes down the FK graph.
    const proj = await ok('GET', `/projects/${keep.id}/dependents`);
    check('a project counts its own children', proj.byType.task === 1 && proj.byType.contact === 1, JSON.stringify(proj.byType));
    check('…and never counts upwards to its artist', proj.byType.artist === undefined, JSON.stringify(proj.byType));

    // There is no delete to preview for a row that is gone or already trashed, and `{total: 0}`
    // would read in the dialog as „nothing depends on it".
    const trashed = await req('GET', `/projects/${gone.id}/dependents`);
    check('a preview of an already-trashed row is a 404', trashed.status === 404, String(trashed.status));
    const nobody = await req('GET', '/artists/999999/dependents');
    check('a preview of a row that never existed is a 404', nobody.status === 404, String(nobody.status));
  }

  // ------------------------------------------------------ search hides orphaned projects (WP-34)
  // Every other hit type runs through `parentLive`; projects were filtered on their own
  // `deleted_at` alone, so one under a trashed artist stayed findable and its link led to a page
  // whose artist no longer exists — the dead end SHL-07 closed everywhere else.
  console.log('\n== search drops projects whose artist is in the trash (WP-34)');
  {
    const artist = await ok('POST', '/artists', { name: 'Suchbar' });
    await ok('POST', '/projects', { artist_id: artist.id, name: 'Suchprojekt', code: 'SUCH1' });
    const before = await ok('GET', '/search?q=SUCH1');
    check('the project is findable while its artist is live', before.projects.length === 1, JSON.stringify(before.projects));

    await ok('DELETE', `/artists/${artist.id}`);
    const after = await ok('GET', '/search?q=SUCH1');
    check('and gone from search once the artist is trashed', after.projects.length === 0, JSON.stringify(after.projects));
  }

  // -------------------------------------------------- projects go with their artist (WP-34)
  // The same hole as the search one above, one layer down: `/projects` and `/projects/:id` are
  // where the project page and „Verschieben" read, so filtering only the project's own
  // `deleted_at` served a row every other view hides. The page then rendered — own row live, its
  // artist a 404 the component never gates on — with no artist name and an empty task table.
  console.log('\n== projects leave the live reads with their artist (WP-34)');
  {
    const artist = await ok('POST', '/artists', { name: 'Verwaist' });
    const project = await ok('POST', '/projects', { artist_id: artist.id, name: 'Waise', code: 'W1' });
    const listed = async () => (await ok('GET', '/projects')).some((p) => p.id === project.id);
    check('the project is listed while its artist is live', await listed());

    await ok('DELETE', `/artists/${artist.id}`);
    check('and drops out of the list once the artist is trashed', !(await listed()));
    const gone = await req('GET', `/projects/${project.id}`);
    check('…and its own page is a 404, not a half-rendered one', gone.status === 404, String(gone.status));
    const filtered = await ok('GET', `/projects?artist_id=${artist.id}`);
    check('the artist_id filter hides it too', filtered.length === 0, JSON.stringify(filtered));

    // The row itself is untouched — this is a read filter, not a cascade. Restoring the artist
    // has to bring the whole page back with nothing else to undo.
    await ok('POST', `/artists/${artist.id}/restore`);
    check('restoring the artist brings the project back', await listed());
    check('…with its page reachable again', (await req('GET', `/projects/${project.id}`)).status === 200);
  }

  // ------------------------------------- the season card counts what the season shows (WP-34)
  // Kennzahlen on the landing page. `seasonStats` is a bare COUNT rather than a row list, so it
  // carries no `parentLive` and needs the artist-liveness test spelled out — without it the card
  // contradicted itself the moment an artist could be trashed: one Künstler fewer, every one of
  // their Projekte still counted.
  console.log('\n== the season card drops an artist and its projects together (WP-34)');
  {
    const seasonId = (await ok('GET', '/seasons')).activeId;
    const stats = async () => (await ok('GET', '/seasons/stats'))[seasonId];
    const artist = await ok('POST', '/artists', { name: 'Kennzahl' });
    await ok('POST', '/projects', { artist_id: artist.id, name: 'Zählt mit', code: 'Z1' });

    const before = await stats();
    await ok('DELETE', `/artists/${artist.id}`);
    const after = await stats();
    check('the artist leaves the count', after.artists === before.artists - 1, `${before.artists} → ${after.artists}`);
    check('…and its project leaves with it', after.projects === before.projects - 1, `${before.projects} → ${after.projects}`);
  }

  // ------------------------------------------------------- the baseline order (WP-32, was TTU-11)
  // What the API returns when no sort rule is in effect is what the client keeps: `sortTasks`
  // short-circuits on an empty rule list. So the ORDER BY may rank by nothing the user cannot see
  // — priority used to be in it while the Priorität column ships hidden. TTU-11 guarded the
  // priority CASE against renamed options; the invariant that outlived it is that this ordering
  // and `SERVER_DEFAULT_RULES` (TaskTable.tsx) describe the same thing, or `canDrop` refuses
  // drops the server considers ties (TTU-07). The renamed options stay: they prove priority is
  // ignored by name, not merely by its factory value order.
  console.log('\n== the baseline order is the manual order (WP-32, was TTU-11)');
  {
    const artist = await ok('POST', '/artists', { name: 'Reihenfolge' });
    const cols = await ok('GET', '/custom-columns');
    const priority = cols.find((c) => c.key === 'priority');
    const status = cols.find((c) => c.key === 'status');
    const doneValue = JSON.parse(status.options).find((o) => o.done).value;
    const renamed = [
      { value: 'A-dringend', label: 'A dringend' },
      { value: 'B-normal', label: 'B normal' },
      { value: 'C-später', label: 'C später' },
    ];
    await ok('PATCH', `/custom-columns/${priority.id}`, { options: JSON.stringify(renamed) });
    await ok('PATCH', '/settings', { task_sort: [] });

    // Created in configured priority order, so an ORDER BY that still ranks by priority hands
    // them back unchanged. Each create leads its list, so the expected answer is the reverse.
    const made = [];
    for (const p of ['A-dringend', 'B-normal', 'C-später']) {
      made.push(await ok('POST', '/tasks', { title: `Prio ${p}`, artist_id: artist.id, priority: p }));
    }
    const prios = (await ok('GET', `/tasks?artist_id=${artist.id}`)).map((t) => t.priority);
    check(
      'priority no longer orders the list — the newest task is first',
      JSON.stringify(prios) === JSON.stringify(['C-später', 'B-normal', 'A-dringend']),
      prios.join(' < '),
    );

    // The one ORDER BY key that must not go: with no rules in effect it is the only thing
    // sinking finished rows, and compareByRules relies on it on the client side.
    const newest = made[made.length - 1];
    await ok('PATCH', `/tasks/${newest.id}`, { status: doneValue });
    const afterDone = await ok('GET', `/tasks?artist_id=${artist.id}`);
    check(
      '…and a done task still sinks to the bottom',
      afterDone[afterDone.length - 1].id === newest.id,
      afterDone.map((t) => t.title).join(' < '),
    );
  }

  // ------------------------------------------------------------ a new task lands on top (WP-32)
  // The complaint the package came from: a new task appeared at position 2 or 3. It carried the
  // column default sort_order 0, tied with every never-dragged sibling, and the id tiebreak —
  // highest — put it last. The transform now stamps it below its scope's minimum.
  console.log('\n== a new task lands on top (WP-32)');
  {
    const artist = await ok('POST', '/artists', { name: 'Obenauf' });
    const project = await ok('POST', '/projects', {
      code: 'OBEN',
      name: 'Obenauf-Projekt',
      artist_id: artist.id,
    });
    const titles = () =>
      ok('GET', `/tasks?project_id=${project.id}`).then((ts) => ts.map((t) => t.title));

    const first = await ok('POST', '/tasks', { title: 'A', project_id: project.id });
    check('the first task of an empty list gets 0', first.sort_order === 0, String(first.sort_order));

    const second = await ok('POST', '/tasks', { title: 'B', project_id: project.id });
    const third = await ok('POST', '/tasks', { title: 'C', project_id: project.id });
    check(
      'each further task takes the lowest ordinal',
      third.sort_order < second.sort_order && second.sort_order < first.sort_order,
      [first, second, third].map((t) => t.sort_order).join(' > '),
    );
    check(
      '…so the list comes back newest-first',
      JSON.stringify(await titles()) === JSON.stringify(['C', 'B', 'A']),
      (await titles()).join(' < '),
    );

    const explicit = await ok('POST', '/tasks', { title: 'D', project_id: project.id, sort_order: 99 });
    check('a client-sent sort_order is not overwritten', explicit.sort_order === 99, String(explicit.sort_order));

    // The scope is the artist/project pair: another list's ordinals must not drag this one down.
    const elsewhere = await ok('POST', '/tasks', { title: 'woanders', artist_id: artist.id });
    check('a task in another scope starts at 0', elsewhere.sort_order === 0, String(elsewhere.sort_order));
    // `project_id = NULL` is NULL, not true — with `=` instead of `IS` every festival todo would
    // tie at 0 and the id tiebreak would put the newest one last again.
    const general1 = await ok('POST', '/tasks', { title: 'Festival 1' });
    const general2 = await ok('POST', '/tasks', { title: 'Festival 2' });
    check(
      'season-wide todos are their own scope, matched with IS',
      general1.sort_order === 0 && general2.sort_order === -1,
      `${general1.sort_order} / ${general2.sort_order}`,
    );

    // A trashed row keeps its ordinal and gets it back on restore, so it has to count.
    await ok('DELETE', `/tasks/${third.id}`);
    const afterDelete = await ok('POST', '/tasks', { title: 'E', project_id: project.id });
    await ok('POST', `/tasks/${third.id}/restore`);
    check(
      'a soft-deleted sibling still counts, so a restore cannot tie the new task',
      afterDelete.sort_order < third.sort_order,
      `${afterDelete.sort_order} vs restored ${third.sort_order}`,
    );

    // Same for an archived one: erledigt_am + the done status is the pair acceptsErledigtAm takes.
    const cols = await ok('GET', '/custom-columns');
    const doneValue = JSON.parse(cols.find((c) => c.key === 'status').options).find((o) => o.done).value;
    const aged = await ok('POST', '/tasks', { title: 'archiviert', project_id: project.id });
    await ok('PATCH', `/tasks/${aged.id}`, { status: doneValue, erledigt_am: '2020-01-01 12:00:00' });
    const afterArchive = await ok('POST', '/tasks', { title: 'F', project_id: project.id });
    check(
      'an archived sibling still counts',
      afterArchive.sort_order < aged.sort_order,
      `${afterArchive.sort_order} vs archived ${aged.sort_order}`,
    );

    // Subtasks: the parent's scope, so the newest child leads its own list too.
    const kid1 = await ok('POST', '/tasks', { title: 'Kind 1', project_id: project.id, parent_id: first.id });
    const kid2 = await ok('POST', '/tasks', { title: 'Kind 2', project_id: project.id, parent_id: first.id });
    check('a new subtask leads its siblings', kid2.sort_order < kid1.sort_order, `${kid2.sort_order} < ${kid1.sort_order}`);

    // A drag renumbers a group back to 0..n-1, which is what keeps the negatives from mattering.
    const ids = (await ok('GET', `/tasks?project_id=${project.id}`)).filter((t) => !t.parent_id).map((t) => t.id);
    await ok('POST', '/tasks/reorder', { ids });
    const reordered = await ok('GET', `/tasks?project_id=${project.id}`);
    const tops = reordered.filter((t) => !t.parent_id);
    check(
      'a reorder renumbers the group to 0..n-1',
      tops.every((t, i) => t.sort_order === i) && JSON.stringify(tops.map((t) => t.id)) === JSON.stringify(ids),
      tops.map((t) => t.sort_order).join(','),
    );

    const bare = await ok('POST', '/tasks', { title: 'ohne Priorität', project_id: project.id });
    check('a create without priority takes the column default', bare.priority === 'mittel', String(bare.priority));
  }

  // ----------------------------------------------- a move re-places the task (WP-32 follow-up)
  // An ordinal means nothing outside its own list, so carrying it across scopes dropped a moved
  // task anywhere: the destination is hand-dragged 0..n-1, the source counts downwards from 0.
  console.log('\n== a move places the task, and undo puts the slot back (WP-32)');
  {
    const artist = await ok('POST', '/artists', { name: 'Umzug' });
    const from = await ok('POST', '/projects', { code: 'VON', name: 'Quelle', artist_id: artist.id });
    const to = await ok('POST', '/projects', { code: 'NACH', name: 'Ziel', artist_id: artist.id });

    // The destination is renumbered by a drag, so every row there sits at 0..n-1.
    const a = await ok('POST', '/tasks', { title: 'Ziel A', project_id: to.id });
    const b = await ok('POST', '/tasks', { title: 'Ziel B', project_id: to.id });
    await ok('POST', '/tasks/reorder', { ids: [a.id, b.id] });

    // …while the traveller comes from a list that only ever counted downwards.
    await ok('POST', '/tasks', { title: 'Quelle 1', project_id: from.id });
    const traveller = await ok('POST', '/tasks', { title: 'Reisende', project_id: from.id });
    check('the traveller carries a negative ordinal', traveller.sort_order < 0, String(traveller.sort_order));

    const moved = await ok('POST', `/tasks/${traveller.id}/move`, {
      artist_id: null,
      project_id: to.id,
      parent_id: null,
    });
    const order = (await ok('GET', `/tasks?project_id=${to.id}`)).map((t) => t.title);
    check(
      'a moved task lands at the head of its destination',
      order[0] === 'Reisende',
      order.join(' < '),
    );

    // The endpoint is its own undo: the captured placement has to restore the exact slot.
    const prior = moved.before.find((r) => r.id === traveller.id);
    check('the move reports the prior sort_order', prior.sort_order === traveller.sort_order, String(prior.sort_order));
    await ok('POST', `/tasks/${traveller.id}/move`, {
      artist_id: prior.artist_id,
      project_id: prior.project_id,
      parent_id: prior.parent_id,
      sort_order: prior.sort_order,
    });
    const back = (await ok('GET', `/tasks?project_id=${from.id}`)).find((t) => t.id === traveller.id);
    check('undo restores the exact ordinal', back.sort_order === traveller.sort_order, String(back.sort_order));

    const bad = await req('POST', `/tasks/${traveller.id}/move`, {
      artist_id: null,
      project_id: to.id,
      parent_id: null,
      sort_order: 'oben',
    });
    check('a non-integer sort_order is refused', bad.status === 400, String(bad.status));
  }

  // ------------------------------------------- readers that are not the task table (WP-32)
  // Archiv, .xlsx and the print sheets render listTasks output verbatim and span several lists,
  // where a per-list ordinal interleaves them by position-within-their-own-project.
  console.log('\n== ?order=due orders by deadline, not by the per-list ordinal (WP-32)');
  {
    const artist = await ok('POST', '/artists', { name: 'Fristen' });
    const p1 = await ok('POST', '/projects', { code: 'FR1', name: 'Früh', artist_id: artist.id });
    const p2 = await ok('POST', '/projects', { code: 'FR2', name: 'Spät', artist_id: artist.id });
    // The later deadline sits in the list whose ordinals are lower, so the two orderings disagree.
    await ok('POST', '/tasks', { title: 'in sechs Monaten', project_id: p1.id, due_date: '2027-02-01' });
    await ok('POST', '/tasks', { title: 'morgen', project_id: p2.id, due_date: '2026-08-11' });

    const byDue = (await ok('GET', `/tasks?resolved_artist_id=${artist.id}&order=due`)).map((t) => t.title);
    check('order=due puts the nearer deadline first', byDue[0] === 'morgen', byDue.join(' < '));

    const undated = await ok('POST', '/tasks', { title: 'ohne Datum', project_id: p1.id });
    const withNull = (await ok('GET', `/tasks?resolved_artist_id=${artist.id}&order=due`)).map((t) => t.title);
    check('…and a task without a deadline sorts last', withNull[withNull.length - 1] === 'ohne Datum', withNull.join(' < '));
    check('the undated task still led its own list on create', undated.sort_order < 0, String(undated.sort_order));

    const bogus = await req('GET', `/tasks?order=erfunden`);
    check('an unknown order is a 400, not a silent fallback', bogus.status === 400, String(bogus.status));
  }

  // ------------------------------------------------------ column scopes (WP-51, #58)
  // A task column belongs to the whole season, to one artist or to one project, and „belongs
  // to" is spelled twice: in `scope`, which every list filters on, and in the FK, which the
  // cascade, the trash and the season copy follow. Writing one half without the other put the
  // row somewhere no list looks — `scope = 'project'` with a NULL project_id was accepted and
  // then invisible everywhere, because every list binds the pair together.
  console.log('\n== a column names its scope and its parent together (WP-51, #58)');
  {
    const artist = await ok('POST', '/artists', { name: 'Spalten-Künstler' });
    const other = await ok('POST', '/artists', { name: 'Anderer Künstler' });
    const project = await ok('POST', '/projects', { artist_id: artist.id, name: 'Spalten-Projekt', code: 'S1' });

    const mine = await ok('POST', '/custom-columns', { name: 'Freigabe', type: 'text', scope: 'artist', artist_id: artist.id });
    check('an artist column is created with its parent', mine.scope === 'artist' && mine.artist_id === artist.id, JSON.stringify(mine));
    await ok('POST', '/custom-columns', { name: 'Fremd', type: 'text', scope: 'artist', artist_id: other.id });
    await ok('POST', '/custom-columns', { name: 'Projektspalte', type: 'text', scope: 'project', project_id: project.id });

    for (const [what, body] of [
      ['a scope with no parent', { name: 'X', type: 'text', scope: 'artist' }],
      ['a scope with the wrong parent', { name: 'X', type: 'text', scope: 'artist', project_id: project.id }],
      ['a parent with no scope', { name: 'X', type: 'text', artist_id: artist.id }],
      ['a global column carrying a parent', { name: 'X', type: 'text', scope: 'global', project_id: project.id }],
      ['an unknown scope', { name: 'X', type: 'text', scope: 'saison', artist_id: artist.id }],
    ]) {
      const r = await req('POST', '/custom-columns', body);
      check(`${what} is refused`, r.status === 400, `${r.status} ${JSON.stringify(r.body)}`);
    }

    // A PATCH moving one half of the pair is judged against the half already stored, or the
    // guard would only ever hold for creates.
    const halfMove = await req('PATCH', `/custom-columns/${mine.id}`, { scope: 'project' });
    check('moving the scope without the parent is refused', halfMove.status === 400, String(halfMove.status));
    const stillMine = await ok('GET', `/custom-columns/${mine.id}`);
    check('…and the column is left where it was', stillMine.scope === 'artist' && stillMine.artist_id === artist.id, JSON.stringify(stillMine));
    const renamed = await ok('PATCH', `/custom-columns/${mine.id}`, { name: 'Freigabe' });
    check('an edit that touches neither half still goes through', renamed.name === 'Freigabe', JSON.stringify(renamed));

    // The list side of the same rule. `?scope=artist` alone used to hand back every artist's
    // columns — a set that belongs to no one page, and that a caller merging it with the
    // globals would render on the wrong task table.
    const loose = await req('GET', '/custom-columns?scope=artist');
    check('a scoped list without its parent is refused', loose.status === 400, String(loose.status));
    const names = (await ok('GET', `/custom-columns?scope=artist&artist_id=${artist.id}`)).map((c) => c.name);
    check('a scoped list returns only that parent’s columns', JSON.stringify(names) === JSON.stringify(['Freigabe']), names.join(', '));
    const globals = await ok('GET', '/custom-columns?scope=global');
    check(
      'the global list needs no parent and is where the built-ins live',
      globals.every((c) => c.scope === 'global') && globals.some((c) => c.key === 'status'),
      `${globals.length} rows`,
    );

    // The .xlsx is the reader that spans lists, so its column set is assembled per scope too —
    // and it is the one that fails silently: a missing column is a missing sheet column, not
    // an error. The artist arm reads `resolved_artist_id`, because that is what the artist
    // page's own export button sends (PGS-31).
    const headersOf = async (query) => {
      const res = await fetch(`${API}/export/tasks.xlsx${query}`);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
      return wb.getWorksheet('Aufgaben').getRow(1).values.filter(Boolean).map(String);
    };
    const artistSheet = await headersOf(`?resolved_artist_id=${artist.id}`);
    check("the artist sheet carries that artist's columns", artistSheet.includes('Freigabe'), artistSheet.join(', '));
    check('…and not another artist’s', !artistSheet.includes('Fremd'), artistSheet.join(', '));
    check('…nor a project’s, which spans several on that page', !artistSheet.includes('Projektspalte'), artistSheet.join(', '));
    const projectSheet = await headersOf(`?project_id=${project.id}`);
    check('the project sheet carries the project column', projectSheet.includes('Projektspalte'), projectSheet.join(', '));
    check('…and not the artist’s', !projectSheet.includes('Freigabe'), projectSheet.join(', '));

    // The cascade hangs off the FK, so an artist's columns are part of what deleting it costs —
    // its project's columns included, since the walk steps through the project.
    const deps = await ok('GET', `/artists/${artist.id}/dependents`);
    check('an artist counts its columns, its project’s included', deps.byType.column === 2, JSON.stringify(deps.byType));

    // The Papierkorb names the owner, so two columns called „Freigabe" on two artists are
    // told apart there.
    await ok('DELETE', `/custom-columns/${mine.id}`);
    const trashed = (await ok('GET', '/deleted')).find((d) => d.type === 'column' && d.id === mine.id);
    check('a trashed artist column names its artist', trashed?.sublabel === 'Spalten-Künstler', JSON.stringify(trashed));
    await ok('POST', `/custom-columns/${mine.id}/restore`);
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

    // A scoped column travels with the parent whose page it appears on (WP-51) — and only if
    // that parent actually arrived, the DBW-06 rule this whole section is about. The first copy
    // takes artists (forced by includeEvents) but not projects, so the pair splits.
    await ok('POST', '/custom-columns', { name: 'Kopie-Künstlerspalte', type: 'text', scope: 'artist', artist_id: artist.id });
    await ok('POST', '/custom-columns', { name: 'Kopie-Projektspalte', type: 'text', scope: 'project', project_id: project.id });

    // The projects arm of the same rule, and the one row type it was never applied to. A project
    // whose artist is in the Papierkorb is still live — that is the ordinary state of a season
    // for the 30 days before the purge — and `projects.artist_id` is NOT NULL, so copying it
    // without its artist plants a row pointing at nothing.
    const trashedArtist = await ok('POST', '/artists', { name: 'Kopie-Papierkorb' });
    await ok('POST', '/projects', { artist_id: trashedArtist.id, name: 'Kopie-Waise', code: 'W1' });
    await ok('DELETE', `/artists/${trashedArtist.id}`);

    const season = await ok('POST', '/seasons', { label: 'Kopie ohne Projekte', copyFrom: 1, includeEvents: true });
    check('the copy reported no error', season.copyError === undefined, String(season.copyError));
    copyTarget = seasonFile(season.file);

    // A second copy, this one *with* projects, so the project half of the layout is reachable.
    const withProjects = await ok('POST', '/seasons', { label: 'Kopie mit Projekten', copyFrom: 1, includeProjects: true });
    check('the second copy reported no error', withProjects.copyError === undefined, String(withProjects.copyError));
    projectCopyTarget = seasonFile(withProjects.file);
  }

  // ------------------------------------------- season copy, season-level rows (WP-47)
  // Parentless rows travel with their groups: contacts with includeContacts, events with
  // includeEvents (whose ids feed the event-link edge), and parentless links with
  // includeSettings — like the dashboard widgets, their placement lives in dashboard_layout,
  // which is a setting. Asserted on disk after the shutdown, next to the DBW-06 checks.
  console.log('\n== season copy carries season-level rows with their groups (WP-47)');
  {
    const seasonEvent = (await ok('GET', '/events?scope=season')).find((e) => e.title === 'Saison-Termin');
    await ok('POST', '/links', { event_id: seasonEvent.id, label: 'Dokument am Saison-Termin', url: 'https://e.org/termin' });

    const withGroups = await ok('POST', '/seasons', { label: 'Kopie Saison-Ebene', copyFrom: 1, includeContacts: true, includeEvents: true, includeSettings: true });
    check('the with-groups copy reported no error', withGroups.copyError === undefined, String(withGroups.copyError));
    seasonScopeCopy = seasonFile(withGroups.file);

    const withoutGroups = await ok('POST', '/seasons', { label: 'Kopie ohne Saison-Ebene', copyFrom: 1, includeArtists: true });
    check('the without-groups copy reported no error', withoutGroups.copyError === undefined, String(withoutGroups.copyError));
    seasonScopeBare = seasonFile(withoutGroups.file);
  }

  // ----------------------------------------------------------- per-window season routing
  // A window pins its season and sends it with every request (X-Auftakt-Season, or ?season=
  // for the one <a href> download); no header means the registry default. Each assertion is
  // one leg of that contract — the client's pin, recovery and Excel export all key on them.
  console.log('\n== per-window season routing');
  {
    const routing = await ok('POST', '/seasons', { label: 'Routing-Saison' });
    const before = await ok('GET', '/seasons');
    const defaultLabel = before.seasons.find((s) => s.id === before.activeId)?.label;

    const viaHeader = await ok('GET', '/settings', undefined, { 'x-auftakt-season': String(routing.id) });
    check('the season header routes to that season', viaHeader.saison === 'Routing-Saison', String(viaHeader.saison));
    const headerless = await ok('GET', '/settings');
    check('headerless requests stay on the default season', headerless.saison !== 'Routing-Saison', String(headerless.saison));

    const viaQuery = await ok('GET', `/settings?season=${routing.id}`);
    // The header's equivalent for callers that cannot set one — today only the main process's
    // own HTTP (seasonPath() in electron/main.ts). The .xlsx export used to be the other, as a
    // plain <a href>, until a 410 answered as a navigation stranded the window (PR50-04).
    check('?season= routes like the header', viaQuery.saison === 'Routing-Saison', String(viaQuery.saison));

    // The echo is what a fresh window pins itself from — it must name the resolved season.
    const echo = await fetch(`${API}/settings`, { headers: { 'x-auftakt-season': String(routing.id) } });
    check('the response echoes the resolved season id', echo.headers.get('x-auftakt-season') === String(routing.id));
    await echo.json();

    const gone = await req('GET', '/settings', undefined, { 'x-auftakt-season': '9999' });
    check('an unknown season answers 410, not 404', gone.status === 410, String(gone.status));

    // Renaming the Saison from a pinned window must relabel *that* season in the registry,
    // not the default one (the setActiveSeasonLabel scoping fix).
    await ok('PATCH', '/settings', { saison: 'Routing II' }, { 'x-auftakt-season': String(routing.id) });
    const after = await ok('GET', '/seasons');
    check(
      'a pinned rename relabels the pinned season',
      after.seasons.find((s) => s.id === routing.id)?.label === 'Routing II',
      JSON.stringify(after.seasons.map((s) => s.label)),
    );
    check(
      'the default season keeps its label',
      after.seasons.find((s) => s.id === after.activeId)?.label === defaultLabel,
      String(defaultLabel),
    );

    // Headerless callers (Electron main, these scripts) follow the default as it moves.
    await ok('POST', `/seasons/${routing.id}/activate`);
    const followed = await ok('GET', '/settings');
    check('headerless requests follow the activated default', followed.saison === 'Routing II', String(followed.saison));
    await ok('POST', '/seasons/1/activate'); // restore: later sections purge the default season's file
  }

  // ---------------------------------------- a rename writes into the renamed season's file
  // updateSeason used to guard the settings.saison sync with `id === reg.activeId` while
  // getDb() resolved the request's pin — so a pinned rename of the default wrote the label
  // into the pinned season's DB, and a non-default rename synced nothing at all (#52).
  console.log("\n== a season rename writes into the renamed season's file (#52)");
  {
    const reg = await ok('GET', '/seasons');
    const defaultId = reg.activeId;
    const defaultLabel = reg.seasons.find((s) => s.id === defaultId).label;
    // withSeasonDb has two branches and the pinned cases below only reach the pooled one.
    // Renaming a season no window has open — the ordinary case — takes the raw open instead,
    // and createSeason leaves exactly that state: the file is written and initialised but
    // never pooled, so this PATCH is the first thing to touch it.
    const cold = await ok('POST', '/seasons', { label: 'Kalt' });
    await ok('PATCH', `/seasons/${cold.id}`, { label: 'Kalt umbenannt' });
    const coldRead = await ok('GET', '/settings', undefined, { 'x-auftakt-season': String(cold.id) });
    check('renaming a never-opened season reaches its file', coldRead.saison === 'Kalt umbenannt', String(coldRead.saison));
    await ok('DELETE', `/seasons/${cold.id}`);

    const other = await ok('POST', '/seasons', { label: 'Anderes Fenster' });
    const pin = { 'x-auftakt-season': String(other.id) };

    // Renaming the DEFAULT from a window pinned elsewhere must not touch the pinned file.
    await ok('PATCH', `/seasons/${defaultId}`, { label: 'Standard umbenannt' }, pin);
    const pinned = await ok('GET', '/settings', undefined, pin);
    check("the pinned season's settings.saison is untouched", pinned.saison === 'Anderes Fenster', String(pinned.saison));
    const dflt = await ok('GET', '/settings');
    check("the renamed default's own file follows", dflt.saison === 'Standard umbenannt', String(dflt.saison));

    // Renaming a NON-default season used to write no settings row at all.
    await ok('PATCH', `/seasons/${other.id}`, { label: 'Anderes Fenster II' });
    const renamed = await ok('GET', '/settings', undefined, pin);
    check('a non-default rename reaches its own file too', renamed.saison === 'Anderes Fenster II', String(renamed.saison));

    await ok('PATCH', `/seasons/${defaultId}`, { label: defaultLabel }); // restore the shared fixture
  }

  // --------------------------------------------------------- seasonStats is pin-independent
  // seasonStats decided getDb()-vs-raw with `s.id === reg.activeId` while getDb() resolved
  // the request's pin — so under a pinned request the default's card carried the pinned
  // season's counts and the default's own file was never opened (#53).
  console.log('\n== seasonStats is pin-independent (#53)');
  {
    const s = await ok('POST', '/seasons', { label: 'Statistik' });
    const pin = { 'x-auftakt-season': String(s.id) };
    await ok('POST', '/artists', { name: 'Stat A' }, pin);
    await ok('POST', '/artists', { name: 'Stat B' }, pin);

    const headerless = await ok('GET', '/seasons/stats');
    const pinned = await ok('GET', '/seasons/stats', undefined, pin);
    const defaultId = (await ok('GET', '/seasons')).activeId;
    check(
      'fixture: the two seasons are distinguishable',
      headerless[defaultId].artists !== headerless[s.id].artists,
      `${headerless[defaultId].artists} vs ${headerless[s.id].artists}`,
    );
    check(
      'a pinned stats read equals the headerless one',
      JSON.stringify(pinned) === JSON.stringify(headerless),
      JSON.stringify({ pinned: pinned[defaultId], headerless: headerless[defaultId] }),
    );
    check('the pinned season counts its own rows', pinned[s.id].artists === 2, String(pinned[s.id].artists));
  }

  // ------------------------------------------------ deleted season ids are never recycled
  // max(ids)+1 handed a just-deleted max id straight back out, and a window still pinned to
  // it was silently routed into the new season's DB — the 410 recovery only fires for ids
  // the registry does not know (PR50-02). The registry's nextSeasonId is monotonic instead.
  console.log("\n== a deleted season's id is never recycled (PR50-02)");
  {
    const first = await ok('POST', '/seasons', { label: 'Wegwerf A' }); // takes the current max id
    await ok('DELETE', `/seasons/${first.id}`); // frees the id and unlinks the file
    const second = await ok('POST', '/seasons', { label: 'Wegwerf B' });
    check('the freed max id is not handed out again', second.id !== first.id, `${first.id} → ${second.id}`);
    check('ids are strictly increasing', second.id > first.id, `${first.id} → ${second.id}`);
    await ok('DELETE', `/seasons/${second.id}`); // leave no litter for later sections
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
    // Over HTTP the child now reads as gone: `parent` (lib/crud.ts) hides a project whose artist
    // is in the trash. The row itself is untouched, which is the whole point of the sweep case
    // below — „…and its live child is untouched" asserts that against the file, not the API.
    const hidden = await req('GET', `/projects/${kid.id}`);
    check('the fixture is set up: parent trashed, child hidden behind it', hidden.status === 404, String(hidden.status));
  }

  // ------------------------------------- purge fixture in a NON-default season (PR50-07)
  // Boot only sweeps the registry default; a season lived in from a pinned window purges
  // on its first request-context open instead. Planted here, backdated after the stop,
  // asserted around the second boot below.
  console.log('\n== purge fixture, non-default season');
  {
    const s = await ok('POST', '/seasons', { label: 'Kehr-Saison' });
    const pin = { 'x-auftakt-season': String(s.id) };
    const a = await ok('POST', '/artists', { name: 'Abgelaufen' }, pin);
    await ok('DELETE', `/artists/${a.id}`, undefined, pin);
    sweep = { seasonId: s.id, artistId: a.id, file: seasonFile(s.file) };
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

    // The scoped columns split along the same line as their parents (WP-51): artists came,
    // projects did not.
    const col = (name) => db.prepare('SELECT * FROM custom_columns WHERE name = ?').get(name);
    const artistCol = col('Kopie-Künstlerspalte');
    check(
      'the artist column came with its artist',
      artistCol?.scope === 'artist' && artistCol.artist_id === db.prepare("SELECT id FROM artists WHERE name = 'Kopie'").get()?.id,
      JSON.stringify(artistCol),
    );
    check('the project column stayed behind with its project', col('Kopie-Projektspalte') === undefined);
    db.close();
  }

  // -------------------------------------------------- the project layout, in the second copy
  {
    const db = new Database(projectCopyTarget, { readonly: true });
    const layout = db.prepare("SELECT layout FROM projects WHERE name = 'Projekt'").get()?.layout;
    check('the project layout travelled with the copy (WP-25)', layout === '[{"key":"termine","width":"half"}]', String(layout));
    const projectCol = db.prepare("SELECT * FROM custom_columns WHERE name = 'Kopie-Projektspalte'").get();
    check(
      'the project column came once its project did (WP-51)',
      projectCol?.scope === 'project' && projectCol.project_id === db.prepare("SELECT id FROM projects WHERE name = 'Projekt'").get()?.id,
      JSON.stringify(projectCol),
    );
    check(
      'a live project under a trashed artist stayed behind (DBW-06)',
      db.prepare("SELECT COUNT(*) c FROM projects WHERE name = 'Kopie-Waise'").get().c === 0,
    );
    const dangling = db.prepare('PRAGMA foreign_key_check').all();
    check('the copy with projects and both column scopes is free of dangling rows', dangling.length === 0, JSON.stringify(dangling.slice(0, 4)));
    db.close();
  }

  // ------------------------------------ season-level rows in the copies, on disk (WP-47)
  {
    const db = new Database(seasonScopeCopy, { readonly: true });
    check('foreign_key_check is clean on the season-scope copy', db.prepare('PRAGMA foreign_key_check').all().length === 0);
    const contact = db.prepare("SELECT * FROM contacts WHERE name = 'Saison-Kontakt'").get();
    check('the season contact travelled with includeContacts', contact != null && contact.artist_id === null && contact.project_id === null, JSON.stringify(contact));
    const event = db.prepare("SELECT * FROM events WHERE title = 'Saison-Termin'").get();
    check('the season event travelled with includeEvents', event != null && event.artist_id === null && event.project_id === null, JSON.stringify(event));
    const eventLink = db.prepare("SELECT * FROM links WHERE label = 'Dokument am Saison-Termin'").get();
    check('a link on the season event followed it', eventLink != null && eventLink.event_id === event?.id, JSON.stringify(eventLink));
    const seasonLink = db.prepare("SELECT * FROM links WHERE label = 'Saison-Dokument'").get();
    check('the parentless link rode the settings group', seasonLink != null, String(seasonLink));
    db.close();

    const bare = new Database(seasonScopeBare, { readonly: true });
    check('without its group the season contact stays behind', bare.prepare("SELECT COUNT(*) c FROM contacts WHERE name = 'Saison-Kontakt'").get().c === 0);
    check('…the season event stays behind', bare.prepare("SELECT COUNT(*) c FROM events WHERE title = 'Saison-Termin'").get().c === 0);
    check('…and without includeSettings the parentless link stays behind', bare.prepare("SELECT COUNT(*) c FROM links WHERE label = 'Saison-Dokument'").get().c === 0);
    bare.close();
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

  // The non-default season's fixture, same backdating (read-write open recovers the killed
  // run's WAL; the clean close checkpoints it away).
  {
    const db = new Database(sweep.file);
    db.prepare(`UPDATE artists SET deleted_at = datetime('now', 'localtime', '-60 days') WHERE id = ?`).run(sweep.artistId);
    db.close();
  }

  console.log('\n== purge never destroys live children (SDL-01) / reaches a pinned season (PR50-07)');
  await startServer(); // boot purgeExpired() runs here — default season only
  {
    // The server has not touched this file yet (boot opens only the default), so a direct
    // readonly peek is safe while it runs. Without this check, a boot that swept every
    // season would also pass the assertion after the pinned request.
    const db = new Database(sweep.file, { readonly: true });
    const there = db.prepare('SELECT COUNT(*) c FROM artists WHERE id = ?').get(sweep.artistId).c === 1;
    db.close();
    check('the boot sweep leaves a non-default season alone', there);
  }
  await ok('GET', '/artists', undefined, { 'x-auftakt-season': String(sweep.seasonId) }); // first pinned open
  await stopServer();
  {
    const db = new Database(sweep.file, { readonly: true });
    const gone = db.prepare('SELECT COUNT(*) c FROM artists WHERE id = ?').get(sweep.artistId).c === 0;
    db.close();
    check('one pinned request swept the season on first open (PR50-07)', gone);
  }
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

  // The season-scope rebuilds (WP-47): a legacy "exactly one parent" CHECK on contacts, events
  // or links must relax to "<= 1" on the next launch, keeping every row and — because DROP
  // TABLE takes the indexes down and SCHEMA only re-runs on the boot after — every index.
  // idx_links_section is the sharp one: it lives outside SCHEMA, so only the rebuild itself
  // can bring it back.
  console.log('\n== legacy parent CHECKs relax to the season scope (WP-47)');
  {
    const db = new Database(seasonFile('auftakt.db'));
    // The raw connection enforces FKs (better-sqlite3 default); links rows reference events
    // and tasks, so the drops below need them off, exactly like the migration itself.
    db.pragma('foreign_keys = OFF');
    db.exec(`
      DROP TABLE contacts;
      CREATE TABLE contacts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        artist_id  INTEGER REFERENCES artists(id),
        project_id INTEGER REFERENCES projects(id),
        role       TEXT,
        name       TEXT NOT NULL,
        email      TEXT,
        phone      TEXT,
        notes      TEXT,
        color      TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        deleted_at TEXT,
        CHECK ((artist_id IS NOT NULL) + (project_id IS NOT NULL) = 1)
      );
      INSERT INTO contacts (id, artist_id, name, role, sort_order)
        VALUES (1, (SELECT id FROM artists WHERE deleted_at IS NULL LIMIT 1), 'Altkontakt', 'Technik', 2);
      DROP TABLE events;
      CREATE TABLE events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        artist_id  INTEGER REFERENCES artists(id),
        project_id INTEGER REFERENCES projects(id),
        type       TEXT NOT NULL,
        title      TEXT NOT NULL,
        start_at   TEXT,
        end_at     TEXT,
        all_day    INTEGER NOT NULL DEFAULT 0,
        location   TEXT,
        notes      TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        deleted_at TEXT,
        CHECK ((artist_id IS NOT NULL) + (project_id IS NOT NULL) = 1)
      );
      INSERT INTO events (id, artist_id, type, title, start_at, all_day, sort_order)
        VALUES (1, (SELECT id FROM artists WHERE deleted_at IS NULL LIMIT 1), 'Auftritt', 'Alttermin', '2026-05-01', 1, 4);
      DROP TABLE links;
      CREATE TABLE links (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        artist_id  INTEGER REFERENCES artists(id),
        project_id INTEGER REFERENCES projects(id),
        event_id   INTEGER REFERENCES events(id),
        task_id    INTEGER REFERENCES tasks(id),
        section_id INTEGER REFERENCES custom_sections(id),
        label      TEXT NOT NULL,
        url        TEXT,
        color      TEXT,
        category   TEXT,
        notes      TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        deleted_at TEXT,
        CHECK ((artist_id IS NOT NULL) + (project_id IS NOT NULL) + (event_id IS NOT NULL) + (task_id IS NOT NULL) + (section_id IS NOT NULL) = 1)
      );
      INSERT INTO links (id, task_id, label, url, category, notes, sort_order)
        VALUES (1, ${deepTree[0]}, 'Altdokument II', 'https://e.org/b', 'technik', 'Notiz', 5);
    `);
    db.close();

    await startServer();
    await stopServer();

    const db2 = new Database(seasonFile('auftakt.db'), { readonly: true });
    for (const table of ['contacts', 'events', 'links']) {
      const sql = db2.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table).sql;
      check(`${table}: the CHECK now allows season-level rows`, sql.includes('<= 1'), sql);
    }
    const contact = db2.prepare('SELECT * FROM contacts WHERE id = 1').get();
    check('the planted contact came through intact', contact?.name === 'Altkontakt' && contact?.role === 'Technik' && contact?.sort_order === 2, JSON.stringify(contact));
    const event = db2.prepare('SELECT * FROM events WHERE id = 1').get();
    check('the planted event came through intact', event?.title === 'Alttermin' && event?.all_day === 1 && event?.sort_order === 4, JSON.stringify(event));
    const link = db2.prepare('SELECT * FROM links WHERE id = 1').get();
    check('the planted link came through intact', link?.label === 'Altdokument II' && link?.notes === 'Notiz' && link?.sort_order === 5, JSON.stringify(link));
    const indexes = db2.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'").all().map((r) => r.name);
    for (const idx of ['idx_contacts_artist', 'idx_contacts_project', 'idx_events_artist', 'idx_events_project', 'idx_events_start', 'idx_links_parents', 'idx_links_section']) {
      check(`${idx} survives the rebuild`, indexes.includes(idx), indexes.join(','));
    }
    check('the rebuilds left no dangling rows', db2.prepare('PRAGMA foreign_key_check').all().length === 0);
    db2.close();
  }

  // The column-scope rebuild (WP-51): a database from before the artist scope has no artist_id
  // and no CHECK, so it may hold a row whose `scope` names a parent it does not carry. Those
  // are normalised on the way in — the FK is the half that decides — because the CHECK would
  // otherwise fail the rebuild and take the whole open with it.
  console.log('\n== a legacy custom_columns gains the artist scope (WP-51)');
  {
    const db = new Database(seasonFile('auftakt.db'));
    db.pragma('foreign_keys = OFF');
    db.exec(`
      DROP TABLE custom_columns;
      CREATE TABLE custom_columns (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        type       TEXT NOT NULL,
        scope      TEXT NOT NULL DEFAULT 'global',
        project_id INTEGER REFERENCES projects(id),
        options    TEXT,
        icon       TEXT,
        key        TEXT,
        kind       TEXT NOT NULL DEFAULT 'custom',
        enabled    INTEGER NOT NULL DEFAULT 1,
        deletable  INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        deleted_at TEXT
      );
      INSERT INTO custom_columns (id, name, type, scope, project_id, icon, sort_order)
        VALUES (901, 'Altspalte', 'text', 'global', NULL, '📎', 7);
      INSERT INTO custom_columns (id, name, type, scope, project_id, sort_order)
        VALUES (902, 'Altprojektspalte', 'text', 'project',
                (SELECT id FROM projects WHERE deleted_at IS NULL LIMIT 1), 8);
      -- The straggler: project-scoped, no project. Legal before WP-51, and invisible in every
      -- list, because each one binds the scope and the parent id together.
      INSERT INTO custom_columns (id, name, type, scope, project_id, sort_order)
        VALUES (903, 'Heimatlose Spalte', 'text', 'project', NULL, 9);
    `);
    db.close();

    await startServer();
    await stopServer();

    const db2 = new Database(seasonFile('auftakt.db'), { readonly: true });
    const sql = db2.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'custom_columns'").get().sql;
    check('the scope/parent CHECK is installed', sql.includes("scope = 'artist'"), sql);
    check('artist_id is there to hang a column on', sql.includes('artist_id'), sql);
    const row = (id) => db2.prepare('SELECT * FROM custom_columns WHERE id = ?').get(id);
    check('the plain global column came through intact', row(901)?.name === 'Altspalte' && row(901)?.icon === '📎' && row(901)?.sort_order === 7, JSON.stringify(row(901)));
    check('the project column kept its parent', row(902)?.scope === 'project' && row(902)?.project_id != null, JSON.stringify(row(902)));
    check('the straggler is normalised rather than dropped', row(903)?.name === 'Heimatlose Spalte' && row(903)?.scope === 'global', JSON.stringify(row(903)));
    const builtins = db2.prepare("SELECT COUNT(*) c FROM custom_columns WHERE kind = 'builtin'").get().c;
    check('the built-ins are back after the table was replaced', builtins > 0, `${builtins} built-ins`);
    check('the column rebuild left no dangling rows', db2.prepare('PRAGMA foreign_key_check').all().length === 0);
    db2.close();
  }
} catch (err) {
  check('run completed', false, String(err));
  if (serverLog) console.log(serverLog.slice(-900));
  await stopServer();
}

console.log(failures === 0 ? '\n✓ alles ok' : `\n✗ ${failures} Fehler`);
process.exit(failures === 0 ? 0 : 1);
