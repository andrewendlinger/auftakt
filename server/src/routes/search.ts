import { Router } from 'express';
import { getDb } from '../db';
import { parentJoins, parentLive } from '../lib/queries';

export const searchRouter = Router();

const LIMIT = 20;

/**
 * Global search across artists, projects, tasks, events, contacts (incl. comments/notes).
 * Each result carries resolved_artist_id / project_id so the client can jump-to-result.
 * LIKE-based (small dataset in phase 1); FTS5 is a later optimisation.
 *
 * Rows whose owning project or artist is soft-deleted are excluded, exactly as `listTasks` /
 * `listEvents` exclude them: search used to filter only each row's own `deleted_at`, so a hit
 * under a trashed project survived and its `to` route pointed at a page that no longer exists —
 * a dead end with no way back but the browser's back action (SHL-07).
 */
searchRouter.get('/', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) {
    return res.json({ artists: [], projects: [], tasks: [], events: [], contacts: [] });
  }
  const db = getDb();
  // Escape LIKE metacharacters so a query containing % or _ matches them literally instead of
  // as wildcards; the backslash escape char is itself escaped. Paired with ESCAPE '\' on every
  // LIKE below (SRV-12). Values are already parameterised — this is relevance only, no injection.
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  const artists = db
    .prepare(
      `SELECT id, name FROM artists
       WHERE deleted_at IS NULL AND (name LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')
       ORDER BY name LIMIT ?`,
    )
    .all(like, like, LIMIT);

  const projects = db
    .prepare(
      `SELECT id, artist_id, code, name FROM projects
       WHERE deleted_at IS NULL AND (code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')
       ORDER BY code LIMIT ?`,
    )
    .all(like, like, like, LIMIT);

  const tasks = db
    .prepare(
      `SELECT t.id, t.title, t.status, t.project_id, t.artist_id,
              COALESCE(t.artist_id, p.artist_id) AS resolved_artist_id, p.code AS project_code
       FROM tasks t${parentJoins('t')}
       WHERE t.deleted_at IS NULL AND ${parentLive('t')}
         AND (t.title LIKE ? ESCAPE '\\' OR t.comment LIKE ? ESCAPE '\\')
       LIMIT ?`,
    )
    .all(like, like, LIMIT);

  const events = db
    .prepare(
      `SELECT e.id, e.title, e.type, e.start_at, e.all_day, e.project_id, e.artist_id,
              COALESCE(e.artist_id, p.artist_id) AS resolved_artist_id, p.code AS project_code
       FROM events e${parentJoins('e')}
       WHERE e.deleted_at IS NULL AND ${parentLive('e')}
         AND (e.title LIKE ? ESCAPE '\\' OR e.location LIKE ? ESCAPE '\\' OR e.notes LIKE ? ESCAPE '\\' OR e.type LIKE ? ESCAPE '\\')
       ORDER BY e.start_at LIMIT ?`,
    )
    .all(like, like, like, like, LIMIT);

  const contacts = db
    .prepare(
      `SELECT c.id, c.name, c.role, c.email, c.project_id, c.artist_id,
              COALESCE(c.artist_id, p.artist_id) AS resolved_artist_id, p.code AS project_code
       FROM contacts c${parentJoins('c')}
       WHERE c.deleted_at IS NULL AND ${parentLive('c')}
         AND (c.name LIKE ? ESCAPE '\\' OR c.role LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\' OR c.notes LIKE ? ESCAPE '\\')
       LIMIT ?`,
    )
    .all(like, like, like, like, like, LIMIT);

  res.json({ artists, projects, tasks, events, contacts });
});
