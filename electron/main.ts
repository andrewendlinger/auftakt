import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildMenu } from './menu';
import { backupDirProblem, runStartupBackup } from './backup';
import { checkForUpdates, downloadAndInstallUpdate, startSilentStartupCheck } from './updater';

const isDev = !app.isPackaged;
const PORT = Number(process.env.AUFTAKT_PORT ?? 4317);
const DEV_URL = process.env.AUFTAKT_DEV_URL ?? 'http://localhost:5317';

let mainWindow: BrowserWindow | null = null;

/**
 * Authoritative scheme allowlist for `shell.openExternal` (X-02). The renderer
 * guards the same set (`client/src/lib/external.ts`), but the renderer is the
 * untrusted side, so the check that matters is here — a compromised or bypassed
 * renderer must not be able to launch `file:`, UNC/`smb:` or custom-protocol
 * handlers via the bridge or a `window.open`/navigation attempt.
 */
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function isAllowedExternalUrl(url: string): boolean {
  try {
    return ALLOWED_EXTERNAL_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** Open a URL externally only if its scheme is allowlisted; otherwise refuse + log. */
function openExternalSafely(url: string): void {
  if (isAllowedExternalUrl(url)) {
    void shell.openExternal(url);
  } else {
    console.warn('Blockierter externer Link (nicht unterstütztes Format):', url);
  }
}

/** The data dir holding the season DBs + seasons.json: dev → repo/.data; packaged → userData. */
function dataDir(): string {
  return isDev ? resolve(app.getAppPath(), '.data') : app.getPath('userData');
}

function stamp(): string {
  return new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
}

/**
 * POST to the local server and surface failures as a German error dialog.
 * All database-file work lives server-side (it owns the SQLite connections);
 * this process only supplies the paths the user picked in a dialog.
 */
async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`http://localhost:${PORT}/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(json.error ?? r.statusText);
  return json;
}

async function startServer(): Promise<void> {
  // Configure the bundled server via env, then import it (it calls app.listen on load).
  process.env.AUFTAKT_DATA_DIR = dataDir();
  process.env.AUFTAKT_PORT = String(PORT);
  process.env.AUFTAKT_CLIENT_DIST = join(app.getAppPath(), 'client', 'dist');
  const serverEntry = join(app.getAppPath(), 'server', 'dist', 'index.mjs');
  await import(pathToFileURL(serverEntry).href);
  await waitForServer();
}

function waitForServer(timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  return new Promise((res, rej) => {
    const tick = async () => {
      try {
        const r = await fetch(`http://localhost:${PORT}/api/health`);
        if (r.ok) return res();
      } catch {
        /* not up yet */
      }
      if (Date.now() - start > timeoutMs) return rej(new Error('Server-Start Zeitüberschreitung'));
      setTimeout(tick, 150);
    };
    void tick();
  });
}

/**
 * PATCH a setting and treat a non-OK response as the failure it is (ELP-04): a
 * silently dropped `backup_dir` save leaves the user believing backups are set up
 * while no startup backup ever runs again.
 */
