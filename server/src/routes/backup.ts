import { Router } from 'express';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  BACKUP_KEEP,
  backupStamp,
  getBackupConfig,
  getDb,
  importIntoCurrentSeason,
  registryPath,
  resolveDbPath,
  seasonFiles,
  setBackupDir,
  setBackupPrompted,
  snapshotDb,
  validateImportCandidate,
} from '../db';

/**
 * Dated folders this app writes into the backup folder, newest first.
 *
 * The millisecond group is optional so folders written before backupStamp() gained sub-second
 * resolution (DBW-09) keep matching — an unmatched folder is never pruned, so tightening this
 * pattern would quietly let the backup folder grow forever.
 */
function datedFolders(dir: string, prefix: string): string[] {
  if (!existsSync(dir)) return [];
  const pattern = new RegExp(`^${prefix}-\\d{4}-\\d{2}-\\d{2}-\\d{2}-\\d{2}-\\d{2}(?:-\\d{3})?$`);
  return readdirSync(dir)
    .filter((f) => pattern.test(f))
    .filter((f) => statSync(join(dir, f)).isDirectory())
    .sort()
    .reverse();
}

/** Drop everything past the newest BACKUP_KEEP folders with this prefix. */
function pruneDatedFolders(dir: string, prefix: string): void {
  for (const stale of datedFolders(dir, prefix).slice(BACKUP_KEEP)) {
    try {
      rmSync(join(dir, stale), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Write one dated restore point holding every season plus the registry:
 *
 *   <backupDir>/auftakt-<stamp>/{seasons.json, auftakt.db, season-2.db, …}
 *
 * All seasons are covered, not just the active one, and each is snapshotted via
 * VACUUM INTO so the copy actually contains the rows sitting in the WAL.
 *
 * Legacy flat `auftakt-<stamp>.db` files from earlier versions are deliberately
 * left alone: they are real backups, nothing writes that shape any more, so the
 * set is already capped — deleting a user's backups would be the wrong call.
 */
export function runBackup(backupDir: string): { dir: string; files: string[] } {
  const target = join(backupDir, `auftakt-${backupStamp()}`);
  mkdirSync(target, { recursive: true });

  const files: string[] = [];
  for (const season of seasonFiles()) {
    if (!existsSync(season.path)) continue; // registered but never opened
    snapshotDb(season.path, join(target, season.file));
    files.push(season.file);
  }
  const registry = registryPath();
  if (existsSync(registry)) {
    copyFileSync(registry, join(target, basename(registry)));
    files.push(basename(registry));
  }

  pruneDatedFolders(backupDir, 'auftakt');
  // Pre-import snapshots live in the same folder but under their own prefix, so nothing
  // ever cleaned them up and the backup folder grew with every import (DBW-12). Pruned
  // on their own count, so heavy importing cannot evict the dated restore points.
  pruneDatedFolders(backupDir, 'pre-import');
  return { dir: target, files };
}

/** True once the request's season holds anything worth backing up. */
function hasData(): boolean {
  const db = getDb();
  for (const table of ['artists', 'projects', 'tasks']) {
    const row = db.prepare(`SELECT 1 FROM ${table} WHERE deleted_at IS NULL LIMIT 1`).get();
    if (row) return true;
  }
  return false;
}

export const backupRouter = Router();

/**
 * What Electron needs to decide whether to prompt for a backup folder on startup.
 * `prompted` keeps the first-launch dialog from reappearing once a folder has been
 * chosen; Electron sets it only after the choice was saved, so a cancelled prompt
 * comes back on the next launch instead of disabling backups for good (ELP-05).
 *
 * Both come from the registry, not the active season (WP-39) — a backup folder that only
 * applied to whichever season happened to be open is how backups stopped without a word.
 * `hasData` stays per-season on purpose: it asks whether there is anything worth protecting
 * *now*, and the folder it leads to is global once chosen.
 */
backupRouter.get('/status', (_req, res) => {
  const cfg = getBackupConfig();
  res.json({ backupDir: cfg.dir, hasData: hasData(), prompted: cfg.prompted });
});

backupRouter.post('/prompted', (_req, res) => {
  setBackupPrompted();
  res.json({ ok: true });
});

/**
 * Save the backup folder. Privileged: it is a host-side path the Electron main process
 * later hands to mkdir/copy/rm, so only a trusted no-Origin local caller may set it — a
 * browser renderer, including an XSS, always carries an Origin it cannot forge away. Same
 * model as PRIVILEGED_SETTINGS in routes/settings.ts, which this replaced.
 */
backupRouter.post('/dir', (req, res) => {
  if (req.headers.origin !== undefined) return res.status(403).json({ error: 'Forbidden' });
  const dir = String((req.body as { dir?: unknown })?.dir ?? '').trim();
  if (!dir) return res.status(400).json({ error: 'Kein Backup-Ordner angegeben.' });
  setBackupDir(dir);
  res.json({ ok: true, dir });
});

backupRouter.post('/', (req, res) => {
  const dir = String((req.body as { dir?: unknown })?.dir ?? getBackupConfig().dir).trim();
  if (!dir) return res.status(400).json({ error: 'Kein Backup-Ordner konfiguriert.' });
  try {
    res.json(runBackup(dir));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Export the request's season as a single consistent file (never a raw file copy). */
backupRouter.post('/export', (req, res) => {
  const path = String((req.body as { path?: unknown })?.path ?? '').trim();
  if (!path) return res.status(400).json({ error: 'Kein Zielpfad angegeben.' });
  try {
    snapshotDb(resolveDbPath(), path);
    res.json({ ok: true, path });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Validate a candidate without touching anything — lets the UI warn before confirming. */
backupRouter.post('/import/check', (req, res) => {
  const path = String((req.body as { path?: unknown })?.path ?? '').trim();
  if (!path) return res.status(400).json({ error: 'Keine Datei angegeben.' });
  const problem = validateImportCandidate(path);
  res.json({ ok: !problem, error: problem ?? undefined });
});

backupRouter.post('/import', (req, res) => {
  const path = String((req.body as { path?: unknown })?.path ?? '').trim();
  if (!path) return res.status(400).json({ error: 'Keine Datei angegeben.' });
  try {
    const backupDir = getBackupConfig().dir;
    res.json(importIntoCurrentSeason(path, backupDir));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
