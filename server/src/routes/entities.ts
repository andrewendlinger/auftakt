import { localStamp } from '../../../shared/time';
import { doneStatusValue, getDb } from '../db';
import { crudRouter } from '../lib/crud';
import { parseCustomValues } from '../lib/customValues';
import { listEvents, listTasks } from '../lib/queries';
// Coerce a query param to a number. COALESCE()-based filters lose column affinity, so string
// params never match integer ids — pass real numbers; an invalid value is now a 400, not a
// silently-dropped filter that returned every row (SRV-09).
import { HttpError, numParam as num, scopeParam } from '../lib/query';

export const artistsRouter = crudRouter({
  table: 'artists',
  writable: ['name', 'color', 'notes', 'image', 'sort_order'],
  required: ['name'],
  order: 'sort_order ASC, name ASC',
});

export const projectsRouter = crudRouter({
  table: 'projects',
  writable: ['artist_id', 'code', 'name', 'status', 'description', 'color', 'sort_order'],
  required: ['artist_id', 'code', 'name'],
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
  writable: ['artist_id', 'project_id', 'event_id', 'task_id', 'section_id', 'label', 'url', 'color', 'category', 'sort_order'],
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
