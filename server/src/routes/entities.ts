import { Router, type RequestHandler } from 'express';
import { localStamp } from '../../../shared/time';
import { doneStatusValue, getDb } from '../db';
import { collect, dependentCounts } from '../lib/cascade';
import { crudRouter } from '../lib/crud';
import { parseCustomValues } from '../lib/customValues';
import { listEvents, listTasks } from '../lib/queries';
// Coerce a query param to a number. COALESCE()-based filters lose column affinity, so string
// params never match integer ids — pass real numbers; an invalid value is now a 400, not a
// silently-dropped filter that returned every row (SRV-09).
import { HttpError, numParam as num, orderParam, scopeParam } from '../lib/query';

/*
 * The `writable`/`required` lists below are mirrored by the `…Create`/`…Update` types in
 * client/src/api/types.ts. Change one, change the other: a column added here is unreachable from
 * the client until it is added there, and a column removed here keeps compiling on the client
 * while the write silently does nothing — which is the defect CCL-24 was (`crudRouter` drops
 * anything not on the list without a word).
 */

/*
 * `layout` is this page's own section arrangement (WP-25), a JSON array of {key,width,hidden}.
 * Whole-value replacement, so no `transform` the way `custom_values` needs one: the arranger
 * always persists the complete array. `jsonColumns` stringifies it, and `applyJson` leaves `null`
 * alone — which is what makes „auf Vorlage zurücksetzen" a plain `PATCH {layout: null}`, since
 * NULL is the sentinel for „never arranged, follow the artist_layout/project_layout setting".
 *
 * `task_columns` (WP-59) is the same shape one level down: a `{"<colId>": true|false}` map over
 * `custom_columns.enabled`, whole-value replacement, and `PATCH {task_columns: null}` is „this page
 * follows the season default again". Both columns need naming **twice** — in `writable` and in
 * `jsonColumns` — and missing either is silent: an unlisted column is dropped without a word
 * (CCL-24), and a listed one that is not stringified reaches SQLite as an object and throws.
 */
export const artistsRouter = crudRouter({
  table: 'artists',
  writable: ['name', 'color', 'notes', 'image', 'layout', 'task_columns', 'sort_order'],
  required: ['name'],
  jsonColumns: ['layout', 'task_columns'],
  order: 'sort_order ASC, name ASC',
});

// `parent` is the one edge of the FK graph this file hands to the factory, and only because a
// project cannot be read without it: every other child of an artist is fetched through a page that
// is itself gated, while a project has a page of its own that a stale URL or the Zurück button
// reaches directly. See `parentLive` in lib/crud.ts for what it does and what it deliberately
// leaves writable.
export const projectsRouter = crudRouter({
  table: 'projects',
  writable: ['artist_id', 'code', 'name', 'status', 'description', 'color', 'layout', 'task_columns', 'sort_order'],
  required: ['artist_id', 'code', 'name'],
  jsonColumns: ['layout', 'task_columns'],
  filters: ['artist_id'],
  parent: { table: 'artists', column: 'artist_id' },
  order: 'sort_order ASC, id ASC',
});

/**
 * What a soft delete of this row would take out of sight (WP-34) — the numbers the „Löschen"
 * confirmation promises before the user commits to it.
 *
 * Deliberately **not** the same count as the trash's cascade. A soft delete stamps one row;
 * `parentLive` then hides the descendants from every list, and `purgeExpired` never takes a
 * parent something still references (SDL-01), so nothing here is destroyed and „Wiederherstellen"
 * brings the whole page back. The dialog therefore counts what *disappears*, which is why the
 * walk is `liveOnly`: a descendant already in the Papierkorb is invisible before the click too.
 *
 * Live-only also makes the number stable under the obvious sequence — delete a project, undo,
 * delete the artist — where the full closure would still be counting the undone one.
 *
 * Mounted only on the two tables that have a delete affordance at page level. It is not on the
 * crud factory: `/:id/dependents` is meaningless for a leaf table, and the factory knows at most
 * one edge of the FK graph — the `parent` above, declared per table — never the walk over all of
 * it, which stays in `lib/cascade.ts`.
 */
function dependentsRoute(table: 'artists' | 'projects'): RequestHandler {
  return (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    // Same answer as crudRouter's GET /:id for a row that is gone, unparseable or already
    // trashed: there is no delete to preview, and `{total: 0}` would read as „nothing depends
    // on it" — the one sentence the dialog must never show wrongly.
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'not found' });
    const row = db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(id);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(dependentCounts(collect(db, table, id, { liveOnly: true }), table, id));
  };
}

