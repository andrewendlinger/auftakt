import { isAbsolute, resolve } from 'node:path';

/**
 * Reasons a folder cannot serve as the backup target, as a German message (null = fine).
 *
 * Defense-in-depth (LEG-01): a hijacked backup_dir must not turn the silent startup
 * backup into an outbound SMB/WebDAV write — a Windows UNC path (\\host\share) would
 * leak the user's NTLM credential hash. isAbsolute() treats UNC as absolute, so reject
 * the \\ / // prefix explicitly on top of the relative-path check. Cloud folders
 * (Dropbox, Google Drive, OneDrive) surface as ordinary local paths and pass through.
 *
 * The check runs when the folder is *picked* as well as before every startup backup
 * (ELP-03): rejecting it only at startup meant a Windows user could choose a NAS share,
 * see it accepted, and never learn that their backups had stopped.
 */
export function backupDirProblem(backupDir: string): string | null {
  if (/^(\\\\|\/\/)/.test(backupDir)) {
    return 'Netzwerkordner (\\\\Server\\Freigabe) können nicht als Backup-Ordner verwendet werden. Bitte einen lokalen Ordner wählen — z. B. einen Cloud-Ordner wie Google Drive, Dropbox oder OneDrive, der auf diesem Rechner liegt.';
  }
  if (!isAbsolute(backupDir)) return 'Ungültiger Backup-Ordner: relative Pfade sind nicht erlaubt.';
  return null;
}

/**
 * Backups are performed by the server, not here: it owns the SQLite connections
 * and is the only side that can produce a consistent snapshot of a WAL database.
 * Electron only picks the folder and kicks the run off at startup.
 */
export async function runStartupBackup(port: number, backupDir: string): Promise<void> {
  if (!backupDir) return;
  const problem = backupDirProblem(backupDir);
  if (problem) throw new Error(problem);
  const dir = resolve(backupDir);
  const r = await fetch(`http://localhost:${port}/api/backup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dir }),
  });
  if (!r.ok) {
    const { error } = (await r.json().catch(() => ({ error: r.statusText }))) as { error?: string };
    throw new Error(error ?? 'Backup fehlgeschlagen');
  }
}
