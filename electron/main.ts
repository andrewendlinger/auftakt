import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileStamp } from '../shared/time';
import { buildMenu } from './menu';
import { backupDirProblem, runStartupBackup } from './backup';
import { checkForUpdates, downloadAndInstallUpdate, startSilentStartupCheck } from './updater';

const isDev = !app.isPackaged;
// `??` would only catch null/undefined, and Number('') is 0 — an empty AUFTAKT_PORT
// then made the server bind an ephemeral port while main polled localhost:0 until the
// health check timed out and no window ever opened (ELP-07).
const PORT = Number(process.env.AUFTAKT_PORT) || 4317;
/**
 * Reach the bundled server by address, never by name. It binds 127.0.0.1 explicitly
 * (`server/src/index.ts`), but `localhost` resolves ::1 first on Windows, so every
 * request here opened a doomed IPv6 connection and waited for it to be refused before
 * retrying over IPv4. Node's autoSelectFamily caps that at 250 ms per connection, which
 * is cheap only when the stack refuses promptly — behind a firewall that drops instead,
 * it is a stall on the one code path that gates the window.
 *
 * Safe as an origin change: the server already allowlists this exact origin and has
 * 127.0.0.1 in its loopback set, and `auftakt-booted` — the only web-storage key in the
 * app — is sessionStorage, so nothing is keyed to the old origin.
 */
const ORIGIN = `http://127.0.0.1:${PORT}`;
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

/**
 * True only when `url` really is the app's own origin. A prefix match is not enough
 * (ELP-02): `http://localhost:4317@evil.com` starts with the app origin but its host
 * is evil.com, so a link like that used to load attacker content inside the trusted
 * window instead of being pushed out to the browser. Compare parsed origins, the way
 * isAllowedExternalUrl already parses its input.
 */