artistsRouter.get('/:id/dependents', dependentsRoute('artists'));
projectsRouter.get('/:id/dependents', dependentsRoute('projects'));

/**
 * List handler for a table whose rows may sit directly on the season — every parent FK NULL
 * (WP-47). The equality-only `filters` can't express "no parent at all", so this replaces them:
 * `scope=season` selects the parentless rows, and each FK keeps `defaultList`'s filter reading
 * verbatim (lib/crud.ts) — empty means "no filter" (SDL-09), a non-scalar param is a 400
 * (SRV-09), and a garbage string binds and matches nothing rather than failing open. The scope
 * keyword is deliberately not `?season=`: that query param is the season middleware's window
 * pin (index.ts), where a non-integer value answers 410 before any route runs.
 */
function seasonScopedList(table: string, fks: string[]): RequestHandler {
  return (req, res) => {
    const where = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    for (const fk of fks) {
      const val = req.query[fk];
      if (val === undefined || val === '') continue;
      if (typeof val !== 'string') throw new HttpError(400, 'Ungültiger Filterparameter');
      where.push(`${fk} = ?`);
      params.push(val);
    }
    if (req.query.scope === 'season') where.push(fks.map((fk) => `${fk} IS NULL`).join(' AND '));
    res.json(
      getDb()
        .prepare(`SELECT * FROM ${table} WHERE ${where.join(' AND ')} ORDER BY sort_order ASC, id ASC`)
        .all(...params),
    );
  };
}

export const contactsRouter = crudRouter({
  table: 'contacts',
  writable: ['artist_id', 'project_id', 'role', 'name', 'email', 'phone', 'notes', 'color', 'sort_order'],
  required: ['name'],
  order: 'sort_order ASC, id ASC',
  customList: seasonScopedList('contacts', ['artist_id', 'project_id']),
});

export const linksRouter = crudRouter({
  table: 'links',
  writable: ['artist_id', 'project_id', 'event_id', 'task_id', 'section_id', 'label', 'url', 'color', 'category', 'notes', 'sort_order'],
  required: ['label'],
  order: 'sort_order ASC, id ASC',
  customList: seasonScopedList('links', ['artist_id', 'project_id', 'event_id', 'task_id', 'section_id']),
});

/**
 * User-added widget sections (WP-S). `type` stays writable on PATCH like every other column
 * (crudRouter has one allowlist for create+patch); the client never changes it after create.
 * The list is custom because the dashboard scope means "both parents NULL", which the
 * equality-only `filters` can't express.
 */
export const customSectionsRouter = crudRouter({
  table: 'custom_sections',
  writable: ['artist_id', 'project_id', 'name', 'type', 'value', 'sort_order'],
  required: ['name', 'type'],
  order: 'sort_order ASC, id ASC',
  customList: (req, res) => {
    const where = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    const artistId = num(req.query.artist_id);
    const projectId = num(req.query.project_id);
    if (artistId !== undefined) {
      where.push('artist_id = ?');
      params.push(artistId);
    }
    if (projectId !== undefined) {
      where.push('project_id = ?');
      params.push(projectId);
    }
    if (req.query.scope === 'dashboard') where.push('artist_id IS NULL AND project_id IS NULL');
    res.json(
      getDb()
        .prepare(`SELECT * FROM custom_sections WHERE ${where.join(' AND ')} ORDER BY sort_order ASC, id ASC`)
        .all(...params),
    );
  },
});

/** Column types whose `options` hold editable coloured categories. */
const OPTION_TYPES = new Set(['select', 'status', 'priority']);

interface ColumnOption {
  label?: unknown;
  value?: unknown;
}

/**
 * Read a request's `options` as an array. The crud factory stringifies JSON columns *after*
 * the transform, so the value here is still whatever the client sent — normally an array,
 * but a hand-rolled request may send the JSON text.
 */
function readOptions(raw: unknown): ColumnOption[] {
  if (Array.isArray(raw)) return raw as ColumnOption[];
  if (typeof raw === 'string') {
    try {
      const v: unknown = JSON.parse(raw);
      if (Array.isArray(v)) return v as ColumnOption[];
    } catch {
      /* fall through to the 400 below */
    }
  }
  throw new HttpError(400, 'Ungültige Kategorien.');
}

