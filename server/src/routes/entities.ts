import { localStamp } from '../../../shared/time';
import { doneStatusValue, getDb } from '../db';
import { crudRouter } from '../lib/crud';
import { parseCustomValues } from '../lib/customValues';
import { listEvents, listTasks } from '../lib/queries';
// Coerce a query param to a number. COALESCE()-based filters lose column affinity, so string
// params never match integer ids — pass real numbers; an invalid value is now a 400, not a
// silently-dropped filter that returned every row (SRV-09).
import { HttpError, numParam as num, scopeParam } from '../lib/query';

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
 */
export const artistsRouter = crudRouter({
  table: 'artists',
  writable: ['name', 'color', 'notes', 'image', 'layout', 'sort_order'],
  required: ['name'],
  jsonColumns: ['layout'],
  order: 'sort_order ASC, name ASC',
});

export const projectsRouter = crudRouter({
  table: 'projects',
  writable: ['artist_id', 'code', 'name', 'status', 'description', 'color', 'layout', 'sort_order'],
  required: ['artist_id', 'code', 'name'],
  jsonColumns: ['layout'],
  filters: ['artist_id'],
  order: 'sort_order ASC, id ASC',
});

export const contactsRouter = crudRouter({
  table: 'contacts',
  writable: ['artist_id', 'project_id', 'role', 'name', 'email', 'phone', 'notes', 'color', 'sort_order'],
  required: ['name'],
  filters: ['artist_id', 'project_id'],
  order: 'sort_order ASC, id ASC',
});

export const linksRouter = crudRouter({
  table: 'links',
  writable: ['artist_id', 'project_id', 'event_id', 'task_id', 'section_id', 'label', 'url', 'color', 'category', 'notes', 'sort_order'],
  required: ['label'],
  filters: ['artist_id', 'project_id', 'event_id', 'task_id', 'section_id'],
  order: 'sort_order ASC, id ASC',
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

export const customColumnsRouter = crudRouter({
  table: 'custom_columns',
  writable: ['name', 'type', 'scope', 'project_id', 'options', 'icon', 'enabled', 'deletable', 'sort_order'],
  required: ['name', 'type'],
  filters: ['scope', 'project_id'],
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
      }),
    );
  },
});

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
 * All three placement fields are explicit and always written, so the *same* endpoint is the
 * revert: the client posts the prior placement it got back in `before`. Descendants follow the
 * root's scope and keep their own `parent_id`. A legacy tree whose children sat in a different
 * scope than their parent is therefore normalised to the root's — which the forward move already
 * did, and which is the consistent state anyway.
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

  const select = db.prepare('SELECT id, artist_id, project_id, parent_id FROM tasks WHERE id = ?');
  const moveRoot = db.prepare(
    `UPDATE tasks SET artist_id = ?, project_id = ?, parent_id = ?, updated_at = datetime('now', 'localtime')
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
    moveRoot.run(artistId, projectId, parentId, rootId);
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
