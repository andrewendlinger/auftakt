import { Router } from 'express';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  BACKUP_KEEP,
  BACKUP_POINTS_DIR,
  PRE_IMPORT_DIR,
  SCHEMA_VERSION,
  backupStamp,
  fileSchemaVersion,
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
import { appVersion, manifestText, readmeText, writeDoc } from '../lib/backupDocs';

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
 * Move dated folders an older version wrote at the top level down into their sub-folder (WP-41).
 *
 * Self-detecting rather than marker-gated (the house rule in docs/ARCHITECTURE.md): a folder
 * still sitting at the old level *is* the signal, so there is no state to keep and nothing to
 * re-run manually. It is a rename inside the backup folder — same filesystem, no copy, no
 * second set of bytes — and best-effort per folder: a Google Drive or OneDrive client can hold
 * a handle on a folder it is syncing, and a refused move must neither abort the backup nor lose
 * the folder. Whatever fails stays where it is and the next launch tries again.
 *
 * Without this the up-to-60 folders an existing installation already has would sit at the top
 * level for good — nothing writes there any more, so pruning could never bring them below its
 * cap — and the untidiness this package is about would be fixed only for fresh installs.
 */
function migrateDatedFolders(backupDir: string, prefix: string, into: string): void {
  // The whole body, not just the rename: this runs *after* the restore point has been written,
  // so anything escaping here would report a complete, valid backup as "no backup was written"
  // (electron/main.ts raises a dialog on a throw). mkdirSync can hit EPERM/EBUSY on a synced
  // folder, and datedFolders' statSync can lose a race with the sync client removing an entry.
  try {
    const stale = datedFolders(backupDir, prefix);
    if (!stale.length) return;
    mkdirSync(into, { recursive: true });
    for (const name of stale) {
      try {
        renameSync(join(backupDir, name), join(into, name));
      } catch {
        /* locked, or a name already down there — leave it and retry next run */
      }
    }
  } catch {
    /* see above — the next run tries again */
  }
}

/**
 * Why the configured backup folder cannot be written to *right now*, as a German message
 * (null = fine). Checked immediately before the run, because that is the only moment at which
 * the answer is worth anything: a folder is renamed, moved or unplugged while the app is closed.
 *
 * Without it the folder was silently **recreated** (WP-65). `runBackup` opens with
 * `mkdirSync(target, { recursive: true })` — `mkdir -p` — so a vanished backup folder came back
 * empty, with a fresh README and one restore point in it, and the run genuinely succeeded:
 * nothing threw, so `reportBackupProblem`'s dialog (electron/main.ts) was never reached and the
 * amber hint in Einstellungen stayed silent, `backup_dir` still being set. The customer kept
 * backing up — into a folder that was no longer the one holding his older restore points. That
 * is the ELP-03 failure case one door further in: there, a folder the backup could never use;
 * here, one it could use yesterday and cannot find today.
 *
 * **Only the configured folder is checked, never `backups/` below it.** The picker runs with
 * `properties: ['openDirectory', 'createDirectory']`, so a brand-new empty folder the user made
 * seconds ago is the normal first-backup case and must still work — the sub-folders and the
 * dated folder are ours to create, and `mkdir -p` stays right for exactly those.
 *
 * Named apart from `backupDirProblem` in `electron/backup.ts` deliberately: that one is a pure
 * check of the path's *shape* (UNC, relative), which is why it can also run when the folder is
 * picked. This one is about the filesystem's state at the moment of the write and answers
 * nothing at pick time — the picker only ever returns a folder that exists.
 */
function backupDirUnavailable(backupDir: string): string | null {
  let stats;
  try {
    stats = statSync(backupDir);
  } catch {
    // Any refusal to stat the path, not only ENOENT: an unreadable parent or a disconnected
    // network volume is the same situation from the user's side — the folder is not there to
    // write into. The message stays a question rather than a diagnosis for that reason. Keep it
    // short: `reportBackupProblem` already prefixes „Es wurde keine Sicherung angelegt." and
    // appends where to fix it, so anything more here is said twice.
    return `Der Backup-Ordner „${backupDir}“ ist nicht mehr vorhanden — umbenannt, verschoben oder gelöscht, oder ein Laufwerk bzw. Cloud-Ordner ist gerade nicht verbunden.`;
  }
  if (!stats.isDirectory()) {
    return `„${backupDir}“ ist eine Datei, kein Ordner, und kann nicht als Backup-Ordner verwendet werden.`;
  }
  return null;
}

/**
 * Write one dated restore point holding every season plus the registry, and keep the backup
 * folder explaining itself:
 *
 *   <backupDir>/README.txt
 *   <backupDir>/backups/auftakt-<stamp>/{MANIFEST.txt, seasons.json, auftakt.db, season-2.db, …}
 *   <backupDir>/pre-import/pre-import-<stamp>/<file>.db   (written by the import, pruned here)
 *
 * All seasons are covered, not just the active one, and each is snapshotted via
 * VACUUM INTO so the copy actually contains the rows sitting in the WAL.
 *
 * **Inside a restore point everything stays flat and keeps the file names from seasons.json.**
 * Restoring is a hand copy of that folder's contents over the data directory (README.txt,
 * docs/BACKUP-TESTING.md case 7), which is exactly why the season label goes into MANIFEST.txt
 * and not into the file names.
 *
 * Legacy flat `auftakt-<stamp>.db` files from earlier versions are deliberately
 * left alone: they are real backups, nothing writes that shape any more, so the
 * set is already capped — deleting a user's backups would be the wrong call. The README
 * explains them instead.
 */