/**
 * The parent FK each scope carries — the route's half of the schema CHECK (WP-51, #58). A column
 * belongs to the whole season, to one artist or to one project, and „belongs to" is spelled twice:
 * in `scope`, which every list filters on, and in the FK, which the cascade and the season copy
 * follow. The two disagreeing is the failure this table prevents — a `scope = 'project'` row with
 * no project_id used to be accepted and was then invisible in every list, because each one binds
 * the scope and the parent id together.
 */
const SCOPE_PARENT = {
  global: null,
  artist: 'artist_id',
  project: 'project_id',
} as const;
type ColumnScope = keyof typeof SCOPE_PARENT;

function isColumnScope(v: unknown): v is ColumnScope {
  return typeof v === 'string' && Object.hasOwn(SCOPE_PARENT, v);
}

/**
 * Reject a scope that names no parent, or names the wrong one. Runs on the merged payload, so a
 * PATCH that moves only one half of the pair is judged against the half already stored.
 */
function checkScopeParent(scope: unknown, artistId: unknown, projectId: unknown): void {
  if (!isColumnScope(scope)) throw new HttpError(400, 'Unbekannter Spalten-Bereich.');
  const parents = { artist_id: artistId, project_id: projectId };
  const owner = SCOPE_PARENT[scope];
  for (const [fk, value] of Object.entries(parents)) {
    const set = value !== undefined && value !== null && value !== '';
    if (fk === owner && !set) throw new HttpError(400, 'Dieser Spalten-Bereich braucht ein Elternteil.');
    if (fk !== owner && set) throw new HttpError(400, 'Diese Spalte hängt am falschen Elternteil.');
  }
}

const columnsCrud = crudRouter({
  table: 'custom_columns',
  writable: ['name', 'type', 'scope', 'artist_id', 'project_id', 'options', 'icon', 'enabled', 'deletable', 'sort_order'],
  required: ['name', 'type'],
  filters: ['scope', 'artist_id', 'project_id'],
  jsonColumns: ['options'],
  order: 'sort_order ASC, id ASC',
  /**
   * The server-side half of the option invariants the editor enforces (FIX-03). `options` is a
   * plain writable column, so the client guard alone is not enough — a stale tab, a script or a
   * future importer can PATCH a set that leaves the column unusable.
   *
   * Deliberately *not* checked here: that a Status column carries a `done` flag. Legacy seasons
   * store option sets that predate the flag entirely, and copySeasonData/importers write those
   * rows directly with SQL; rejecting them at the route would 400 an edit to data the app itself
   * produced. Requiring the flag is the editor's job (TTU-01), where the user can supply it.
   */
  transform: (body, { mode, existing }) => {
    // The scope/parent pair, judged on create and on any PATCH that touches either half. A create
    // that names no scope takes the column DEFAULT, which is the global one, so it is checked
    // against that rather than skipped.
    const touchesScope = 'scope' in body || 'artist_id' in body || 'project_id' in body;
    if (mode === 'create' || touchesScope) {
      const at = (key: string): unknown => (key in body ? body[key] : existing?.[key]);
      checkScopeParent(
        'scope' in body ? body.scope : (existing?.scope ?? 'global'),
        at('artist_id'),
        at('project_id'),
      );
    }
    if (!('options' in body) || body.options == null) return body;
    const type = String(body.type ?? existing?.type ?? '');
    if (!OPTION_TYPES.has(type)) return body;
    const options = readOptions(body.options);
    // Built-in option columns (Status, Priorität) with no categories are unrecoverable from the
    // UI, and ensureBuiltinColumns() only inserts *missing* built-ins, so nothing restores them
    // on the next launch. `kind` is not client-writable, so a create is always custom (TTU-02).
    const kind = mode === 'update' ? String(existing?.kind ?? 'custom') : 'custom';
    if (kind === 'builtin' && options.length === 0) {
      throw new HttpError(400, 'Diese Spalte braucht mindestens eine Kategorie.');
    }
    // `value` is the identity key every consumer resolves an option by, so duplicates make two
    // categories indistinguishable and let doneValueOf pick the wrong one of a pair (TTU-09).
    const seen = new Set<string>();
    for (const o of options) {
      const value = typeof o.value === 'string' ? o.value.trim() : '';
      if (!value) throw new HttpError(400, 'Jede Kategorie braucht einen Wert.');
      if (seen.has(value)) throw new HttpError(400, 'Kategorie-Werte müssen eindeutig sein.');
      seen.add(value);
    }
    return body;
  },
});

