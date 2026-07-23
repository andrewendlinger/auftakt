import { isAbsolute, resolve } from 'node:path';

/**
 * Backups are performed by the server, not here: it owns the SQLite connections
 * and is the only side that can produce a consistent snapshot of a WAL database.
 * Electron only picks the folder and kicks the run off at startup.
 */
export async function runStartupBackup(port: number, backupDir: string): Promise<void> {
  if (!backupDir) return;
  // Defense-in-depth (LEG-01): a hijacked backup_dir must not turn the silent startup
  // backup into an outbound SMB/WebDAV write — a Windows UNC path (\\host\share) would
  // leak the user's NTLM credential hash. isAbsolute() treats UNC as absolute, so reject
  // the \\ / // prefix explicitly on top of the relative-path check. Cloud folders
  // (Dropbox, Google Drive, OneDrive) surface as ordinary local paths and pass through.
  if (/^(\\\\|\/\/)/.test(backupDir) || !isAbsolute(backupDir)) {
    throw new Error('Ungültiger Backup-Ordner: UNC- oder relative Pfade sind nicht erlaubt.');
  }
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
