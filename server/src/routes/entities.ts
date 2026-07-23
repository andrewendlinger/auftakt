import { doneStatusValue, getDb } from '../db';
import { crudRouter } from '../lib/crud';
import { listEvents, listTasks } from '../lib/queries';
// Coerce a query param to a number. COALESCE()-based filters lose column affinity, so string
// params never match integer ids — pass real numbers; an invalid value is now a 400, not a
// silently-dropped filter that returned every row (SRV-09).
import { HttpError, numParam as num } from '../lib/query';

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
    // A status-less create defaults to 'new' (the first Status option). Stamped here so it
    // holds on every DB: the SQL column DEFAULT is stale ('offen') on databases predating the
    // New/Active/Done model, and is never reached once the transform sets the value (SRV-07).
    if (mode === 'create') body.status ??= 'new';
    // An explicit erledigt_am wins over the derivation: that is the undo path restoring a value
    // this transform itself destroyed. Checked first so a status+erledigt_am pair isn't reverted.
    if ('erledigt_am' in body) return body;
    // Stamp/clear erledigt_am against the Status column's editable "done" value.
    if ('status' in body) {
      const done = doneStatusValue(getDb());
      if (body.status === done) {
        // SQLite space format (YYYY-MM-DD HH:MM:SS), matching demo.ts stamp() and deleted_at, so
        // the string compare in queries.ts (erledigt_am <= datetime('now', '-N days')) is exact
        // rather than off by the T-vs-space sort of an ISO string (SRV-08).
        if (mode === 'create' || !existing?.erledigt_am) {
          body.erledigt_am = new Date().toISOString().slice(0, 19).replace('T', ' ');
        }
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
