import { app, BrowserWindow, Menu, contentTracing, dialog, ipcMain, screen, shell } from 'electron';
import { enableCompileCache } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileStamp } from '../shared/time';
import { buildMenu } from './menu';
import { backupDirProblem, runStartupBackup } from './backup';
import { writeBootReport } from './bootLog';
import { checkForUpdates, downloadAndInstallUpdate, startSilentStartupCheck } from './updater';

const isDev = !app.isPackaged;

// Cache V8's compilation of the server bundle across launches. It cannot help this file
// — main.cjs is already compiling by the time this line runs — but startServer() imports
// server/dist/index.mjs, 3.4 MB of bundled JS that is parsed and compiled on every single
// launch, before any window exists. Second and later launches skip that.
//
// Best-effort by design: it needs Node 22.1+, and a cold or unwritable cache directory
// only means the old cost, not a failure worth surfacing.
try {
  enableCompileCache(join(app.getPath('userData'), 'v8-cache'));
} catch {
  /* older runtime, or nowhere to write — the bundle just compiles from source */
}

// Windows groups taskbar buttons and attributes notifications by this id; without it
// Electron guesses from the executable and a packaged build can land under a different
// button than its own shortcut. Must match electron-builder.yml's appId.
if (process.platform === 'win32') app.setAppUserModelId('com.auftakt.app');
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
 * The server already allowlists this exact origin and has 127.0.0.1 in its loopback set,
 * so the API side is a non-event. Web storage is not: Chromium buckets it per origin, and
 * `http://localhost:4317` and `http://127.0.0.1:4317` are two origins. The audit that
 * cleared this change looked only at our own code — where the sole key really is
 * `auftakt-booted`, and really is sessionStorage — and missed that a dependency has one
 * too. `emoji-picker-react` keeps the „frequently used" list under `epr_suggested` in
 * localStorage, reachable from the notes editor, so upgrading past this build resets that
 * list once. The old bucket still exists on disk and is unreachable from the new origin;
 * there is no supported way to read another origin's localStorage from the main process,
 * and a recently-used emoji list does not justify inventing one. Accepted, once, and
 * recorded in docs/DECISIONS.md — the point of writing it down is that the next thing
 * stored in localStorage will not be an emoji list.
 */
const ORIGIN = `http://127.0.0.1:${PORT}`;
const DEV_URL = process.env.AUFTAKT_DEV_URL ?? 'http://localhost:5317';

/**
 * A window to talk to, if there is still one — the focused window first, else any that is
 * not destroyed. Derived from Electron's own registry rather than a module-level reference:
 * with several windows, a single `mainWindow` slot was nulled by whichever window closed
 * *last wrote it*, so closing window A disabled dialogs while window B was still on screen.
 * Anything that can outlive the windows (the startup chores, which the quit path releases
 * and then waits on) has to ask before it puts something on screen.
 */
function liveWindow(): BrowserWindow | null {
  return (
    BrowserWindow.getFocusedWindow() ??
    BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ??
    null
  );
}

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

/**
 * Nothing is on screen while this runs — not even a window — so every millisecond here
 * is dark time. A flat 150 ms interval charged the full 150 ms whenever the server bound
 * just after a poll was refused, which is the common case: the listen call is a few ticks
 * behind the import that triggered it. Start tight and back off to the old interval, so
 * the usual launch pays ~15 ms and a genuinely slow one is polled no harder than before.
 */
function waitForServer(timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  let delay = 15;
  return new Promise((res, rej) => {
    const tick = async () => {
      try {
        const r = await fetch(`${ORIGIN}/api/health`);
        if (r.ok) return res();
      } catch {
        /* not up yet */
      }
      if (Date.now() - start > timeoutMs) return rej(new Error('Server-Start Zeitüberschreitung'));
      setTimeout(tick, delay);
      delay = Math.min(delay * 2, 150);
    };
    void tick();
  });
}