async function patchSettings(patch: Record<string, unknown>): Promise<void> {
  const r = await fetch(`http://localhost:${PORT}/api/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const { error } = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(error ?? r.statusText);
  }
}

/**
 * Pick a backup folder, rejecting one the startup backup could not use (ELP-03).
 * Validating here rather than only in runStartupBackup is the point: a Windows user
 * could pick a NAS share, see it accepted, and never learn that backups had stopped.
 */
async function promptForDirectory(): Promise<string | null> {
  const r = await dialog.showOpenDialog({
    title: 'Backup-Ordner wählen (z. B. Google Drive)',
    properties: ['openDirectory', 'createDirectory'],
  });
  const dir = r.canceled ? null : (r.filePaths[0] ?? null);
  if (!dir) return null;
  const problem = backupDirProblem(dir);
  if (problem) {
    await dialog.showMessageBox({ type: 'error', message: 'Dieser Ordner kann nicht verwendet werden.', detail: problem });
    return null;
  }
  return dir;
}

/**
 * A backup that cannot run is the whole failure mode this path exists to prevent, so
 * say so instead of logging it (ELP-03) — the Settings hint is easy to never open.
 */
async function reportBackupProblem(err: unknown): Promise<void> {
  console.error('Backup übersprungen:', err);
  await dialog.showMessageBox({
    type: 'error',
    message: 'Es wurde keine Sicherung angelegt.',
    detail: `${(err as Error).message}\n\nEinstellungen → „Saison & Daten" → „Backup-Ordner" prüfen. Ohne funktionierenden Backup-Ordner werden beim Start keine Sicherungen erstellt.`,
  });
}

async function chooseBackupDir(): Promise<void> {
  const dir = await promptForDirectory();
  if (!dir) return;
  try {
    await patchSettings({ backup_dir: dir });
  } catch (err) {
    // Reloading here would show the old (or empty) folder as if nothing had happened.
    await dialog.showMessageBox({
      type: 'error',
      message: 'Der Backup-Ordner konnte nicht gespeichert werden.',
      detail: `${(err as Error).message}\n\nEs werden weiterhin keine automatischen Sicherungen angelegt. Bitte erneut versuchen.`,
    });
    return;
  }
  mainWindow?.webContents.reload();
}

async function exportDatabase(): Promise<void> {
  const r = await dialog.showSaveDialog({
    title: 'Datenbank exportieren',
    defaultPath: `auftakt-${stamp()}.db`,
  });
  if (r.canceled || !r.filePath) return;
  try {
    await post('backup/export', { path: r.filePath });
    await dialog.showMessageBox({ message: 'Datenbank wurde exportiert.', type: 'info' });
  } catch (err) {
    await dialog.showMessageBox({ type: 'error', message: `Export fehlgeschlagen: ${(err as Error).message}` });
  }
}

async function importDatabase(): Promise<void> {
  const r = await dialog.showOpenDialog({
    title: 'Datenbank importieren',
    properties: ['openFile'],
    filters: [{ name: 'SQLite-Datenbank', extensions: ['db', 'sqlite'] }],
  });
  if (r.canceled || !r.filePaths[0]) return;

  // Check the file before offering to replace anything: a corrupt or foreign file
  // must never get as far as the confirmation dialog.
  try {
    const check = await post<{ ok: boolean; error?: string }>('backup/import/check', { path: r.filePaths[0] });
    if (!check.ok) {
      await dialog.showMessageBox({ type: 'error', message: check.error ?? 'Die Datei kann nicht importiert werden.' });
      return;
    }
  } catch (err) {
    await dialog.showMessageBox({ type: 'error', message: `Prüfung fehlgeschlagen: ${(err as Error).message}` });
    return;
  }

  const confirm = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Abbrechen', 'Importieren'],
    defaultId: 1,
    cancelId: 0,
    message: 'Die aktuelle Datenbank wird zuerst gesichert und dann ersetzt. Fortfahren?',
  });
  if (confirm.response !== 1) return;

  try {
    const { backup } = await post<{ backup: string }>('backup/import', { path: r.filePaths[0] });
    await dialog.showMessageBox({
      type: 'info',
      message: 'Import abgeschlossen. Die App wird neu gestartet.',
      detail: backup ? `Die bisherige Datenbank wurde gesichert:\n${backup}` : undefined,
    });
    app.relaunch();
    app.exit(0);
  } catch (err) {
    await dialog.showMessageBox({
      type: 'error',
      message: `Import fehlgeschlagen: ${(err as Error).message}`,
      detail: 'Die bisherige Datenbank wurde nicht verändert.',
    });
  }
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'Auftakt',
    backgroundColor: '#f6f6f4',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Never spawn a child BrowserWindow (a child would not inherit the preload,
  // but denying is the safe default); route allowlisted schemes out to the OS
  // through the same guard as the bridge (X-02 / Q1).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: 'deny' };
  });
  // Keep the renderer pinned to the app origin; any in-page navigation to an
  // off-origin URL is handed to the OS (if allowlisted) instead of loading in
  // the window.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const appOrigin = isDev ? DEV_URL : `http://localhost:${PORT}`;
    if (!url.startsWith(appOrigin)) {
      e.preventDefault();
      openExternalSafely(url);
    }
  });

  await mainWindow.loadURL(isDev ? DEV_URL : `http://localhost:${PORT}`);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Ask for a backup folder only once there is data worth protecting — on a first
 * launch the database is empty, and prompting then just produced an empty backup.
 *
 * The prompt is marked as shown only once a folder was actually saved (ELP-05).
 * Marking it before the cancel guard meant one stray click on „Abbrechen" — or a
 * failed save — permanently disabled the prompt, and the app then ran for months
 * with no backup and nothing but a hint in a Settings tab to say so.
 */
async function ensureBackupDir(): Promise<string> {
  const status = (await (await fetch(`http://localhost:${PORT}/api/backup/status`)).json()) as {
    backupDir: string;
    hasData: boolean;
    prompted: boolean;
  };
  if (status.backupDir) return status.backupDir;
  if (!status.hasData || status.prompted) return '';

  const chosen = await promptForDirectory();
  if (!chosen) return '';
  await patchSettings({ backup_dir: chosen });
  await post('backup/prompted', {});
  return chosen;
}

app.whenReady().then(async () => {
  if (!isDev) {
    try {
      await startServer();
    } catch (err) {
      // Nothing works without the bundled server, and every failure here is silent by
      // nature (a health-check timeout, an unresolvable ESM import). Unhandled, the
      // whole handler rejects: no window, no message, just a dock icon (ELP-06).
      await dialog.showMessageBox({
        type: 'error',
        message: 'Auftakt konnte nicht gestartet werden.',
        detail: `${(err as Error).message}\n\nBitte die App erneut öffnen. Bleibt der Fehler bestehen, hilft eine Neuinstallation.`,
      });
      app.exit(1);
      return;
    }
    try {
      const backupDir = await ensureBackupDir();
      if (backupDir) await runStartupBackup(PORT, backupDir);
    } catch (err) {
      await reportBackupProblem(err);
    }
  }

  Menu.setApplicationMenu(
    buildMenu({ onExport: exportDatabase, onImport: importDatabase, onChooseBackup: chooseBackupDir }),
  );
  await createWindow();

  // Silent update check; the result surfaces as a hint in the Settings card.
  if (!isDev) startSilentStartupCheck();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Preload bridge → main. React never touches Electron APIs directly.
ipcMain.handle('open-external', (_e, url: string) => openExternalSafely(url));
ipcMain.handle('export-db', () => exportDatabase());
ipcMain.handle('import-db', () => importDatabase());
ipcMain.handle('choose-backup-dir', () => chooseBackupDir());
ipcMain.handle('get-version', () => app.getVersion());
ipcMain.handle('check-updates', (_e, refresh: boolean) => checkForUpdates(refresh));
ipcMain.handle('install-update', () => downloadAndInstallUpdate());
