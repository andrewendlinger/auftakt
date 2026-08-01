import { Router } from 'express';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  backupStamp,
  getDb,
  getSetting,
  importIntoActiveSeason,
  registryPath,
  resolveDbPath,
  seasonFiles,
  setSetting,
  snapshotDb,
  validateImportCandidate,
} from '../db';

/** Number of dated restore points kept in the backup folder. */
const KEEP = 30;

/** Restore-point folders written by runBackup(), newest first. */
function restorePoints(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^auftakt-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(f))
    .filter((f) => statSync(join(dir, f)).isDirectory())
    .sort()
    .reverse();
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

  for (const stale of restorePoints(backupDir).slice(KEEP)) {
    try {
      rmSync(join(backupDir, stale), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  return { dir: target, files };
}

/** True once the active season holds anything worth backing up. */
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
 */
backupRouter.get('/status', (_req, res) => {
  const db = getDb();
  res.json({
    backupDir: getSetting(db, 'backup_dir') ?? '',
    hasData: hasData(),
    prompted: getSetting(db, 'first_run_done') === '1',
  });
});

backupRouter.post('/prompted', (_req, res) => {
  setSetting(getDb(), 'first_run_done', '1');
  res.json({ ok: true });
});

backupRouter.post('/', (req, res) => {
  const dir = String((req.body as { dir?: unknown })?.dir ?? getSetting(getDb(), 'backup_dir') ?? '').trim();
  if (!dir) return res.status(400).json({ error: 'Kein Backup-Ordner konfiguriert.' });
  try {
    res.json(runBackup(dir));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Export the active season as a single consistent file (never a raw file copy). */
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
    const backupDir = getSetting(getDb(), 'backup_dir') ?? '';
    res.json(importIntoActiveSeason(path, backupDir));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