export function runBackup(backupDir: string): { dir: string; files: string[] } {
  // Before anything is created, and inside the run rather than in the route below: the guard
  // belongs against the `mkdirSync` two lines down, so a second caller of the backup run cannot
  // be added without it. The route turns the throw into the same 500-with-message that a
  // read-only folder already produces, which is the path `reportBackupProblem` is known to
  // surface (docs/BACKUP-TESTING.md case 3) — one failure shape for the Electron side, not two.
  const unavailable = backupDirUnavailable(backupDir);
  if (unavailable) throw new Error(unavailable);

  const at = new Date();
  const pointsDir = join(backupDir, BACKUP_POINTS_DIR);
  const preImportDir = join(backupDir, PRE_IMPORT_DIR);
  const target = join(pointsDir, `auftakt-${backupStamp(at)}`);
  mkdirSync(target, { recursive: true });

  const files: string[] = [];
  const labels: Array<{ file: string; label: string }> = [];
  for (const season of seasonFiles()) {
    if (!existsSync(season.path)) continue; // registered but never opened
    snapshotDb(season.path, join(target, season.file));
    files.push(season.file);
    labels.push({ file: season.file, label: season.label });
  }
  const registry = registryPath();
  let registryFile: string | null = null;
  if (existsSync(registry)) {
    registryFile = basename(registry);
    copyFileSync(registry, join(target, registryFile));
    files.push(registryFile);
  }
  // Named from what was actually written, not from what was meant to be: the manifest is read
  // years later, next to the folder it describes, and a line for a file that is not in there
  // sends the reader looking for it.
  writeDoc(join(target, 'MANIFEST.txt'), manifestText(at, appVersion(), labels, registryFile));

  // Before pruning, or the migrated folders would not be counted and an installation could
  // end up holding 30 in each place.
  migrateDatedFolders(backupDir, 'auftakt', pointsDir);
  migrateDatedFolders(backupDir, 'pre-import', preImportDir);

  pruneDatedFolders(pointsDir, 'auftakt');
  // Pre-import snapshots have their own folder and their own prefix, so nothing
  // ever cleaned them up and the backup folder grew with every import (DBW-12). Pruned
  // on their own count, so heavy importing cannot evict the dated restore points.
  pruneDatedFolders(preImportDir, 'pre-import');

  writeDoc(join(backupDir, 'README.txt'), readmeText(hasLegacyFlatBackups(backupDir)));
  return { dir: target, files };
}

/**
 * Flat `auftakt-<stamp>.db` files from versions before the dated folders — the README explains
 * them, so this decides whether that paragraph is written at all.
 *
 * Matched on the dated shape rather than on `auftakt-*.db`: „Datenbank exportieren…" proposes
 * `auftakt-<label>-<stamp>.db` (electron/exportName.ts), and saving an export into the backup
 * folder is a natural thing to do. A looser pattern would announce those files as leftovers of
 * an older version. The label-less fallback of that same helper is indistinguishable from a
 * legacy backup, which is why the paragraph names both origins.
 */
function hasLegacyFlatBackups(backupDir: string): boolean {
  try {
    return readdirSync(backupDir).some((f) => /^auftakt-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}(?:-\d{3})?\.db$/.test(f));
  } catch {
    return false;
  }
}

/**
 * True once the request's season holds anything worth backing up.
 *
 * **A season this build cannot open answers `true`, not `false`** (WP-R5). `getDb()` throws for
 * a file a newer build has already migrated — and a throw here would 500 the whole status
 * response, which the main process reads as „no backup folder configured" and answers by
 * skipping the startup backup for *every* season, silently: `ensureBackupDir` finds no
 * `backupDir` on the error body, returns '', and nothing reaches `reportBackupProblem`. One
 * refused season would stop backups for the healthy ones — the WP-39 failure mode, and the
 * opposite of the per-season refusal this package is built on.
 *
 * `true` is also the honest answer on its own terms: an existing file this cannot read is not
 * evidence that there is nothing to protect. It is the state in which a backup matters most, and
 * `runBackup` snapshots every season file raw (`VACUUM INTO`, no migration chain), so the backup
 * itself works for exactly the seasons this cannot open.
 */
function hasData(): boolean {
  let db;
  try {
    db = getDb();
  } catch {
    return true;
  }
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

/**
 * Validate a candidate without touching anything — lets the UI warn before confirming.
 *
 * `schema` rides along so the Electron dialog can name both generations (WP-R5): the file's and
 * this build's. On a refusal the message already spells them out, but the accepted case matters
 * too — importing an older file *migrates* it, and some of that chain is deliberately lossy, so
 * the confirmation is the last moment at which saying so is any use.
 */
backupRouter.post('/import/check', (req, res) => {
  const path = String((req.body as { path?: unknown })?.path ?? '').trim();
  if (!path) return res.status(400).json({ error: 'Keine Datei angegeben.' });
  const problem = validateImportCandidate(path);
  res.json({
    ok: !problem,
    error: problem ?? undefined,
    schema: { file: fileSchemaVersion(path), app: SCHEMA_VERSION },
  });
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
