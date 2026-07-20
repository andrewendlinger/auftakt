import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const KEEP = 30;

/**
 * On startup, copy the live SQLite file into the user-picked backup folder with
 * a timestamped name, then keep only the most recent KEEP backups.
 */
export function runStartupBackup(dbPath: string, backupDir: string): void {
  if (!backupDir || !existsSync(dbPath)) return;
  mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  copyFileSync(dbPath, join(backupDir, `auftakt-${stamp}.db`));

  const backups = readdirSync(backupDir)
    .filter((f) => /^auftakt-.*\.db$/.test(f))
    .map((f) => ({ f, t: statSync(join(backupDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);

  for (const { f } of backups.slice(KEEP)) {
    try {
      unlinkSync(join(backupDir, f));
    } catch {
      /* ignore */
    }
  }
}