/**
 * A scoped list has to name its parent. `?scope=project` alone used to return *every* project's
 * columns — a set that belongs to no one page and that a caller merging it with the globals would
 * render on the wrong task table (#58). The crud factory's list handler is generic, so the guard
 * sits in front of it rather than inside it.
 */
export const customColumnsRouter = Router();
customColumnsRouter.get('/', (req, _res, next) => {
  const scope = req.query.scope;
  if (scope === undefined || scope === '') return next();
  if (!isColumnScope(scope)) throw new HttpError(400, 'Unbekannter Spalten-Bereich.');
  const owner = SCOPE_PARENT[scope];
  if (owner && !num(req.query[owner])) {
    throw new HttpError(400, 'Dieser Spalten-Bereich braucht ein Elternteil.');
  }
  next();
});
customColumnsRouter.use(columnsCrud);

/** A completion date the server itself wrote: `YYYY-MM-DD`, optionally with a time. */
const ERLEDIGT_AM_SHAPE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}:\d{2})?$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Whether a body's `erledigt_am` is the undo stack restoring a value this transform destroyed,
 * as opposed to a client trying to set the completion date directly.
 *
 * The undo path (client hooks.ts `useUndoablePatch`, whose `DERIVED_INVERSE_KEYS` carries
 * `erledigt_am` in every tasks inverse) always sends the pair, and the pair always agrees:
 * re-completing a task restores its old date, reopening one restores null. Anything else is
 * dropped so the derivation below stays the only authority. Without this gate a lone
 * `PATCH {erledigt_am:'2020-01-01'}` was stored verbatim and the task vanished straight into
 * the archive, and a `{status:<open>, erledigt_am:<date>}` pair left a reopened task carrying a
 * completion date (SDL-02).
 */
function acceptsErledigtAm(body: Record<string, unknown>, done: string): boolean {
  if (!('status' in body)) return false;
  const v = body.erledigt_am;
  if (v === null) return body.status !== done;
  return typeof v === 'string' && ERLEDIGT_AM_SHAPE.test(v) && body.status === done;
}

