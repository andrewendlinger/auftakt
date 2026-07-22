import { doneStatusValue, getDb } from '../db';
import { crudRouter } from '../lib/crud';
import { listEvents, listTasks } from '../lib/queries';

/** Coerce a query param to a number. COALESCE()-based filters lose column affinity,
 *  so string params never match integer ids — pass real numbers. */
function num(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

export const artistsRouter = crudRouter({
  table: 'artists',
  writable: ['name', 'color', 'notes', 'image', 'sort_order'],
  required: ['name'],
  order: 'sort_order ASC, name ASC',
});

export const projectsRouter = crudRouter({
  table: 'projects',
  writable: ['artist_id', 'code', 'name', 'status', 'description', 'notes', 'color', 'sort_order'],
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
  writable: ['artist_id', 'project_id', 'event_id', 'task_id', 'label', 'url', 'color', 'sort_order'],
  required: ['label'],
  filters: ['artist_id', 'project_id', 'event_id', 'task_id'],
  order: 'sort_order ASC, id ASC',
});

export const customColumnsRouter = crudRouter({
  table: 'custom_columns',
  writable: ['name', 'type', 'scope', 'project_id', 'options', 'icon', 'enabled', 'deletable', 'sort_order'],
  required: ['name', 'type'],
  filters: ['scope', 'project_id'],
  jsonColumns: ['options'],
  order: 'sort_order ASC, id ASC',
});

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
    // that had aged past ARCHIVE_AFTER_DAYS. Normal edits never send it — see the guard below.
    'erledigt_am',
  ],
  required: ['title'],
  jsonColumns: ['custom_values'],
  transform: (body, { mode, existing }) => {
    // An explicit erledigt_am wins over the derivation: that is the undo path restoring a value
    // this transform itself destroyed. Checked first so a status+erledigt_am pair isn't reverted.
    if ('erledigt_am' in body) return body;
    // Stamp/clear erledigt_am against the Status column's editable "done" value.
    if ('status' in body) {
      const done = doneStatusValue(getDb());
      if (body.status === done) {
        if (mode === 'create' || !existing?.erledigt_am) body.erledigt_am = new Date().toISOString();
      } else {
        body.erledigt_am = null;
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
        scope: (req.query.scope as 'live' | 'archive' | 'all' | undefined) ?? 'live',
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
  required: ['type', 'title', 'start_at'],
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
      `INSERT INTO events (artist_id, project_id, type, title, start_at, end_at, all_day, location, notes, sort_order)
       VALUES (@artist_id, @project_id, @type, @title, @start_at, @end_at, @all_day, @location, @notes, @sort_order)`,
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
