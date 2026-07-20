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
  const openCounts = db
    .prepare(
      `SELECT COALESCE(t.artist_id, p.artist_id) AS aid, COUNT(*) AS n
       FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.deleted_at IS NULL AND t.status != ?
       GROUP BY aid`,
    )
    .all(done) as Array<{ aid: number; n: number }>;

  const projMap = new Map(projCounts.map((r) => [r.aid, r.n]));
  const openMap = new Map(openCounts.map((r) => [r.aid, r.n]));

  const cards = artists.map((a) => ({
    ...a,
    project_count: projMap.get(a.id) ?? 0,
    open_task_count: openMap.get(a.id) ?? 0,
  }));

  res.json({
    artists: cards,
    upcoming14: eventsWithin(db, 14),
    nextUp: eventsBeyond(db, 14, 6),
    tasks: listTasks(db, { scope: 'live' }),
  });
});