/** When a task flips to erledigt, stamp erledigt_am; when reopened, clear it. Server-controlled. */
export const tasksRouter = crudRouter({
  table: 'tasks',
  writable: [
    'artist_id',
    'project_id',
    'title',
    'status',
    'priority',
    'due_date',
    'comment',
    'color',
    'custom_values',
    'parent_id',
    'sort_order',
    // Deliberate exception to "the allowlist is the single authority on what a client may set":
    // the undo stack has to be able to put the *original* completion date back. Without it,
    // undoing a status flip re-stamps erledigt_am with today, which silently un-archives a task
    // that had aged past ARCHIVE_AFTER_DAYS. Normal edits never send it, and the transform's
    // acceptsErledigtAm() gate drops anything that isn't that undo (SDL-02).
    'erledigt_am',
  ],
  required: ['title'],
  jsonColumns: ['custom_values'],
  transform: (body, { mode, existing }) => {
    // Subtasks are one level deep. The „＋ Unteraufgabe" button enforces it too (TTU-15), but a
    // button is not an invariant: the affordance was previously gated on render position, which
    // let an orphan grow a third level, and a stale tab or a script can post whatever it likes.
    // Checked on create as well, which is where the composer builds subtasks (TTU-37).
    //
    // Deliberately not retroactive: it fires only when `parent_id` is in the payload, so ordinary
    // edits to a deep tree that arrived by import still work, and nothing is migrated.
    if ('parent_id' in body && body.parent_id != null) {
      const target = getDb()
        .prepare('SELECT parent_id FROM tasks WHERE id = ?')
        .get(Number(body.parent_id)) as { parent_id: number | null } | undefined;
      if (target?.parent_id != null) {
        throw new HttpError(400, 'Unteraufgaben können keine weiteren Unteraufgaben haben.');
      }
    }
    // A task may not be its own ancestor. On update, reject setting parent_id to the task
    // itself or to any descendant of it — either closes a cycle the client tree renderer (and
    // every recursive walk) can't handle. Create needs no check: the new row has no id yet, so
    // no cycle can pass through it (SRV-11).
    if (mode === 'update' && existing && 'parent_id' in body && body.parent_id != null) {
      const selfId = Number(existing.id);
      const proposed = Number(body.parent_id);
      if (proposed === selfId) {
        throw new HttpError(400, 'Eine Aufgabe kann sich nicht selbst untergeordnet werden.');
      }
      const parentOf = getDb().prepare('SELECT parent_id FROM tasks WHERE id = ?');
      const seen = new Set<number>();
      let cursor: number | null = proposed;
      while (cursor != null) {
        if (cursor === selfId) {
          throw new HttpError(400, 'Eine Aufgabe kann keiner ihrer Unteraufgaben untergeordnet werden.');
        }
        if (seen.has(cursor)) break; // defensive: don't loop on a pre-existing cycle elsewhere
        seen.add(cursor);
        const row = parentOf.get(cursor) as { parent_id: number | null } | undefined;
        cursor = row?.parent_id ?? null;
      }
    }
    // `custom_values` as an **object** is a patch of the named keys; as a **string** it replaces
    // the blob verbatim. The distinction is what makes concurrent cell edits safe: the client
    // used to read-modify-write the whole blob from the task it had rendered, so ticking
    // „Vertrag" and then „Bezahlt" before the first refetch landed sent a pre-„Vertrag" snapshot
    // and silently un-ticked it again (TTU-23). The freshest blob is the row's own, so the merge
    // belongs here.
    //
    // The string arm is not a leftover: `useUndoablePatch` builds its inverse by picking keys off
    // the pre-edit row, where `custom_values` is the raw JSON *string*, and undo has to put the
    // whole blob back rather than merge into whatever the row holds now.
    if (mode === 'update' && existing && isPlainObject(body.custom_values)) {
      body.custom_values = { ...parseCustomValues(existing.custom_values), ...body.custom_values };
    }
    // A status-less create defaults to 'new' (the first Status option). Stamped here so it
    // holds on every DB: the SQL column DEFAULT is stale ('offen') on databases predating the
    // New/Active/Done model, and is never reached once the transform sets the value (SRV-07).
    // Any blank value defaults, not just null/undefined: tasks.status is NOT NULL but carries no
    // value CHECK, so an explicit '' used to persist — a task with no status badge, counted open
    // forever and never archiving, because neither the done comparison nor the archive query can
    // ever match it. A PATCH cannot blank it either (SDL-05). Validating against the configured
    // Status options is FIX-03's job.
    if (mode === 'create' && !body.status) body.status = 'new';
    if (mode === 'update' && 'status' in body && !body.status) {
      throw new HttpError(400, 'Status darf nicht leer sein.');
    }
    // „Eine neue Aufgabe steht ganz oben." Without this the row keeps the column default 0, ties
    // with every other never-dragged sibling, and the `id` tiebreak — highest — puts the newest
    // one *last* (WP-32). Server-side because the client knows only its rendered siblings: it
    // never sees archived rows and cannot see the trash at all.
    if (mode === 'create' && body.sort_order == null) {
      body.sort_order = leadingSortOrder(getDb(), body.artist_id, body.project_id);
    }
    if ('erledigt_am' in body || 'status' in body) {
      const done = doneStatusValue(getDb());
      // An accepted erledigt_am wins over the derivation: that is the undo path restoring a
      // value this transform itself destroyed. Checked first so a legitimate status +
      // erledigt_am pair isn't reverted; anything else loses the key and falls through to the
      // derivation, which is then the sole authority (SDL-02).
      if ('erledigt_am' in body) {
        if (acceptsErledigtAm(body, done)) return body;
        delete body.erledigt_am;
      }
      // Stamp/clear erledigt_am against the Status column's editable "done" value.
      if ('status' in body) {
        if (body.status === done) {
          // SQLite space format (YYYY-MM-DD HH:MM:SS), matching deleted_at, so the string
          // compare in queries.ts (erledigt_am <= datetime('now', …)) is exact rather than off
          // by the T-vs-space sort of an ISO string (SRV-08) — and in *local* time, because
          // this is the calendar day the archive and the .xlsx export report as "Erledigt am".
          // A UTC stamp named the previous day for every task ticked off between local midnight
          // and the offset (SDL-07).
          if (mode === 'create' || !existing?.erledigt_am) {
            body.erledigt_am = localStamp();
          }
        } else {
          body.erledigt_am = null;
        }
      }
    }
    return body;
  },
  customList: (req, res) => {
    res.json(
      listTasks(getDb(), {
        projectId: num(req.query.project_id),
        artistId: num(req.query.artist_id),
        resolvedArtistId: num(req.query.resolved_artist_id),
        scope: scopeParam(req.query.scope),
        order: orderParam(req.query.order),
      }),
    );
  },
});