function isAppOrigin(url: string, appOrigin: string): boolean {
  try {
    return new URL(url).origin === new URL(appOrigin).origin;
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

/**
 * POST to the local server and surface failures as a German error dialog.
 * All database-file work lives server-side (it owns the SQLite connections);
 * this process only supplies the paths the user picked in a dialog.
 */
async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${ORIGIN}/api/${path}`, {
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
        const r = await fetch(`${ORIGIN}/api/health`);
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
 * Save the backup folder and treat a non-OK response as the failure it is (ELP-04): a
 * silently dropped save leaves the user believing backups are set up while no startup
 * backup ever runs again.
 *
 * Its own endpoint rather than a settings PATCH (WP-39) — the folder lives in the registry
 * now, so it is season-independent and one choice covers every season.
 */
async function saveBackupDir(dir: string): Promise<void> {
  const r = await fetch(`${ORIGIN}/api/backup/dir`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dir }),
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
    detail: `${(err as Error).message}\n\nEinstellungen → „Saison & Daten“ → „Backup-Ordner“ prüfen. Ohne funktionierenden Backup-Ordner werden beim Start keine Sicherungen erstellt.`,
  });
}

async function chooseBackupDir(): Promise<void> {
  const dir = await promptForDirectory();
  if (!dir) return;
  try {
    await saveBackupDir(dir);
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
    // Local wall-clock time, the same helper the server's backup folders use: a UTC stamp
    // named the export after the previous day for anyone east of Greenwich (ELP-09).
    defaultPath: `auftakt-${fileStamp()}.db`,
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
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'Auftakt',
    // Created hidden. A window shown at construction is on screen before loadURL has
    // fetched anything, so the user gets an empty rectangle for the whole renderer boot
    // — the bundle fetch, a 1.3 MB parse and React's first mount. backgroundColor keeps
    // that rectangle from being white, but cream-coloured nothing is still nothing.
    // ready-to-show waits until the renderer has a frame to present, which is the boot
    // screen's first frame, so window and boot screen appear together.
    show: false,
    backgroundColor: '#f6f6f4',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;

  win.once('ready-to-show', () => win.show());
  // ready-to-show never fires if the load fails, and a window that stays hidden is worse
  // than one that flashes empty: app.on('activate') counts hidden windows too, so it
  // would not create a replacement, and the app would sit with a dock icon and no way
  // back. Show it regardless once it is clear no frame is coming.
  const showAnyway = setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  }, 3000);
  win.on('closed', () => {
    clearTimeout(showAnyway);
    mainWindow = null;
  });

  // Never spawn a child BrowserWindow (a child would not inherit the preload,
  // but denying is the safe default); route allowlisted schemes out to the OS
  // through the same guard as the bridge (X-02 / Q1).
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: 'deny' };
  });
  // Keep the renderer pinned to the app origin; any in-page navigation to an
  // off-origin URL is handed to the OS (if allowlisted) instead of loading in
  // the window.
  win.webContents.on('will-navigate', (e, url) => {
    const appOrigin = isDev ? DEV_URL : ORIGIN;
    if (!isAppOrigin(url, appOrigin)) {
      e.preventDefault();
      openExternalSafely(url);
    }
  });

  // Awaited outside whenReady's try/catch until now, so a rejection here was an
  // unhandled rejection and a permanently blank window with nothing said about it —
  // the same silent failure ELP-06 fixed one step earlier, for the server.
  try {
    await win.loadURL(isDev ? DEV_URL : ORIGIN);
  } catch (err) {
    if (win.isDestroyed()) return;
    win.show();
    await dialog.showMessageBox(win, {
      type: 'error',
      message: 'Die Oberfläche konnte nicht geladen werden.',
      detail: `${(err as Error).message}\n\nBitte die App erneut öffnen. Bleibt der Fehler bestehen, hilft eine Neuinstallation.`,
    });
  }
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
  const status = (await (await fetch(`${ORIGIN}/api/backup/status`)).json()) as {
    backupDir: string;
    hasData: boolean;
    prompted: boolean;
  };
  if (status.backupDir) return status.backupDir;
  if (!status.hasData || status.prompted) return '';

  const chosen = await promptForDirectory();
  if (!chosen) return '';
  await saveBackupDir(chosen);
  await post('backup/prompted', {});
  return chosen;
}

/**
 * One Auftakt at a time. Without the lock a second launch — a double-clicked Windows
 * shortcut, the usual way this happens — did not fail cleanly: waitForServer() polls
 * /api/health, the *first* instance answers 200, so the gate passes and a second window
 * opens against the first instance's database. The second app.listen then emits
 * EADDRINUSE with nothing awaiting it, long after the import that started it resolved,
 * so it surfaces as a generic Electron error at unrelated timing. docs/VERIFYING.md
 * already documents this shape for a dev server colliding with a packaged app; two
 * packaged copies collide the same way, and the two renderers compete for the CPU during
 * exactly the seconds the boot screen needs it.
 *
 * exit(), not quit(): quit is asynchronous and would let the rest of this module run on
 * and import the server anyway. The `gotLock` guard on whenReady does not depend on
 * exit() being immediate.
 */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.exit(0);

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  if (!gotLock) return;
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
  }

  Menu.setApplicationMenu(
    buildMenu({ onExport: exportDatabase, onImport: importDatabase, onChooseBackup: chooseBackupDir }),
  );
  await createWindow();

  // Deliberately not awaited (ELP-08): the startup backup VACUUMs every season and
  // prunes the restore points — real disk I/O the window does not depend on, which on
  // a large festival database left the user staring at a blank dock icon. Running it
  // after the window is up also means the first-run folder prompt appears over the app
  // instead of over an empty desktop.
  if (!isDev) {
    void (async () => {
      const backupDir = await ensureBackupDir();
      if (backupDir) await runStartupBackup(PORT, backupDir);
    })().catch(reportBackupProblem);

    // Silent update check; the result surfaces as a hint in the Settings card.
    startSilentStartupCheck();
  }

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
