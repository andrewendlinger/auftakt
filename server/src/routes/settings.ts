import { Router } from 'express';
import type Database from 'better-sqlite3';
import {
  ARCHIVE_AFTER_DAYS,
  PURGE_AFTER_DAYS,
  getBackupConfig,
  getDb,
  setActiveSeasonLabel,
  settingsRev,
  writeSettings,
} from '../db';

/** Settings stored as JSON arrays; returned parsed, accepted as arrays. */
const ARRAY_KEYS = new Set([
  'event_types',
  'project_statuses',
  'link_categories',
  'project_layout',
  'artist_layout',
  'dashboard_layout',
  // The layout a page applies on demand — a separate store from the `*_layout` above, which is
  // what a page inherits while its own `layout` column is NULL (WP-31).
  'project_layout_saved',
  'artist_layout_saved',
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
  'attention_window_days',
  'event_window_days',
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
  // Retention constants, so the UI can state the policy the app actually follows instead of
  // hardcoding „30 Tage" in German prose that goes stale the moment either constant changes
  // (PGS-24). Read-only by construction: absent from WRITABLE_SETTINGS, so the PATCH drops
  // them, and written last so a stray settings row of the same name cannot shadow them. Both
  // the GET and the PATCH response go through here, so a settings write can never publish an
  // object that is missing them.
  out.archive_after_days = ARCHIVE_AFTER_DAYS;
  out.purge_after_days = PURGE_AFTER_DAYS;
  // The backup folder moved to the registry (WP-39) but the Settings card still reads it from
  // here, so publish it the same read-only way: written last, absent from WRITABLE_SETTINGS,
  // so a leftover per-season `backup_dir` row from before the move cannot shadow the real value
  // and the PATCH cannot write it. Saving goes through POST /api/backup/dir.
  out.backup_dir = getBackupConfig().dir;
  // The generation the values above were read at (WP-R5) — the settings twin of the landing's
  // `rev`. Written last for the same reason as the two constants: a settings row literally named
  // `rev` must not be able to shadow the number a conditional PATCH is compared against. Absent
  // from WRITABLE_SETTINGS, so it can never be written as a value either.
  out.rev = settingsRev(db);
  return out;
}

export const settingsRouter = Router();

settingsRouter.get('/', (_req, res) => {
  res.json(getAllSettings(getDb()));
});

/**
 * Optimistic concurrency for the settings blob (WP-R5), the twin of `routes/landing.ts`.
 *
 * A settings array is replaced whole, so a client has to compute it from a read — and two windows
 * on the same season computing from the *same* read each stored their own array, so one window's
 * `dashboard_layout`, `labels` or renamed heading ceased to exist with nothing to say so (WP-53
 * left this open deliberately, for want of a generation column). A body carrying `rev` says which
 * generation it was computed from; if the stored settings have moved on, nothing is written and
 * the current settings come back with the 409 so the caller can re-apply its intent without a
 * second GET.
 *
 * **An omitted `rev` still writes unconditionally.** The conditional half is the *client's*
 * contract, not this route's precondition: the check scripts, the seeders and the settings page's
 * own single-field editors have no generation to name, and a scalar field written from one
 * control is not the lost-update shape this guards.
 *
 * The compare and the write sit in one handler with no `await` between them, so nothing can
 * interleave into the gap.
 */
settingsRouter.patch('/', (req, res) => {
  const db = getDb();
  const raw = (req.body ?? {}) as Record<string, unknown>;

  if ('rev' in raw) {
    if (typeof raw.rev !== 'number' || !Number.isInteger(raw.rev)) {
      return res.status(400).json({ error: 'rev must be an integer' });
    }
    if (raw.rev !== settingsRev(db)) {
      return res
        .status(409)
        .json({ error: 'Ein anderes Fenster hat inzwischen gespeichert.', settings: getAllSettings(db) });
    }
  }

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

  // One generation for the whole patch, however many keys it carries (db.ts, writeSettings).
  writeSettings(
    db,
    Object.entries(body).map(([k, v]) => [k, Array.isArray(v) ? JSON.stringify(v) : v == null ? null : String(v)]),
  );
  // Keep the season switcher's label in sync when the Saison name is edited here.
  if (typeof body.saison === 'string') setActiveSeasonLabel(body.saison);
  res.json(getAllSettings(db));
});
