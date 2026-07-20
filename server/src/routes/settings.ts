import { Router } from 'express';
import type Database from 'better-sqlite3';
import { getDb, setActiveSeasonLabel } from '../db';

/** Settings stored as JSON arrays; returned parsed, accepted as arrays. */
const ARRAY_KEYS = new Set([
  'event_types',
  'project_statuses',
  'project_layout',
  'artist_layout',
  'task_sort',
  'labels',
]);

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function getAllSettings(db: Database.Database): Record<string, unknown> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{
    key: string;
    value: string | null;
  }>;
  const out: Record<string, unknown> = {};
  for (const { key, value } of rows) {
    out[key] = ARRAY_KEYS.has(key) && value ? safeParse(value) : value;
  }
  return out;
}

export const settingsRouter = Router();

settingsRouter.get('/', (_req, res) => {
  res.json(getAllSettings(getDb()));
});

settingsRouter.patch('/', (req, res) => {
  const db = getDb();
  const body = (req.body ?? {}) as Record<string, unknown>;
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(body)) {
      const val = Array.isArray(v) ? JSON.stringify(v) : v == null ? null : String(v);
      stmt.run(k, val);
    }
  });
  tx();
  // Keep the season switcher's label in sync when the Saison name is edited here.
  if (typeof body.saison === 'string') setActiveSeasonLabel(body.saison);
  res.json(getAllSettings(db));
});