/**
 * One below the lowest `sort_order` in the list this task will appear in — so a created task
 * leads it (WP-32). Empty scope: 0.
 *
 * **The scope is the `(artist_id, project_id)` pair, and deliberately not `parent_id` as well.**
 * The obvious "exact sibling list" version has a reachable tie: a subtask whose parent is
 * soft-deleted is *promoted* into the top-level list by the client (TTU-14) while still carrying
 * `parent_id`, so a `parent_id IS NULL` minimum cannot see the very row the new task renders
 * above — and the `id` tiebreak then hands the orphan the top. The pair is a lower bound over
 * every row that can render in that table, which is what "always on top" actually needs. The
 * tasks CHECK allows at most one of the two, so the pair is effectively one scope id.
 *
 * **`IS`, never `=`.** `project_id = NULL` is NULL rather than true, so `=` matches nothing for
 * the season-wide „Festival" todos, hands every one of them the same ordinal and lets `id`
 * decide — i.e. it reproduces exactly the bug this fixes, for exactly one list.
 *
 * **No `deleted_at` and no archive filter.** A trashed row returns with its old ordinal via
 * `/restore`, an archived one the moment its status is reopened; counting them is what stops
 * either from coming back tied with the new task. Every row in the scope counts.
 *
 * Repeated creates walk the ordinals negative. That is fine — `/reorder` renumbers a dragged
 * group back to 0..n-1, the column is a 64-bit integer, and nothing reads the value itself.
 */
function leadingSortOrder(
  db: ReturnType<typeof getDb>,
  artistId: unknown,
  projectId: unknown,
): number {
  // Only a real row id scopes the lookup. `Number('')` is 0 and finite, so a lax check read
  // `{artist_id: ''}` as artist 0 — a scope that matches nothing — and handed the task
  // `sort_order = 0`, tied with every never-dragged sibling: the WP-32 bug, reintroduced for
  // exactly the caller that already sends the sloppy value.
  const id = (v: unknown): number | null => {
    const n = Number(v);
    return v != null && v !== '' && Number.isInteger(n) && n > 0 ? n : null;
  };
  const row = db
    .prepare('SELECT MIN(sort_order) AS m FROM tasks WHERE artist_id IS ? AND project_id IS ?')
    .get(id(artistId), id(projectId)) as { m: number | null };
  return row.m == null ? 0 : row.m - 1;
}

/* ---------- subtree operations ---------- */

/**
 * A task plus its live descendants, breadth-first over `parent_id`.
 *
 * Soft-deleted rows are neither included nor descended through, matching what the UI shows: a
 * trashed task is invisible everywhere but the Papierkorb, its children render as top-level rows,
 * and a later restore behaves like any other restore-after-edit. Archived rows *are* included —
 * they are live data that merely left the default view, and leaving them behind is how a subtree
 * operation strands them (TTU-05).
 */
function liveSubtreeIds(db: ReturnType<typeof getDb>, rootId: number): number[] {
  const children = db.prepare('SELECT id FROM tasks WHERE parent_id = ? AND deleted_at IS NULL');
  const ids = [rootId];
  const seen = new Set([rootId]);
  // Defensive against a pre-existing cycle in imported data: `seen` bounds the walk.
  for (let i = 0; i < ids.length; i++) {
    for (const row of children.all(ids[i]) as Array<{ id: number }>) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      ids.push(row.id);
    }
  }
  return ids;
}

/** A body field that names a row or is explicitly absent. Anything else is a 400, never a NULL. */
function nullableId(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  throw new HttpError(400, 'Ungültiges Ziel.');
}

function requireLive(table: 'artists' | 'projects', id: number): void {
  const row = getDb()
    .prepare(`SELECT 1 FROM ${table} WHERE id = ? AND deleted_at IS NULL`)
    .get(id);
  if (!row) throw new HttpError(400, 'Das Ziel gibt es nicht mehr.');
}

/**
 * A `parent_id` target only has to *exist*, not be live — which is the difference between this
 * and `requireLive`. An orphan is a subtask whose parent is soft-deleted, and undoing its move
 * has to put that exact `parent_id` back; refusing it would make the undo fail with „Das Ziel
 * gibt es nicht mehr." and strand the row in the scope the user had just reverted.
 */
function requireParentExists(id: number): void {
  if (!getDb().prepare('SELECT 1 FROM tasks WHERE id = ?').get(id)) {
    throw new HttpError(400, 'Die übergeordnete Aufgabe gibt es nicht mehr.');
  }
}

