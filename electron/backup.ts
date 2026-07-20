/**
 * Backups are performed by the server, not here: it owns the SQLite connections
 * and is the only side that can produce a consistent snapshot of a WAL database.
 * Electron only picks the folder and kicks the run off at startup.
 */
export async function runStartupBackup(port: number, backupDir: string): Promise<void> {
  if (!backupDir) return;
  const r = await fetch(`http://localhost:${port}/api/backup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dir: backupDir }),
  });
  if (!r.ok) {
    const { error } = (await r.json().catch(() => ({ error: r.statusText }))) as { error?: string };
    throw new Error(error ?? 'Backup fehlgeschlagen');
  }
}
