import { Router } from 'express';
import { doneStatusValue, getDb } from '../db';
import { eventsBeyond, eventsWithin, listTasks } from '../lib/queries';

export const dashboardRouter = Router();

dashboardRouter.get('/', (_req, res) => {
  const db = getDb();
  const artists = db
    .prepare('SELECT * FROM artists WHERE deleted_at IS NULL ORDER BY sort_order ASC, name ASC')
    .all() as Array<{ id: number }>;

  const projCounts = db
    .prepare(
      'SELECT artist_id AS aid, COUNT(*) AS n FROM projects WHERE deleted_at IS NULL GROUP BY artist_id',
    )
    .all() as Array<{ aid: number; n: number }>;

  const done = doneStatusValue(db);
  const tasks = listTasks(db, { scope: 'live' }) as Array<{
    status: string;
    resolved_artist_id: number | null;
  }>;

  // Counted off the list this badge sits above, not off a second query. The separate one joined
  // projects without a deleted_at test and applied neither the parent-live filter nor the archive
  // condition, so an artist card counted open tasks of a soft-deleted project that the list below
  // it no longer showed. Deriving it here makes the two agree by construction.
  const openMap = new Map<number, number>();
  for (const t of tasks) {
    if (t.status === done || t.resolved_artist_id == null) continue;
    openMap.set(t.resolved_artist_id, (openMap.get(t.resolved_artist_id) ?? 0) + 1);
  }

  const projMap = new Map(projCounts.map((r) => [r.aid, r.n]));

  const cards = artists.map((a) => ({
    ...a,
    project_count: projMap.get(a.id) ?? 0,
    open_task_count: openMap.get(a.id) ?? 0,
  }));

  res.json({
    artists: cards,
    upcoming14: eventsWithin(db, 14),
    nextUp: eventsBeyond(db, 14, 6),
    tasks,
  });
});