/**
 * Move a task and its whole live subtree to another scope, in one transaction.
 *
 * It replaces a `Promise.all` of independent PATCHes that had no `catch`: a single failed request
 * left the tree split across two scopes, showed no error, and never reached the `pushWithToast`
 * that would have made it revertible — so some rows sat in the new project, the rest in the old
 * one, and nothing could put them back (TTU-03).
 *
 * All four placement fields are explicit and always written, so the *same* endpoint is the
 * revert: the client posts the prior placement it got back in `before`. Descendants follow the
 * root's scope and keep their own `parent_id`. A legacy tree whose children sat in a different
 * scope than their parent is therefore normalised to the root's — which the forward move already
 * did, and which is the consistent state anyway.
 *
 * **`sort_order` is the fourth field, and it has to be.** An ordinal only means something inside
 * one artist/project list — a hand-dragged list holds 0..n-1, a composer-only one 0, -1, -2 — and
 * since WP-32 it is the only thing ordering rows of equal rank. Carrying the old number into the
 * new scope dropped the moved task at an arbitrary spot: below every open row in one direction,
 * above the row the user had deliberately dragged to the top in the other. A move with no
 * `sort_order` therefore lands the task at the head of its destination, like a new one; undo
 * passes the captured value back and restores the exact slot. Children keep theirs — they are
 * only ever compared with their own siblings, whose relative order the move does not touch.
 */
tasksRouter.post('/:id/move', (req, res) => {
  const db = getDb();
  const rootId = Number(req.params.id);
  const root = db.prepare('SELECT id FROM tasks WHERE id = ? AND deleted_at IS NULL').get(rootId);
  if (!root) return res.status(404).json({ error: 'not found' });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const artistId = nullableId(body.artist_id);
  const projectId = nullableId(body.project_id);
  const parentId = nullableId(body.parent_id);
  // The tasks CHECK allows at most one of the two, which is why the client sends the pair in one
  // request rather than splitting them.
  if (artistId !== null && projectId !== null) {
    throw new HttpError(400, 'Eine Aufgabe gehört entweder zu einem Künstler oder zu einem Projekt.');
  }
  if (artistId !== null) requireLive('artists', artistId);
  if (projectId !== null) requireLive('projects', projectId);

  const ids = liveSubtreeIds(db, rootId);
  if (parentId !== null) {
    requireParentExists(parentId);
    // Same invariant as the crud transform's cycle guard, expressed against the closure we
    // already walked: a task may not be moved under itself or under one of its own descendants.
    if (ids.includes(parentId)) {
      throw new HttpError(400, 'Eine Aufgabe kann keiner ihrer Unteraufgaben untergeordnet werden.');
    }
  }

  // An explicit sort_order is the undo putting the captured slot back; its absence means „place
  // it like a new task", which is what a forward move from the dialog sends.
  const placement = body.sort_order;
  if (placement != null && !Number.isInteger(Number(placement))) {
    throw new HttpError(400, 'Ungültige Reihenfolge.');
  }

  const select = db.prepare(
    'SELECT id, artist_id, project_id, parent_id, sort_order FROM tasks WHERE id = ?',
  );
  const moveRoot = db.prepare(
    `UPDATE tasks SET artist_id = ?, project_id = ?, parent_id = ?, sort_order = ?, updated_at = datetime('now', 'localtime')
     WHERE id = ?`,
  );
  const moveChild = db.prepare(
    `UPDATE tasks SET artist_id = ?, project_id = ?, updated_at = datetime('now', 'localtime')
     WHERE id = ?`,
  );
  const before = db.transaction(() => {
    // One statement per id rather than an IN-list: a subtree is small, but the bound-parameter
    // ceiling is the kind of limit this codebase has been bitten by before (DBW-02).
    const prior = ids.map((id) => select.get(id));
    // Read before the UPDATE, so the row's own outgoing ordinal cannot be the minimum it is
    // measured against — except when the target *is* where it already sits, where landing on top
    // is the honest answer to a move the user asked for anyway.
    const sortOrder =
      placement != null ? Number(placement) : leadingSortOrder(db, artistId, projectId);
    moveRoot.run(artistId, projectId, parentId, sortOrder, rootId);
    for (const id of ids.slice(1)) moveChild.run(artistId, projectId, id);
    return prior;
  })();
  res.json({ ids, before });
});