/**
 * Save the backup folder. Through post(), so a non-OK response is the failure it is
 * (ELP-04) rather than something a caller has to remember to check: a silently dropped
 * save leaves the user believing backups are set up while no startup backup ever runs
 * again.
 *
 * Its own endpoint rather than a settings PATCH (WP-39) — the folder lives in the registry
 * now, so it is season-independent and one choice covers every season.
 */
async function saveBackupDir(dir: string): Promise<void> {
  await post('backup/dir', { dir });
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
 *
 * Except with no window left, which the quit path made reachable: close the window with
 * an unreachable backup folder — an unplugged drive, a renamed Google-Drive folder — and
 * window-all-closed releases the chores, this throws, and a modal error box opens on an
 * empty desktop *after* the user quit. QUIT_CHORES_MS then fires app.quit() out from
 * under it, so the message can vanish before it has been read. Same reasoning as the
 * folder picker in ensureBackupDir; here the fallback is the log line above.
 */
async function reportBackupProblem(err: unknown): Promise<void> {
  console.error('Backup übersprungen:', err);
  if (!liveWindow()) return;
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
  // Every window shows the folder in its Einstellungen — reload them all, not just the
  // one the click came from.
  for (const w of BrowserWindow.getAllWindows()) w.webContents.reload();
}

/** An IPC argument is untrusted: only a positive integer passes, anything else → default. */
function asSeasonId(v: unknown): number | undefined {
  return Number.isInteger(v) && (v as number) > 0 ? (v as number) : undefined;
}

/**
 * The caller's season as the routing middleware's ?season= query leg — main's requests
 * carry no Origin and no header, so without this they resolve the registry default.
 */
function seasonPath(path: string, seasonId?: number): string {
  return seasonId === undefined ? path : `${path}?season=${seasonId}`;
}

/**
 * The season pinned in the focused window, for the MENU-initiated export/import — the
 * Einstellungen buttons pass their window's pin through IPC instead. A read-only peek;
 * undefined (→ the default season) when there is no window, no pin, or the peek fails.
 */
async function focusedWindowSeason(): Promise<number | undefined> {
  const win = liveWindow();
  if (!win) return undefined;
  try {
    const raw: unknown = await win.webContents.executeJavaScript('sessionStorage.getItem("auftakt-season")');
    return asSeasonId(Number(raw));
  } catch {
    return undefined;
  }
}

/** The registry label of `seasonId` (or of the default), for naming dialogs. Best-effort. */
async function seasonLabel(seasonId?: number): Promise<string> {
  try {
    const r = await fetch(`${ORIGIN}/api/seasons`);
    const reg = (await r.json()) as { activeId: number; seasons: Array<{ id: number; label: string }> };
    return reg.seasons.find((s) => s.id === (seasonId ?? reg.activeId))?.label ?? '';
  } catch {
    return '';
  }
}

async function exportDatabase(seasonId?: number): Promise<void> {
  const r = await dialog.showSaveDialog({
    title: 'Datenbank exportieren',
    // Local wall-clock time, the same helper the server's backup folders use: a UTC stamp
    // named the export after the previous day for anyone east of Greenwich (ELP-09).
    defaultPath: `auftakt-${fileStamp()}.db`,
  });
  if (r.canceled || !r.filePath) return;
  try {
    await post(seasonPath('backup/export', seasonId), { path: r.filePath });
    await dialog.showMessageBox({ message: 'Datenbank wurde exportiert.', type: 'info' });
  } catch (err) {
    await dialog.showMessageBox({ type: 'error', message: `Export fehlgeschlagen: ${(err as Error).message}` });
  }
}

async function importDatabase(seasonId?: number): Promise<void> {
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

  // Name the season the import will replace: with per-window seasons, „die aktuelle
  // Datenbank" no longer says which one that is.
  const label = await seasonLabel(seasonId);
  const confirm = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Abbrechen', 'Importieren'],
    defaultId: 1,
    cancelId: 0,
    message: label
      ? `„${label}“ wird zuerst gesichert und dann ersetzt. Fortfahren?`
      : 'Die aktuelle Datenbank wird zuerst gesichert und dann ersetzt. Fortfahren?',
  });
  if (confirm.response !== 1) return;

  try {
    const { backup } = await post<{ backup: string }>(seasonPath('backup/import', seasonId), { path: r.filePaths[0] });
    await dialog.showMessageBox({
      type: 'info',
      message: 'Import abgeschlossen. Alle Fenster werden geschlossen und die App wird neu gestartet.',
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

/** Default window size — also the wrap bound for the cascade below; keep them together. */
const WIN_W = 1440;
const WIN_H = 900;

async function createWindow(): Promise<void> {
  // Sampled BEFORE construction — a moment later the count would include this window.
  // A secondary window cascades off the focused one and skips the boot gesture (its
  // ?noboot flag; see client/index.html): the gesture already played in the first window,
  // and without an offset every window opens 1440×900 centered — perfectly stacked.
  const others = BrowserWindow.getAllWindows();
  const isSecondary = others.length > 0;
  let position: { x: number; y: number } | undefined;
  if (isSecondary) {
    const src = (BrowserWindow.getFocusedWindow() ?? others[others.length - 1]!).getBounds();
    // Wrap, don't clamp — a clamp stacks every further window into the same corner.
    // getDisplayMatching keeps the cascade on the monitor the user is working on.
    const wa = screen.getDisplayMatching(src).workArea;
    const CASCADE = 28;
    let x = src.x + CASCADE;
    let y = src.y + CASCADE;
    if (x + WIN_W > wa.x + wa.width) x = wa.x + CASCADE;
    if (y + WIN_H > wa.y + wa.height) y = wa.y + CASCADE;
    position = { x, y };
  }

  const win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    ...position,
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

  // ready-to-show never fires if the load fails, and a window that stays hidden is worse
  // than one that flashes empty: app.on('activate') counts hidden windows too, so it
  // would not create a replacement, and the app would sit with a dock icon and no way
  // back. Show it regardless once it is clear no frame is coming.
  const showAnyway = setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  }, 3000);
  // Disarmed as soon as a frame has been presented, not only when the window closes.
  // isVisible() is false for a window the user has since minimized, and „no frame came"
  // and „the user put it away" are the same reading to it — so a timer left armed
  // un-minimized the window three seconds into a perfectly normal launch, against an
  // explicit action. Once ready-to-show has fired there is nothing left for it to fix.
  win.once('ready-to-show', () => {
    clearTimeout(showAnyway);
    win.show();
  });
  win.on('closed', () => clearTimeout(showAnyway));

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
  // ?noboot sits in the search component, before any hash: the boot gate's head script
  // reads location.search, HashRouter reads only the hash, and will-navigate above
  // compares origins — none of them collide. Appended in dev too (harmless: the gate
  // already short-circuits on %PROD%), so this line stays branch-free.
  try {
    const base = isDev ? DEV_URL : ORIGIN;
    await win.loadURL(isSecondary ? `${base}/?noboot=1` : base);
  } catch (err) {
    if (win.isDestroyed()) return;
    clearTimeout(showAnyway);
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
  // Never open a folder picker with nothing behind it. The chores can now also be
  // released by the window closing (see window-all-closed), and a modal appearing on an
  // empty desktop *after* the user quit reads as a hang, not as a prompt. Leaving
  // `prompted` unset is the right outcome: the next launch asks properly.
  if (!liveWindow()) return '';

  const chosen = await promptForDirectory();
  if (!chosen) return '';
  await saveBackupDir(chosen);
  await post('backup/prompted', {});
  return chosen;
}

let chores: Promise<unknown> | null = null;

/**
 * The startup backup and the update check, held until the boot screen has gone.
 *
 * Still not awaited (ELP-08) — the window must not wait on disk I/O — but "not awaited"
 * was never the same as "not blocking". runStartupBackup POSTs to the bundled server,
 * and that server is imported into *this* process, so its VACUUM INTO per season runs
 * synchronously on this event loop: a saturated core, a hammered disk, and no input
 * routing, which is why click-to-skip went dead during the gesture. ensureBackupDir can
 * also open a modal folder picker over the animation.
 *
 * The timing was as bad as it could be, and deterministically so rather than by luck.
 * createWindow() awaits loadURL, which resolves on did-finish-load — after the 1.3 MB
 * bundle has been fetched *and executed* — so this block used to fire at the moment
 * React had just mounted, inside the gesture's first second, on every launch.
 *
 * Idempotent because it has four callers: the renderer's signal, the 8 s fallback, a
 * renderer that reloads itself (a season switch, or the reload after saving a backup
 * folder) and signals a second time, and the last window closing. It returns the same
 * promise to all of them rather than nothing, because that last caller has to know when
 * the backup is finished — it is on its way to app.quit().
 */
function runStartupChores(): Promise<unknown> {
  if (chores) return chores;
  if (isDev) return (chores = Promise.resolve());
  chores = (async () => {
    const backupDir = await ensureBackupDir();
    if (backupDir) await runStartupBackup(ORIGIN, backupDir);
  })().catch(reportBackupProblem);

  // Silent update check; the result surfaces as a hint in the Settings card. Not awaited
  // by the promise above: it is a background HTTP call whose only output is a hint in a
  // Settings card, so nothing should ever wait on it — least of all a quit.
  startSilentStartupCheck();
  return chores;
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
 *
 * Exiting without a dialog is right for the case this is built for — a user double-clicks
 * the shortcut again, the running instance takes `second-instance` and opens a new window,
 * and a message box would only be noise. It is not right for a developer, and there is no way
 * to tell the two apart from here: Electron keys the lock on the userData directory, and
 * on macOS's case-insensitive default volume `.../auftakt` (dev) and `.../Auftakt`
 * (packaged) are the same lock, so `npm run electron:dev` against an installed copy dies
 * on this line and returns to the prompt having printed nothing at all. It used to fail
 * loudly with EADDRINUSE on :4317, a shape docs/VERIFYING.md documents. Hence a line on
 * stderr: invisible to users, and the one thing that would have made that silence legible.
 */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.error(
    'Auftakt läuft bereits — dieser Start wird beendet. ' +
      '(Single-Instance-Lock; im Dev-Modus kollidiert er mit einer installierten Auftakt-App.)',
  );
  app.exit(0);
}

/**
 * Stops the AUFTAKT_BOOT_TRACE recording and resolves once the file is on disk. Null
 * when tracing is off. Memoised inside, so the settle timer, the cap timer and the quit
 * paths below all await the same one write.
 */
let stopBootTrace: (() => Promise<void>) | null = null;

/** Set once whenReady has had its turn at creating the first window. See below. */
let startupDone = false;
/** Set once the last window has closed and the quit is only waiting on the chores. */
let quitting = false;

app.on('second-instance', () => {
  // A second launch opens a NEW window (the multi-window convention — Chrome, VS Code):
  // double-clicking the shortcut again is how a Windows user asks for another window,
  // and raising the existing one answers a question nobody asked. Two guards survive
  // from the raise era, both still load-bearing:
  //
  // Gated on startupDone so this cannot race the first window into existence: during
  // those first seconds whenReady is already about to create one, and answering the
  // click here would open a second.
  //
  // Off macOS there is a third state between „a window" and „no process":
  // window-all-closed holds the lock for up to QUIT_CHORES_MS while the startup chores
  // finish. A user who closes the window and relaunches straight away lands in it, and
  // the second instance has already exited against our lock by the time this runs — so
  // opening a window here is the only way they get one at all. Call off the quit as well
  // as opening it, or app.quit() would tear the new window down a moment later and the
  // relaunch would read as an app that opened and died.
  if (!startupDone) return;
  quitting = false;
  void createWindow();
});

app.whenReady().then(async () => {
  if (!gotLock) return;

  /* Opt-in boot tracing, for the launches the headless checks cannot represent — a real
     cold start on a real panel is the one path they never covered. AUFTAKT_BOOT_TRACE=1
     records from before the window until shortly after the boot settles (capped at ~6 s,
     or the env var's value in ms) to userData/boot-trace-<stamp>.json, loadable at
     ui.perfetto.dev. Started before startServer() so the 3.4 MB server bundle's import
     and compile are in the picture. The categories are picked to answer "who stole the
     frames": disabled-by-default-v8.compile is the cold-code-cache signature, cc/gpu
     carry raster and the GPU process, and blink.user_timing carries the overlay's
     auftakt:* marks, so the gesture's phases sit on the same timeline as whatever ran
     through them. Tracing has overhead of its own — a traced run attributes a stall, it
     does not time it honestly. */
  if (process.env.AUFTAKT_BOOT_TRACE) {
    const n = Number(process.env.AUFTAKT_BOOT_TRACE);
    const traceMs = n > 1 ? n : 6000;
    try {
      await contentTracing.startRecording({
        included_categories: [
          'devtools.timeline',
          'disabled-by-default-devtools.timeline',
          'disabled-by-default-devtools.timeline.frame',
          'disabled-by-default-v8.compile',
          'toplevel',
          'v8.execute',
          'blink.user_timing',
          'cc',
          'gpu',
        ],
      });
      /* Memoised: the settle timer, the cap timer and the quit path all funnel into the
         same single stopRecording, and a caller that arrives while the write is already
         in flight gets the in-flight promise to await rather than a fresh no-op — that
         is what lets before-quit hold the quit until the file is actually on disk. The
         first traced field run proved the need the hard way: a ~6 s trace is several MB,
         the flush takes real time, and quitting mid-write left a
         .com.auftakt.app.XXXXXX temp file and no trace, twice. */
      let traceWrite: Promise<void> | null = null;
      stopBootTrace = () =>
        (traceWrite ??= contentTracing
          .stopRecording(join(app.getPath('userData'), `boot-trace-${fileStamp()}.json`))
          .then(
            (path) => console.log('Boot-Trace geschrieben:', path),
            () => {
              /* recording already gone — nothing to write */
            },
          ));
      const stop = stopBootTrace;
      setTimeout(() => void stop(), traceMs);
    } catch {
      /* a trace that cannot start must not stop the app from starting */
    }
  }

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
    buildMenu({
      onNewWindow: () => void createWindow(),
      // Menu clicks carry no renderer context, so the season comes from the focused window.
      onExport: () => void focusedWindowSeason().then(exportDatabase),
      onImport: () => void focusedWindowSeason().then(importDatabase),
      onChooseBackup: chooseBackupDir,
    }),
  );
  await createWindow();
  startupDone = true;

  // The renderer normally releases these (see runStartupChores). It might not: a crashed
  // or wedged renderer must not cost the user their backup for the launch — and that
  // launch is exactly the one the boot log must still have a line for, because the
  // renderer's own report died with it. bootReported distinguishes "released late" from
  // "never heard from".
  if (!isDev)
    setTimeout(() => {
      if (!bootReported)
        writeBootReport(
          app.getPath('userData'),
          { outcome: 'no-report', why: 'fallback-8s' },
          app.getVersion(),
        );
      void runStartupChores();
    }, 8000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

/** Longest a quit will wait on the startup chores it just released. */
const QUIT_CHORES_MS = 5000;

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return;
  // The 8 s fallback above lives on a timer, and app.quit() destroys the process it runs
  // in — so a window closed before the boot overlay reported back (a wedged renderer that
  // never revealed, or just an impatient user during the hold) took the whole launch's
  // startup backup and update check with it, silently. Release them here instead of
  // racing them, and let them settle before quitting: runStartupChores is idempotent, so
  // on the ordinary path this is an already-settled promise and the quit is immediate.
  // Capped, because ensureBackupDir's fetch has no timeout of its own and a wedged server
  // must not turn „close the window" into „the app will not exit".
  quitting = true;
  let cap: NodeJS.Timeout;
  // finally, not then: `chores` ends in .catch(reportBackupProblem), and that handler is
  // itself async — it awaits a dialog. Anything it throws rejects the race, and with only
  // a fulfilment handler the quit would simply never happen: no windows, no app.quit(),
  // a process the user can end only from the task manager. The cap cannot save that,
  // because the race has already settled.
  void Promise.race([
    runStartupChores(),
    new Promise((resolve) => {
      cap = setTimeout(resolve, QUIT_CHORES_MS);
    }),
  ]).finally(() => {
    clearTimeout(cap);
    // Unless a relaunch arrived while this was waiting and took the instance back over
    // (see second-instance); the window it opened must not be quit out from under it.
    if (quitting) app.quit();
  });
});

// Preload bridge → main. React never touches Electron APIs directly.
ipcMain.handle('open-external', (_e, url: string) => openExternalSafely(url));
ipcMain.handle('export-db', (_e, seasonId: unknown) => exportDatabase(asSeasonId(seasonId)));
ipcMain.handle('import-db', (_e, seasonId: unknown) => importDatabase(asSeasonId(seasonId)));
ipcMain.handle('choose-backup-dir', () => chooseBackupDir());
ipcMain.handle('get-version', () => app.getVersion());
ipcMain.handle('check-updates', (_e, refresh: boolean) => checkForUpdates(refresh));
ipcMain.handle('install-update', () => downloadAndInstallUpdate());
/** Whether any renderer settle arrived, so the 8 s fallback can log its absence. */
let bootReported = false;
// Sent from the boot overlay's single exit path, not from React — see runStartupChores.
// Deliberately not returning the chores' promise: the renderer does not await this, and
// holding the IPC reply open for the length of a VACUUM would only invent a way for that
// to matter. The quit path is the one caller that needs the promise, and it has it.
// The payload is the boot report; every settle writes a line, so a season switch's
// reload logs `skip / warm` — that is the log proving the reload, not noise.
ipcMain.handle('boot-settled', (_e, report: unknown) => {
  bootReported = true;
  if (!isDev) writeBootReport(app.getPath('userData'), report, app.getVersion());
  // Everything the boot trace exists for is over once the overlay has settled; 750 ms
  // of margin catches the reveal's last frames and the released chores starting. Ending
  // here rather than at the cap keeps the file small and beats the user's quit in the
  // common case — the first field run showed a traced boot is watched, quit, relaunched
  // within seconds.
  if (stopBootTrace) {
    const stop = stopBootTrace;
    setTimeout(() => void stop(), 750);
  }
  void runStartupChores();
});

/**
 * A boot abandoned before the overlay settled must still leave a log line. The 8 s
 * fallback cannot be that line's writer on macOS: it lives on a timer in the process
 * app.quit() destroys — the same shape the chores had (see window-all-closed above) —
 * and darwin never takes the window-all-closed path at all. The first field runs hit
 * exactly this: launches quit right after the reveal left an empty log, and the absence
 * read as "the diagnostics are broken" rather than "the boot was abandoned".
 *
 * The write is synchronous and reuses bootReported as its once-latch. The trace flush is
 * the async half: before-quit holds the quit until the in-flight write lands (nulling
 * the handle first, so the re-entrant quit passes through), because a multi-MB
 * stopRecording loses a race against process teardown — the first traced field run left
 * only an unrenamed temp file, twice.
 */
function writeAbandonedBootLine() {
  if (bootReported || isDev) return;
  bootReported = true;
  writeBootReport(app.getPath('userData'), { outcome: 'no-report', why: 'quit' }, app.getVersion());
}
app.on('before-quit', (e) => {
  writeAbandonedBootLine();
  if (stopBootTrace) {
    const stop = stopBootTrace;
    stopBootTrace = null;
    e.preventDefault();
    void stop().finally(() => app.quit());
  }
});
// A traced launch is started from a terminal (open -a drops env), so it usually ends in
// Ctrl-C — and SIGINT never reaches before-quit. Same bookkeeping, explicit exit.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    writeAbandonedBootLine();
    const stop = stopBootTrace;
    stopBootTrace = null;
    if (stop) void stop().finally(() => app.exit(0));
    else app.exit(0);
  });
}
