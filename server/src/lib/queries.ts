import type Database from 'better-sqlite3';
import { ARCHIVE_AFTER_DAYS, doneStatusValue } from '../db';

/**
 * Denormalised task select: each task resolves to its owning artist (direct or via project).
 *
 * Both joins exclude soft-deleted parents. Without that, a trashed artist's tasks kept rendering
 * with its name and colour in every live list and in the .xlsx export — the artist card vanishes
 * from the dashboard but its tasks do not (SDL-03). Soft-delete marks a single row, so this is
 * the only place the relationship can be filtered.
 */
const TASK_SELECT = `
SELECT t.*,
  COALESCE(t.artist_id, p.artist_id) AS resolved_artist_id,
  a.name  AS artist_name,
  a.color AS artist_color,
  p.code  AS project_code,
  p.name  AS project_name,
  p.color AS project_color
FROM tasks t
LEFT JOIN projects p ON p.id = t.project_id AND p.deleted_at IS NULL
LEFT JOIN artists  a ON a.id = COALESCE(t.artist_id, p.artist_id) AND a.deleted_at IS NULL
`;

/**
 * …and the row goes with its parent: a task whose owning project or artist is in the trash is
 * not live data, so it leaves the live lists too rather than lingering unattributed. Rows with
 * no parent at all (season-wide "Festival" todos) are unaffected — both sides are NULL.
 * `parent_id` plays no part here, so an orphan subtask under a trashed parent task still shows.
 */
const TASK_PARENT_LIVE = `
  (t.project_id IS NULL OR p.id IS NOT NULL)
  AND (COALESCE(t.artist_id, p.artist_id) IS NULL OR a.id IS NOT NULL)`;

/** Open first, then by priority, then due date (nulls last); done tasks sink to the bottom.
 *  The done status value is parameterised (?) so it follows the editable Status column. */
const TASK_ORDER = `
ORDER BY (t.status = ?) ASC,
  CASE t.priority WHEN 'hoch' THEN 0 WHEN 'mittel' THEN 1 WHEN 'niedrig' THEN 2 ELSE 3 END ASC,
  (t.due_date IS NULL) ASC, t.due_date ASC, t.sort_order ASC, t.id ASC
`;

const archivedCond = (): string =>
  `(t.status = ? AND t.erledigt_am IS NOT NULL AND t.erledigt_am <= datetime('now', '-${ARCHIVE_AFTER_DAYS} days'))`;

export interface TaskQuery {
  projectId?: unknown;
  artistId?: unknown;
  resolvedArtistId?: unknown;
  scope?: 'live' | 'archive' | 'all';
}

export function listTasks(db: Database.Database, q: TaskQuery = {}): unknown[] {
  const done = doneStatusValue(db);
  const where = ['t.deleted_at IS NULL', TASK_PARENT_LIVE];
  const params: unknown[] = [];
  if (q.projectId != null) {
    where.push('t.project_id = ?');
    params.push(q.projectId);
  }
  if (q.artistId != null) {
    where.push('t.artist_id = ?');
    params.push(q.artistId);
  }
  if (q.resolvedArtistId != null) {
    where.push('COALESCE(t.artist_id, p.artist_id) = ?');
    params.push(q.resolvedArtistId);
  }
  const scope = q.scope ?? 'live';
  // The archive condition and the ORDER BY each bind the done value; keep param order aligned with the SQL.
  if (scope === 'live') {
    where.push(`NOT ${archivedCond()}`);
    params.push(done);
  } else if (scope === 'archive') {
    where.push(archivedCond());
    params.push(done);
  }
  params.push(done); // for TASK_ORDER's (t.status = ?)
  return db.prepare(`${TASK_SELECT} WHERE ${where.join(' AND ')} ${TASK_ORDER}`).all(...params);
}

/** Same shape as TASK_SELECT, same soft-deleted-parent filter and for the same reason (SDL-03). */
const EVENT_SELECT = `
SELECT e.*,
  COALESCE(e.artist_id, p.artist_id) AS resolved_artist_id,
  a.name  AS artist_name,
  a.color AS artist_color,
  p.code  AS project_code,
  p.name  AS project_name,
  p.color AS project_color
FROM events e
LEFT JOIN projects p ON p.id = e.project_id AND p.deleted_at IS NULL
LEFT JOIN artists  a ON a.id = COALESCE(e.artist_id, p.artist_id) AND a.deleted_at IS NULL
`;

const EVENT_PARENT_LIVE = `
  (e.project_id IS NULL OR p.id IS NOT NULL)
  AND (COALESCE(e.artist_id, p.artist_id) IS NULL OR a.id IS NOT NULL)`;

const EVENT_ORDER = 'ORDER BY e.start_at ASC, e.id ASC';

export interface EventQuery {
  projectId?: unknown;
  artistId?: unknown;
  resolvedArtistId?: unknown;
}

export function listEvents(db: Database.Database, q: EventQuery = {}): unknown[] {
  const where = ['e.deleted_at IS NULL', EVENT_PARENT_LIVE];
  const params: unknown[] = [];
  if (q.projectId != null) {
    where.push('e.project_id = ?');
    params.push(q.projectId);
  }
  if (q.artistId != null) {
    where.push('e.artist_id = ?');
    params.push(q.artistId);
  }
  if (q.resolvedArtistId != null) {
    where.push('COALESCE(e.artist_id, p.artist_id) = ?');
    params.push(q.resolvedArtistId);
  }
  return db.prepare(`${EVENT_SELECT} WHERE ${where.join(' AND ')} ${EVENT_ORDER}`).all(...params);
}

/** Events overlapping the window [today, today+days] — includes currently-running multi-day events. */
export function eventsWithin(db: Database.Database, days: number): unknown[] {
  return db
    .prepare(
      `${EVENT_SELECT}
       WHERE e.deleted_at IS NULL AND ${EVENT_PARENT_LIVE}
         AND date(e.start_at) <= date('now', ?)
         AND date(COALESCE(e.end_at, e.start_at)) >= date('now')
       ${EVENT_ORDER}`,
    )
    .all(`+${days} days`);
}

/** The next few events starting beyond the window — keeps the dashboard useful year-round. */
export function eventsBeyond(db: Database.Database, days: number, limit: number): unknown[] {
  return db
    .prepare(
      `${EVENT_SELECT}
       WHERE e.deleted_at IS NULL AND ${EVENT_PARENT_LIVE} AND date(e.start_at) > date('now', ?)
       ${EVENT_ORDER} LIMIT ?`,
    )
    .all(`+${days} days`, limit);
}