/**
 * Soft-delete a task and its whole live subtree in one transaction.
 *
 * The client used to do this as `Promise.all` of one DELETE per row, over a child list derived
 * from the *rendered* table: a request that failed part-way left the tree half-deleted with no
 * toast and no undo entry (TTU-35), and archived children and grandchildren were never in the
 * list to begin with, so „+ N Unteraufgaben löschen" left them behind as rows no delete
 * affordance could reach (TTU-05). One transaction over the server's own closure answers both.
 *
 * Responds in `crudRouter`'s delete shape (`deleted: false` rather than a 404 when there was
 * nothing to take), because `useUndoableDelete`'s `nothingDeleted()` reads exactly that.
 */
tasksRouter.delete('/:id/tree', (req, res) => {
  const db = getDb();
  const rootId = Number(req.params.id);
  const root = db.prepare('SELECT id FROM tasks WHERE id = ? AND deleted_at IS NULL').get(rootId);
  if (!root) return res.json({ ids: [], deleted: false });
  const stmt = db.prepare(
    `UPDATE tasks SET deleted_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime')
     WHERE id = ? AND deleted_at IS NULL`,
  );
  const ids = liveSubtreeIds(db, rootId);
  const removed = db.transaction(() => ids.filter((id) => stmt.run(id).changes > 0))();
  res.json({ ids: removed, deleted: removed.length > 0 });
});

/**
 * Restore exactly the rows a tree delete took — the ids it answered with, posted back.
 *
 * Not „restore the closure": a descendant that was already in the Papierkorb before the cascade
 * must stay there, and the undo of a delete may never resurrect something the user trashed
 * separately. Ids that no longer exist are skipped rather than 404ing, so an undo still works
 * after `purgeExpired()` has taken one of them. `:id` names the root the set came from.
 */
tasksRouter.post('/:id/tree/restore', (req, res) => {
  const ids = (req.body as { ids?: unknown } | undefined)?.ids;
  const isRowId = (id: unknown): id is number =>
    typeof id === 'number' && Number.isInteger(id) && id > 0;
  if (!Array.isArray(ids) || !ids.every(isRowId)) {
    throw new HttpError(400, 'ids must be a list of row ids');
  }
  const db = getDb();
  const stmt = db.prepare(
    `UPDATE tasks SET deleted_at = NULL, updated_at = datetime('now', 'localtime') WHERE id = ?`,
  );
  const restored = db.transaction(() => ids.filter((id) => stmt.run(id).changes > 0))();
  res.json({ ids: restored });
});

export const eventsRouter = crudRouter({
  table: 'events',
  writable: [
    'artist_id',
    'project_id',
    'type',
    'title',
    'start_at',
    'end_at',
    'all_day',
    'location',
    'notes',
    'sort_order',
  ],
  // start_at is optional: NULL means "Datum offen" (TBD), rendered as a label client-side.
  required: ['type', 'title'],
  customList: (req, res) => {
    res.json(
      listEvents(getDb(), {
        projectId: num(req.query.project_id),
        artistId: num(req.query.artist_id),
        resolvedArtistId: num(req.query.resolved_artist_id),
        // `scope=season`, not `?season=` — see seasonScopedList above.
        season: req.query.scope === 'season',
      }),
    );
  },
});

// "Termin duplizieren" — copies an event (same parent/times) with a "(Kopie)" title suffix.
eventsRouter.post('/:id/duplicate', (req, res) => {
  const db = getDb();
  const src = db
    .prepare('SELECT * FROM events WHERE id = ? AND deleted_at IS NULL')
    .get(req.params.id) as Record<string, unknown> | undefined;
  if (!src) return res.status(404).json({ error: 'not found' });
  const info = db
    .prepare(
      // Stamped explicitly, like every other insert path: a pre-FIX-06 database still carries
      // the old UTC `datetime('now')` DEFAULT, which SQLite cannot alter in place.
      `INSERT INTO events (artist_id, project_id, type, title, start_at, end_at, all_day, location, notes, sort_order,
                           created_at, updated_at)
       VALUES (@artist_id, @project_id, @type, @title, @start_at, @end_at, @all_day, @location, @notes, @sort_order,
               datetime('now', 'localtime'), datetime('now', 'localtime'))`,
    )
    .run({
      artist_id: src.artist_id,
      project_id: src.project_id,
      type: src.type,
      title: `${src.title} (Kopie)`,
      start_at: src.start_at,
      end_at: src.end_at,
      all_day: src.all_day,
      location: src.location,
      notes: src.notes,
      sort_order: src.sort_order,
    });
  res.status(201).json(db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid));
});
