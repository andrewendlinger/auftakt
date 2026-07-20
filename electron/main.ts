import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { copyFileSync, existsSync } from 'node:fs';
import { buildMenu } from './menu';
import { runStartupBackup } from './backup';

const isDev = !app.isPackaged;
const PORT = Number(process.env.AUFTAKT_PORT ?? 4317);
const DEV_URL = process.env.AUFTAKT_DEV_URL ?? 'http://localhost:5317';

let mainWindow: BrowserWindow | null = null;

/** The data dir holding the season DBs + seasons.json: dev → repo/.data; packaged → userData. */
function dataDir(): string {
  return isDev ? resolve(app.getAppPath(), '.data') : app.getPath('userData');
}

/** The active season's DB file, resolved from the running server's season registry. */
async function activeDbPath(): Promise<string> {
  const r = await fetch(`http://localhost:${PORT}/api/seasons`);
  const j = (await r.json()) as { activeFile: string };
  return j.activeFile;
}

function stamp(): string {
  return new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
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

async function patchSettings(patch: Record<string, unknown>): Promise<void> {
  await fetch(`http://localhost:${PORT}/api/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

async function promptForDirectory(): Promise<string | null> {
  const r = await dialog.showOpenDialog({
    title: 'Backup-Ordner wählen (z. B. Google Drive)',
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
}

async function chooseBackupDir(): Promise<void> {
  const dir = await promptForDirectory();
  if (dir) {
    await patchSettings({ backup_dir: dir });
    mainWindow?.webContents.reload();
  }
}

async function exportDatabase(): Promise<void> {
  const r = await dialog.showSaveDialog({
    title: 'Datenbank exportieren',
    defaultPath: `auftakt-${stamp()}.db`,
  });
  if (r.canceled || !r.filePath) return;
  copyFileSync(await activeDbPath(), r.filePath);
  await dialog.showMessageBox({ message: 'Datenbank wurde exportiert.', type: 'info' });
}

async function importDatabase(): Promise<void> {
  const r = await dialog.showOpenDialog({
    title: 'Datenbank importieren',
    properties: ['openFile'],
    filters: [{ name: 'SQLite-Datenbank', extensions: ['db', 'sqlite'] }],
  });
  if (r.canceled || !r.filePaths[0]) return;
  const confirm = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Abbrechen', 'Importieren'],
    defaultId: 1,
    cancelId: 0,
    message: 'Die aktuelle Datenbank wird zuerst gesichert und dann ersetzt. Fortfahren?',
  });
  if (confirm.response !== 1) return;
  // Safety backup of the active season's DB before overwriting it.
  const dest = await activeDbPath();
  if (existsSync(dest)) copyFileSync(dest, `${dest}.pre-import-${stamp()}.bak`);
  copyFileSync(r.filePaths[0], dest);
  await dialog.showMessageBox({ message: 'Import abgeschlossen. Die App wird neu gestartet.', type: 'info' });
  app.relaunch();
  app.exit(0);
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
  await mainWindow.loadURL(isDev ? DEV_URL : `http://localhost:${PORT}`);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  if (!isDev) {
    await startServer();
    try {
      const settings = (await (await fetch(`http://localhost:${PORT}/api/settings`)).json()) as {
        backup_dir?: string;
      };
      let backupDir = settings.backup_dir;
      if (!backupDir) {
        // First launch: pick the backup folder once.
        const chosen = await promptForDirectory();
        if (chosen) {
          await patchSettings({ backup_dir: chosen });
          backupDir = chosen;
        }
      }
      if (backupDir) runStartupBackup(await activeDbPath(), backupDir);
    } catch (err) {
      console.error('Backup übersprungen:', err);
    }
  }

  Menu.setApplicationMenu(
    buildMenu({ onExport: exportDatabase, onImport: importDatabase, onChooseBackup: chooseBackupDir }),
  );
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Preload bridge → main. React never touches Electron APIs directly.
ipcMain.handle('open-external', (_e, url: string) => shell.openExternal(url));
ipcMain.handle('export-db', () => exportDatabase());
ipcMain.handle('import-db', () => importDatabase());
ipcMain.handle('choose-backup-dir', () => chooseBackupDir());
