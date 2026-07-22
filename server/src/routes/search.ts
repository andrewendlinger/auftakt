import { Router } from 'express';
import { getDb } from '../db';

export const searchRouter = Router();

const LIMIT = 20;

/**
 * Global search across artists, projects, tasks, events, contacts (incl. comments/notes).
 * Each result carries resolved_artist_id / project_id so the client can jump-to-result.
 * LIKE-based (small dataset in phase 1); FTS5 is a later optimisation.
 */
searchRouter.get('/', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) {
    return res.json({ artists: [], projects: [], tasks: [], events: [], contacts: [] });
  }
  const db = getDb();
  const like = `%${q}%`;

  const artists = db
    .prepare(
      `SELECT id, name FROM artists
       WHERE deleted_at IS NULL AND (name LIKE ? OR notes LIKE ?)
       ORDER BY name LIMIT ?`,
    )
    .all(like, like, LIMIT);

  const projects = db
    .prepare(
      `SELECT id, artist_id, code, name FROM projects
       WHERE deleted_at IS NULL AND (code LIKE ? OR name LIKE ? OR description LIKE ?)
       ORDER BY code LIMIT ?`,
    )
    .all(like, like, like, LIMIT);

  const tasks = db
    .prepare(
      `SELECT t.id, t.title, t.status, t.project_id, t.artist_id,
              COALESCE(t.artist_id, p.artist_id) AS resolved_artist_id, p.code AS project_code
       FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.deleted_at IS NULL AND (t.title LIKE ? OR t.comment LIKE ?)
       LIMIT ?`,
    )
    .all(like, like, LIMIT);

  const events = db
    .prepare(
      `SELECT e.id, e.title, e.type, e.start_at, e.all_day, e.project_id, e.artist_id,
              COALESCE(e.artist_id, p.artist_id) AS resolved_artist_id, p.code AS project_code
       FROM events e LEFT JOIN projects p ON p.id = e.project_id
       WHERE e.deleted_at IS NULL AND (e.title LIKE ? OR e.location LIKE ? OR e.notes LIKE ? OR e.type LIKE ?)
       ORDER BY e.start_at LIMIT ?`,
    )
    .all(like, like, like, like, LIMIT);

  const contacts = db
    .prepare(
      `SELECT c.id, c.name, c.role, c.email, c.project_id, c.artist_id,
              COALESCE(c.artist_id, p.artist_id) AS resolved_artist_id, p.code AS project_code
       FROM contacts c LEFT JOIN projects p ON p.id = c.project_id
       WHERE c.deleted_at IS NULL
         AND (c.name LIKE ? OR c.role LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR c.notes LIKE ?)
       LIMIT ?`,
    )
    .all(like, like, like, like, like, LIMIT);

  res.json({ artists, projects, tasks, events, contacts });
});
