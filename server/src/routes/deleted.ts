import { Router } from 'express';
import { getDb, PURGE_AFTER_DAYS } from '../db';
import { collect, DELETE_ORDER, type Collected } from '../lib/cascade';

/**
 * The "Gelöschte Items" (trash) endpoints powering the second section of the archive page:
 * list soft-deleted rows, restore one, or permanently (hard) delete one — cascading to every
 * row that references it. Kept out of the crud factory because a unified, labeled cross-entity
 * list and a graph-walking cascade delete don't fit the per-table crudRouter shape.
 */

/** User-facing deleted type → its table. The allowlist that guards every `${table}` below. */
const TYPES = {
  artist: 'artists',
  project: 'projects',
  contact: 'contacts',
  event: 'events',
  task: 'tasks',
  link: 'links',
  section: 'custom_sections',
} as const;
type DeletedType = keyof typeof TYPES;

/** table → the type name used in cascade counts (`custom_columns` has no user-facing type). */
const TABLE_TYPE: Record<string, string> = {
  artists: 'artist',
  projects: 'project',
  contacts: 'contact',
  events: 'event',
  tasks: 'task',
  links: 'link',
  custom_columns: 'column',
  custom_sections: 'section',
};

/** Compact per-type list of soft-deleted rows: id, a human label, an owner sublabel, timestamps. */
const LIST_SQL: Record<DeletedType, string> = {
  artist: `SELECT id, name AS label, NULL AS sublabel, deleted_at,
             datetime(deleted_at, '+${PURGE_AFTER_DAYS} days') AS purge_at
           FROM artists WHERE deleted_at IS NOT NULL`,
  project: `SELECT p.id, p.code || ' · ' || p.name AS label, a.name AS sublabel, p.deleted_at,
              datetime(p.deleted_at, '+${PURGE_AFTER_DAYS} days') AS purge_at
            FROM projects p LEFT JOIN artists a ON a.id = p.artist_id
            WHERE p.deleted_at IS NOT NULL`,
  contact: `SELECT c.id, c.name AS label, COALESCE(a.name, p.code) AS sublabel, c.deleted_at,
              datetime(c.deleted_at, '+${PURGE_AFTER_DAYS} days') AS purge_at
            FROM contacts c
            LEFT JOIN artists a ON a.id = c.artist_id
            LEFT JOIN projects p ON p.id = c.project_id
            WHERE c.deleted_at IS NOT NULL`,
  event: `SELECT e.id, e.title AS label, COALESCE(a.name, p.code) AS sublabel, e.deleted_at,
            datetime(e.deleted_at, '+${PURGE_AFTER_DAYS} days') AS purge_at
          FROM events e
          LEFT JOIN artists a ON a.id = e.artist_id
          LEFT JOIN projects p ON p.id = e.project_id
          WHERE e.deleted_at IS NOT NULL`,
  task: `SELECT t.id, t.title AS label, COALESCE(a.name, p.code) AS sublabel, t.deleted_at,
           datetime(t.deleted_at, '+${PURGE_AFTER_DAYS} days') AS purge_at
         FROM tasks t
         LEFT JOIN projects p ON p.id = t.project_id
         LEFT JOIN artists a ON a.id = COALESCE(t.artist_id, p.artist_id)
         WHERE t.deleted_at IS NOT NULL`,
  link: `SELECT l.id, l.label AS label, COALESCE(a.name, p.code, e.title, t.title, s.name) AS sublabel,
           l.deleted_at, datetime(l.deleted_at, '+${PURGE_AFTER_DAYS} days') AS purge_at
         FROM links l
         LEFT JOIN artists a ON a.id = l.artist_id
         LEFT JOIN projects p ON p.id = l.project_id
         LEFT JOIN events e ON e.id = l.event_id
         LEFT JOIN tasks t ON t.id = l.task_id
         LEFT JOIN custom_sections s ON s.id = l.section_id
         WHERE l.deleted_at IS NOT NULL`,
  section: `SELECT s.id, s.name AS label, COALESCE(a.name, p.code, 'Übersicht') AS sublabel,
              s.deleted_at, datetime(s.deleted_at, '+${PURGE_AFTER_DAYS} days') AS purge_at
            FROM custom_sections s
            LEFT JOIN artists a ON a.id = s.artist_id
            LEFT JOIN projects p ON p.id = s.project_id
            WHERE s.deleted_at IS NOT NULL`,
};

interface DeletedRow {
  id: number;
  label: string;
  sublabel: string | null;
  deleted_at: string;
  purge_at: string;
}

/** Count everything in the closure except the root row itself, grouped by type name. */
function dependentCounts(
  collected: Collected,
  rootTable: string,
  rootId: number,
): { total: number; byType: Record<string, number> } {
  const byType: Record<string, number> = {};
  let total = 0;
  for (const [table, ids] of collected) {
    for (const id of ids) {
      if (table === rootTable && id === rootId) continue;
      const type = TABLE_TYPE[table];
      if (!type) continue;
      byType[type] = (byType[type] ?? 0) + 1;
      total++;
    }
  }
  return { total, byType };
}

function tableFor(type: string): string | undefined {
  return Object.hasOwn(TYPES, type) ? TYPES[type as DeletedType] : undefined;
}

export const deletedRouter = Router();

deletedRouter.get('/', (_req, res) => {
  const db = getDb();
  const items: Array<DeletedRow & { type: DeletedType; dependents: ReturnType<typeof dependentCounts> }> = [];
  for (const type of Object.keys(TYPES) as DeletedType[]) {
    const rows = db.prepare(LIST_SQL[type]).all() as DeletedRow[];
    for (const row of rows) {
      const collected = collect(db, TYPES[type], row.id);
      items.push({ type, ...row, dependents: dependentCounts(collected, TYPES[type], row.id) });
    }
  }
  // Most-recently deleted first.
  items.sort((a, b) => (a.deleted_at < b.deleted_at ? 1 : a.deleted_at > b.deleted_at ? -1 : 0));
  res.json(items);
});

deletedRouter.post('/:type/:id/restore', (req, res) => {
  const table = tableFor(req.params.type);
  if (!table) return res.status(400).json({ error: 'Unbekannter Typ' });
  getDb()
    .prepare(`UPDATE ${table} SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ?`)
    .run(Number(req.params.id));
  res.json({ ok: true });
});

deletedRouter.delete('/:type/:id', (req, res) => {
  const table = tableFor(req.params.type);
  if (!table) return res.status(400).json({ error: 'Unbekannter Typ' });
  const id = Number(req.params.id);
  const db = getDb();

  // Only ever hard-delete rows that are already in the trash — never a live row.
  const row = db.prepare(`SELECT deleted_at FROM ${table} WHERE id = ?`).get(id) as
    | { deleted_at: string | null }
    | undefined;
  if (!row || !row.deleted_at) return res.status(404).json({ error: 'Nicht gefunden oder nicht gelöscht' });

  const collected = collect(db, table, id);
  const removed = dependentCounts(collected, table, id);
  db.transaction(() => {
    for (const t of DELETE_ORDER) {
      const ids = collected.get(t);
      if (!ids || ids.size === 0) continue;
      const list = [...ids];
      const placeholders = list.map(() => '?').join(', ');
      db.prepare(`DELETE FROM ${t} WHERE id IN (${placeholders})`).run(...list);
    }
  })();
  res.json({ ok: true, removed });
});
