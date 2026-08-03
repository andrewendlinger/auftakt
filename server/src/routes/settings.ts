import { Router } from 'express';
import type Database from 'better-sqlite3';
import { ARCHIVE_AFTER_DAYS, PURGE_AFTER_DAYS, getDb, setActiveSeasonLabel } from '../db';

/** Settings stored as JSON arrays; returned parsed, accepted as arrays. */
const ARRAY_KEYS = new Set([
  'event_types',
  'project_statuses',
  'link_categories',
  'project_layout',
  'artist_layout',
  'dashboard_layout',
  'task_sort',
  'labels',
  'task_stats',
]);

/**
 * Every settings key a client may write. Anything not listed is dropped, so the
 * key/value table can never be turned into arbitrary storage — same idea as the
 * `writable` allowlist in lib/crud.ts. Add new settings here when you introduce them.
 */
const WRITABLE_SETTINGS = new Set<string>([
  ...ARRAY_KEYS,
  'saison',
  'backup_dir',
  'first_run_done',
  'attention_window_days',
]);

/**
 * Privileged keys are host-side filesystem paths the Electron main process consumes at
 * startup (`backup_dir` drives runBackup's mkdir/copy/rm). Only trusted no-Origin local
 * callers (Electron main, check-backup) may set them — a browser renderer, including an
 * XSS, always carries a browser-forced Origin and so is refused. See the X-01 guard in
 * index.ts for the "absent Origin = trusted local caller" model this reuses.
 */
const PRIVILEGED_SETTINGS = new Set<string>(['backup_dir']);

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
  // Retention constants, so the UI can state the policy the app actually follows instead of
  // hardcoding „30 Tage" in German prose that goes stale the moment either constant changes
  // (PGS-24). Read-only by construction: absent from WRITABLE_SETTINGS, so the PATCH drops
  // them, and written last so a stray settings row of the same name cannot shadow them. Both
  // the GET and the PATCH response go through here, so a settings write can never publish an
  // object that is missing them.
  out.archive_after_days = ARCHIVE_AFTER_DAYS;
  out.purge_after_days = PURGE_AFTER_DAYS;
  return out;
}

export const settingsRouter = Router();

settingsRouter.get('/', (_req, res) => {
  res.json(getAllSettings(getDb()));
});

settingsRouter.patch('/', (req, res) => {
  const db = getDb();
  const raw = (req.body ?? {}) as Record<string, unknown>;

  // Allowlist: keep only known keys, silently dropping the rest.
  const body: Record<string, unknown> = {};
  for (const k of Object.keys(raw)) if (WRITABLE_SETTINGS.has(k)) body[k] = raw[k];

  // An ARRAY_KEYS value that isn't an array would fall through to String(v) below and then fail
  // to JSON.parse on read, so getAllSettings hands the client a raw string where SectionArranger
  // and the layout code map over an array — a TypeError that blanks the settings page and, since
  // the corrupt value is persisted, stays broken until the row is hand-edited. 400 instead, the
  // way landing.ts already rejects its non-array fields (SDL-06). Empty arrays stay legal: an
  // explicitly empty task_stats or labels is meaningful.
  for (const [k, v] of Object.entries(body)) {
    if (ARRAY_KEYS.has(k) && !Array.isArray(v)) {
      return res.status(400).json({ error: `${k} muss eine Liste sein` });
    }
  }

  // A browser renderer (incl. an XSS) always sends an Origin it cannot forge away, so
  // refuse privileged filesystem-path keys from any Origin-bearing caller. The real UI
  // never PATCHes backup_dir — it goes through the chooseBackupDir IPC path — so this
  // only ever trips a hostile request.
  if (req.headers.origin !== undefined) {
    for (const k of Object.keys(body)) {
      if (PRIVILEGED_SETTINGS.has(k)) return res.status(403).json({ error: 'Forbidden' });
    }
  }

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
