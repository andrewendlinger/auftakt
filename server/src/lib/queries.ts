import type Database from 'better-sqlite3';
import { ARCHIVE_AFTER_DAYS, doneStatusValue, priorityValues } from '../db';
import type { TaskScope } from './query';

/**
 * The parent joins for any table whose rows hang off a project and/or an artist.
 *
 * Both exclude soft-deleted parents. Without that, a trashed artist's tasks kept rendering with its
 * name and colour in every live list and in the .xlsx export — the artist card vanishes from the
 * dashboard but its tasks do not (SDL-03). Soft-delete marks a single row, so this is the only
 * place the relationship can be filtered. `alias` is always a literal from this module or a route,
 * never user input.
 */
export const parentJoins = (alias: string): string => `
LEFT JOIN projects p ON p.id = ${alias}.project_id AND p.deleted_at IS NULL
LEFT JOIN artists  a ON a.id = COALESCE(${alias}.artist_id, p.artist_id) AND a.deleted_at IS NULL`;

/**
 * …and the row goes with its parent: a task whose owning project or artist is in the trash is
 * not live data, so it leaves the live lists too rather than lingering unattributed. Rows with
 * no parent at all (season-wide "Festival" todos) are unaffected — both sides are NULL.
 * `parent_id` plays no part here, so an orphan subtask under a trashed parent task still shows.
 *
 * Paired with `parentJoins(alias)`, which is what makes `p`/`a` NULL for a trashed parent. Global
 * search reaches for both so its hits cannot outlive the lists they link to (SHL-07).
 */
export const parentLive = (alias: string): string => `
  (${alias}.project_id IS NULL OR p.id IS NOT NULL)
  AND (COALESCE(${alias}.artist_id, p.artist_id) IS NULL OR a.id IS NOT NULL)`;

/** Denormalised task select: each task resolves to its owning artist (direct or via project). */
const TASK_SELECT = `
SELECT t.*,
  COALESCE(t.artist_id, p.artist_id) AS resolved_artist_id,
  a.name  AS artist_name,
  a.color AS artist_color,
  p.code  AS project_code,
  p.name  AS project_name,
  p.color AS project_color
FROM tasks t${parentJoins('t')}
`;

const TASK_PARENT_LIVE = parentLive('t');

/**
 * Open first, then by priority, then due date (nulls last); done tasks sink to the bottom. Both
 * categories are parameterised, so the ordering follows the editable Status and Priorität columns.
 *
 * The priority CASE used to be a hardcoded hoch/mittel/niedrig ladder. Rename those options — the
 * column manager allows it — and every task fell into ELSE while the client ranked them 0..n by
 * the configured order, so the two disagreed about which rows were of equal rank: with an empty
 * sort hierarchy, `canDrop` could refuse a drop the server considered a tie.
 *
 * One bound param per option, and an unknown or empty priority sorts last, as it always did.
 */
const taskOrder = (priorities: string[]): string => {
  // `CASE x END` with no WHEN is a syntax error, so an empty ladder degrades to "all equal".
  const rank = priorities.length
    ? `CASE t.priority ${priorities.map((_, i) => `WHEN ? THEN ${i}`).join(' ')} ELSE ${priorities.length} END`
    : '0';
  return `
ORDER BY (t.status = ?) ASC,
  ${rank} ASC,
  (t.due_date IS NULL) ASC, t.due_date ASC, t.sort_order ASC, t.id ASC
`;
};

/** 'localtime' because erledigt_am is a naive local stamp — a UTC cutoff compares two clocks. */
const archivedCond = (): string =>
  `(t.status = ? AND t.erledigt_am IS NOT NULL AND t.erledigt_am <= datetime('now', 'localtime', '-${ARCHIVE_AFTER_DAYS} days'))`;

export interface TaskQuery {
  projectId?: unknown;
  artistId?: unknown;
  resolvedArtistId?: unknown;
  scope?: TaskScope;
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
  // Exhaustive by construction: anything that is not exactly 'archive' or 'all' hides the
  // archive. scopeParam() already rejects unknown values at the route boundary, but this is the
  // function every caller reaches, and falling through to "no archive condition" put aged-out
  // tasks back into the live table (SDL-04).
  const scope: TaskScope = q.scope === 'archive' || q.scope === 'all' ? q.scope : 'live';
  // The archive condition and the ORDER BY each bind the done value; keep param order aligned with the SQL.
  if (scope === 'live') {
    where.push(`NOT ${archivedCond()}`);
    params.push(done);
  } else if (scope === 'archive') {
    where.push(archivedCond());
    params.push(done);
  }
  // ORDER BY binds the done value, then one param per priority option — keep this aligned with
  // the SQL taskOrder() emits.
  const priorities = priorityValues(db);
  params.push(done, ...priorities);
  return db
    .prepare(`${TASK_SELECT} WHERE ${where.join(' AND ')} ${taskOrder(priorities)}`)
    .all(...params);
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
FROM events e${parentJoins('e')}
`;

const EVENT_PARENT_LIVE = parentLive('e');

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

/**
 * Events overlapping the window [today, today+days] — includes currently-running multi-day events.
 *
 * 'localtime' before the offset: `start_at`/`end_at` are dates the user typed in local terms, so
 * a bare `date('now')` compared them against the UTC day. East of Greenwich, loading the
 * dashboard shortly after local midnight shifted the whole window back a day and moved both
 * edges — an event starting today, or one exactly `days` out, fell out of „Kommende Termine"
 * (SDL-10). Adding the days after the conversion keeps the arithmetic on the local calendar.
 */
export function eventsWithin(db: Database.Database, days: number): unknown[] {
  return db
    .prepare(
      `${EVENT_SELECT}
       WHERE e.deleted_at IS NULL AND ${EVENT_PARENT_LIVE}
         AND date(e.start_at) <= date('now', 'localtime', ?)
         AND date(COALESCE(e.end_at, e.start_at)) >= date('now', 'localtime')
       ${EVENT_ORDER}`,
    )
    .all(`+${days} days`);
}

/** The next few events starting beyond the window — keeps the dashboard useful year-round. */
export function eventsBeyond(db: Database.Database, days: number, limit: number): unknown[] {
  return db
    .prepare(
      `${EVENT_SELECT}
       WHERE e.deleted_at IS NULL AND ${EVENT_PARENT_LIVE} AND date(e.start_at) > date('now', 'localtime', ?)
       ${EVENT_ORDER} LIMIT ?`,
    )
    .all(`+${days} days`, limit);
}
