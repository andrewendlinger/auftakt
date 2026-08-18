import {
  app,
  BrowserWindow,
  Menu,
  contentTracing,
  dialog,
  ipcMain,
  screen,
  shell,
} from 'electron';
import { enableCompileCache } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, freemem, homedir, totalmem, release, version as osVersionName } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileStamp, localStamp } from '../shared/time';
import { buildDockMenu, buildMenu } from './menu';
import { activatePlan } from './activate';
import { backupDirProblem, runStartupBackup } from './backup';
import { WINDOW_MINIMUM, WINDOW_PREFERRED, cascadeBounds, fittedSize } from './cascade';
import { exportFileName } from './exportName';
import { readWindowBounds, usableBounds, writeWindowBounds } from './windowBounds';
import {
  BOOT_LOG_NAME,
  BOOT_REPORT_MAX_CHARS,
  bootDiagnostics,
  writeBootReport,
} from './bootLog';
import {
  buildDiagnosticsBundle,
  isBundleRef,
  systemLine,
  uniqueBundleName,
  type SystemFacts,
} from './diagnostics';
import { messageBox, openDialog, saveDialog } from './dialogs';
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

/**
 * Everything the machine can say about itself, for the diagnostics bundle (WP-54).
 *
 * Collected here because every source needs `electron` or `node:os`; the formatting is pure
 * and lives in `diagnostics.ts`, which is what `check:unit` can reach. Displays and the GPU
 * flags are the load-bearing half rather than padding: WP-61 is a boot gesture that flashes
 * and vanishes on one Windows machine and nowhere else, and `scaleFactor` plus
 * `gpu_compositing` are the two facts that separate a compositing fault from a timing one.
 *
 * `gpu` is opt-in because it is the only slow part. `get-diagnostics` runs on every open of
 * the feedback dialog and needs nothing but the OS and the primary display for its one-line
 * clause; making it wait on the GPU process for facts it does not print would leave the
 * „Was wird mitgeschickt?" preview blank for up to two seconds.
 */
async function collectSystemFacts({ gpu: withGpu = true } = {}): Promise<SystemFacts> {
  let gpuDevice = '';
  const gpu: Record<string, string> = {};
  if (withGpu) {
    try {
      // 'complete' carries the driver strings 'basic' leaves out, and those are what a
      // graphics fault is actually matched against. It goes through the GPU process, so it
      // can hang when that process is the thing that is wrong — which is exactly when this
      // report is being written. Losing one line beats never writing the file.
      const info = (await Promise.race([
        app.getGPUInfo('complete'),
        new Promise((r) => setTimeout(() => r(null), 2000)),
      ])) as { gpuDevice?: unknown[]; auxAttributes?: Record<string, unknown> } | null;
      const first = (info?.gpuDevice?.[0] ?? {}) as Record<string, unknown>;
      const hex = (v: unknown) => (typeof v === 'number' ? `0x${v.toString(16)}` : '');
      gpuDevice = [
        String(info?.auxAttributes?.glRenderer ?? ''),
        [hex(first.vendorId), hex(first.deviceId)].filter(Boolean).join(' / '),
        [first.driverVendor, first.driverVersion].filter(Boolean).join(' '),
      ]
        .filter(Boolean)
        .join(' · ');
    } catch {
      /* no GPU process to ask — the feature-status flags below still say something */
    }
    try {
      for (const [k, v] of Object.entries(app.getGPUFeatureStatus())) gpu[k] = String(v);
    } catch {
      /* same */
    }
  }

  const displays = screen.getAllDisplays().map((d) => ({
    width: d.size.width,
    height: d.size.height,
    scale: d.scaleFactor,
    rotation: d.rotation,
    colorDepth: d.colorDepth,
    internal: d.internal,
  }));

  return {
    app: app.getVersion(),
    packaged: app.isPackaged,
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
    platform: process.platform,
    arch: process.arch,
    osVersion: process.getSystemVersion(),
    osName: osVersionName(),
    osRelease: release(),
    cpu: cpus()[0]?.model.trim() ?? '',
    cores: cpus().length,
    memTotal: totalmem(),
    memFree: freemem(),
    displays,
    locale: app.getLocale(),
    systemLocale: app.getSystemLocale(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    gpu,
    gpuDevice,
    userData: app.getPath('userData'),
    dataDir: dataDir(),
    home: homedir(),
  };
}

/** What `save-diagnostics` reports back. The name is what the mail body tells them to attach. */
export type DiagnosticsSave = { ok: true; name: string } | { ok: false };

/**
 * Write the diagnostics bundle to the desktop (WP-54; the reveal removed by WP-66).
 *
 * The desktop rather than beside the log in userData: this file exists to be dragged into a
 * mail, and a folder the user already has open beats one they have to be sent into. It is
 * plainly theirs to delete afterwards, which a file in `AppData` is not.
 *
 * It used to `shell.showItemInFolder` the file it had just written, so that the customer met a
 * Finder/Explorer window on the way to their mail client. WP-66 took that out: the window
 * arrived before they had read anything, and the dialog now names the file instead. Nothing on
 * the feedback path opens anything the customer did not click.
 *
 * `ref` is the mail's own reference and the only renderer value that becomes a filename —
 * `isBundleRef` is why that is safe, and the directory is never the renderer's to choose.
 * `report` is the mail body, capped like the boot payload is: the renderer is the untrusted
 * side here too, and an unbounded string is a way to fill somebody's disk from a web page.
 */
async function saveDiagnostics(ref: unknown, report: unknown): Promise<DiagnosticsSave> {
  try {
    if (!isBundleRef(ref)) return { ok: false };
    const text = typeof report === 'string' ? report.slice(0, BOOT_REPORT_MAX_CHARS) : '';
    const logFile = join(app.getPath('userData'), BOOT_LOG_NAME);
    const log = existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
    const bundle = buildDiagnosticsBundle({
      ref,
      at: localStamp(),
      report: text,
      facts: await collectSystemFacts(),
      log,
      entries: log.split('\n').filter((l) => l.length > 0).length,
    });
    // Never over a bundle already lying there: the reference is minute resolution, and a
    // second report inside that minute would otherwise replace the first one's file while the
    // first one's mail still names it. `uniqueBundleName` picks the suffix and the renderer
    // sends whatever name comes back, so the mail and the file agree either way.
    const desktop = app.getPath('desktop');
    const name = uniqueBundleName(ref, (candidate) => existsSync(join(desktop, candidate)));
    const file = join(desktop, name);
    writeFileSync(file, bundle, 'utf8');
    return { ok: true, name };
  } catch {
    // A bundle that cannot be written must not cost the mail: the dialog composes without
    // the attachment line instead, and the summary in the body still travels.
    return { ok: false };
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
  // Only this process knows the app version — server/package.json carries its own, unrelated
  // one. It reaches the MANIFEST.txt of every restore point (WP-41), which is what tells a
  // customer years later which version wrote the backup they are about to restore.
  process.env.AUFTAKT_APP_VERSION = app.getVersion();
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

// The dialog helpers moved to `electron/dialogs.ts` when `updater.ts` needed them (WP-60):
// main.ts imports updater.ts, so the rule about parenting could not be shared from here.

/**
 * Pick a backup folder, rejecting one the startup backup could not use (ELP-03).
 * Validating here rather than only in runStartupBackup is the point: a Windows user
 * could pick a NAS share, see it accepted, and never learn that backups had stopped.
 */
async function promptForDirectory(win: BrowserWindow | null): Promise<string | null> {
  const r = await openDialog(win, {
    title: 'Backup-Ordner wählen (z. B. Google Drive)',
    properties: ['openDirectory', 'createDirectory'],
  });
  const dir = r.canceled ? null : (r.filePaths[0] ?? null);
  if (!dir) return null;
  const problem = backupDirProblem(dir);
  if (problem) {
    await messageBox(win, {
      type: 'error',
      message: 'Dieser Ordner kann nicht verwendet werden.',
      detail: problem,
    });
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
  const win = liveWindow();
  if (!win) return;
  await messageBox(win, {
    type: 'error',
    message: 'Es wurde keine Sicherung angelegt.',
    detail: `${(err as Error).message}\n\nEinstellungen → „Saison & Daten“ → „Backup-Ordner“ prüfen. Ohne funktionierenden Backup-Ordner werden beim Start keine Sicherungen erstellt.`,
  });
}

/**
 * The folder lives in the registry, so every window's Einstellungen shows it and every window
 * has to hear about a change — including the one that asked, whose click is fire-and-forget
 * (`window.auftakt.chooseBackupDir()` awaits nothing).
 *
 * This used to be `for (…) w.webContents.reload()`, which discarded unsaved drafts in windows
 * the user never touched: editors persist on blur and there is no `beforeunload` anywhere, so
 * a half-typed note in window B died when window A picked a folder (PR50-05). The renderers
 * already have a non-destructive way to refresh — the coalesced blanket invalidate behind the
 * BroadcastChannel — so main only has to say "something changed" and let them run it.
 *
 * One of the two main-initiated events in the app, hence one of the two `webContents.send`
 * calls; the other is the update download's percentage (`UPDATE_PROGRESS_CHANNEL` in
 * `updater.ts`), and the two differ in both halves: this one goes to *every* window and
 * carries no payload, that one to the single window that asked and carries a number.
 * Everything else is `ipcRenderer.invoke`, because everything else starts in a renderer.
 * BroadcastChannel cannot carry this — main is not a renderer and has no channel object.
 */
function notifyBackupConfigChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('backup-config-changed');
  }
}

async function chooseBackupDir(win: BrowserWindow | null): Promise<void> {
  // No liveWindow() fallback, deliberately. It returns any non-destroyed window, including a
  // *minimized* one — and a sheet on a window that is not on screen is a picker the user never
  // sees, i.e. a folder chooser that reads as a hang. Unparented is the better of the two: on
  // macOS it is app-modal and visible, which is also what export/import do with a null window.
  const dir = await promptForDirectory(win);
  if (!dir) return;
  try {
    await saveBackupDir(dir);
  } catch (err) {
    // No notify here: telling the windows to refresh would show the old (or empty) folder
    // as if nothing had happened.
    await messageBox(win, {
      type: 'error',
      message: 'Der Backup-Ordner konnte nicht gespeichert werden.',
      detail: `${(err as Error).message}\n\nEs werden weiterhin keine automatischen Sicherungen angelegt. Bitte erneut versuchen.`,
    });
    return;
  }
  notifyBackupConfigChanged();
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
 * The season pinned in `win`, for the MENU-initiated export/import — the Einstellungen buttons
 * pass their own window's pin through IPC instead. A read-only peek; undefined (→ the default
 * season) when there is no window, no pin, or the peek fails.
 *
 * The caller passes `BrowserWindow.getFocusedWindow()` and nothing else. This used to resolve
 * through `liveWindow()`, whose fallback is the *oldest* live window: with two windows on two
 * seasons and neither focused (both minimized, the app menu still active on macOS), the export
 * silently wrote the other window's season into the file the user had named for this one
 * (PR50-03). No focus now means undefined — the registry default — and the export names the
 * season it resolved, so a fallback is visible rather than silent.
 */
async function windowSeason(win: BrowserWindow | null): Promise<number | undefined> {
  if (!win || win.isDestroyed()) return undefined;
  try {
    // The renderer's own pin key, spelled `KEY` in client/src/lib/season.ts. This process
    // cannot import it — electron/tsconfig.json is `include: ["*.ts"]`, so nothing type-checks
    // across the boundary — which makes **grep the only coupling** between the two literals.
    // Rename one without the other and this silently returns undefined, i.e. the registry
    // default, and Datei → „Datenbank importieren…" replaces the wrong season's file (PR50-10).
    const raw: unknown = await win.webContents.executeJavaScript('sessionStorage.getItem("auftakt-season")');
    return asSeasonId(Number(raw));
  } catch {
    return undefined;
  }
}

/**
 * The registry label of `seasonId` (or of the default), for naming dialogs. Best-effort — and
 * timed out, because since PR50-03 the *export* resolves it before opening its save dialog, so
 * this call sits between the user's click and anything appearing on screen. The bundled server
 * shares this process's event loop with `runStartupBackup`'s per-season `VACUUM INTO`, so it
 * can be slow to answer at exactly the wrong moment. An empty label is a working dialog with a
 * generic name; no dialog at all reads as a broken menu item.
 */
async function seasonLabel(seasonId?: number): Promise<string> {
  try {
    const r = await fetch(`${ORIGIN}/api/seasons`, { signal: AbortSignal.timeout(1500) });
    const reg = (await r.json()) as { activeId: number; seasons: Array<{ id: number; label: string }> };
    return reg.seasons.find((s) => s.id === (seasonId ?? reg.activeId))?.label ?? '';
  } catch {
    return '';
  }
}

async function exportDatabase(seasonId: number | undefined, win: BrowserWindow | null): Promise<void> {
  // Name the season everywhere the user can see it — dialog, filename, confirmation — the way
  // importDatabase already names the one it replaces. Half of PR50-03: the resolution can fall
  // back to the registry default, and a fallback that names itself is recoverable where a
  // silent one hands out the wrong season's data with nothing on screen contradicting it.
  const label = await seasonLabel(seasonId);
  const r = await saveDialog(win, {
    title: label ? `„${label}“ exportieren` : 'Datenbank exportieren',
    // Local wall-clock time, the same helper the server's backup folders use: a UTC stamp
    // named the export after the previous day for anyone east of Greenwich (ELP-09).
    defaultPath: exportFileName(label, fileStamp()),
  });
  if (r.canceled || !r.filePath) return;
  try {
    await post(seasonPath('backup/export', seasonId), { path: r.filePath });
    await messageBox(win, {
      message: label ? `„${label}“ wurde exportiert.` : 'Datenbank wurde exportiert.',
      type: 'info',
    });
  } catch (err) {
    await messageBox(win, { type: 'error', message: `Export fehlgeschlagen: ${(err as Error).message}` });
  }
}

/**
 * One import at a time, across every window.
 *
 * Parenting the dialogs (PR50-14) makes each one belong to the window that asked, but a
 * parented dialog is window-*modal*: it blocks its own window and nothing else. With two
 * windows open, the user can still start a second import from the other one while the first is
 * sitting on „…wird zuerst gesichert und dann ersetzt", and both flows end in
 * `app.relaunch(); app.exit(0)` after replacing database files. Parenting narrows the window
 * for that; it does not close it, and this is the destructive path, so it gets a latch.
 */
let importPending = false;

async function importDatabase(seasonId: number | undefined, win: BrowserWindow | null): Promise<void> {
  if (importPending) {
    await messageBox(win, {
      type: 'info',
      message: 'Es läuft bereits ein Import.',
      detail: 'Bitte zuerst das offene Import-Fenster abschließen oder abbrechen.',
    });
    return;
  }
  importPending = true;
  try {
    await runImport(seasonId, win);
  } finally {
    // Not on the success path, which never returns here — app.exit(0) ends the process.
    importPending = false;
  }
}

async function runImport(seasonId: number | undefined, win: BrowserWindow | null): Promise<void> {
  const r = await openDialog(win, {
    title: 'Datenbank importieren',
    properties: ['openFile'],
    filters: [{ name: 'SQLite-Datenbank', extensions: ['db', 'sqlite'] }],
  });
  if (r.canceled || !r.filePaths[0]) return;

  // Check the file before offering to replace anything: a corrupt or foreign file — or one a
  // newer Auftakt has already migrated (WP-R5) — must never get as far as the confirmation
  // dialog, because by then the old database is what is being replaced.
  let schema: { file: number; app: number } | undefined;
  try {
    const check = await post<{ ok: boolean; error?: string; schema?: { file: number; app: number } }>(
      'backup/import/check',
      { path: r.filePaths[0] },
    );
    if (!check.ok) {
      await messageBox(win, { type: 'error', message: check.error ?? 'Die Datei kann nicht importiert werden.' });
      return;
    }
    schema = check.schema;
  } catch (err) {
    await messageBox(win, { type: 'error', message: `Prüfung fehlgeschlagen: ${(err as Error).message}` });
    return;
  }

  // Name the season the import will replace: with per-window seasons, „die aktuelle
  // Datenbank" no longer says which one that is.
  const label = await seasonLabel(seasonId);
  const confirm = await messageBox(win, {
    type: 'warning',
    buttons: ['Abbrechen', 'Importieren'],
    defaultId: 1,
    cancelId: 0,
    message: label
      ? `„${label}“ wird zuerst gesichert und dann ersetzt. Fortfahren?`
      : 'Die aktuelle Datenbank wird zuerst gesichert und dann ersetzt. Fortfahren?',
    // Both generations, on the one screen where naming them is still worth something: an older
    // file is brought forward by the migration chain when it is first opened, and parts of that
    // chain do not run backwards. Said only when the numbers actually differ — on the version
    // the file already has, there is nothing to warn about (WP-R5).
    //
    // What it does NOT claim is that an older Auftakt can no longer open the result. That is
    // false for the only pair shipping today: a build from before the stamp has no check at all
    // and opens a stamped file happily. The migration is the one-way step, and it is the one
    // worth naming.
    detail:
      schema && schema.file < schema.app
        ? `Die Datei liegt in einem älteren Datenformat vor (Datenformat ${schema.file}, diese App: ${schema.app}). ` +
          'Sie wird beim Öffnen auf das aktuelle Format aktualisiert — dieser Schritt lässt sich nicht rückgängig machen.'
        : undefined,
  });
  if (confirm.response !== 1) return;

  try {
    const { backup } = await post<{ backup: string }>(seasonPath('backup/import', seasonId), { path: r.filePaths[0] });
    await messageBox(win, {
      type: 'info',
      message: 'Import abgeschlossen. Alle Fenster werden geschlossen und die App wird neu gestartet.',
      detail: backup ? `Die bisherige Datenbank wurde gesichert:\n${backup}` : undefined,
    });
    app.relaunch();
    app.exit(0);
  } catch (err) {
    await messageBox(win, {
      type: 'error',
      message: `Import fehlgeschlagen: ${(err as Error).message}`,
      detail: 'Die bisherige Datenbank wurde nicht verändert.',
    });
  }
}

/* The preferred and minimum window sizes used to be two constants here. They live in
 * `cascade.ts` since WP-55 (WINDOW_PREFERRED / WINDOW_MINIMUM), because the only automated
 * coverage they have is `client/src/lib/cascade.test.ts`, which cannot import this file —
 * `electron/tsconfig.json` is `include: ["*.ts"]` and this one imports `electron`. The test
 * carried a hand-copied twin of the minimum instead, coupled to the original by a comment. */

async function createWindow(): Promise<void> {
  // Sampled BEFORE construction — a moment later the count would include this window.
  // A secondary window cascades off the focused one and skips the boot gesture (its
  // ?noboot flag; see client/index.html): the gesture already played in the first window,
  // and without an offset every window opens centered — perfectly stacked.
  const others = BrowserWindow.getAllWindows();
  const isSecondary = others.length > 0;
  let bounds;
  let maximized = false;
  if (isSecondary) {
    // getDisplayMatching keeps the cascade on the monitor the user is working on, and the
    // windows already open are the state that decides where this one may go — a counter drifts
    // out of step with them and never frees the place a closed window left (see cascade.ts).
    const src = (BrowserWindow.getFocusedWindow() ?? others[others.length - 1]!).getBounds();
    const taken = others.filter((w) => !w.isDestroyed()).map((w) => w.getBounds());
    bounds = cascadeBounds(src, screen.getDisplayMatching(src).workArea, WINDOW_PREFERRED, WINDOW_MINIMUM, taken);
  } else {
    // The first window of a launch goes back where the last one closed (WP-55) — arranging two
    // windows side by side is the point of the smaller minimum, and it is worth nothing if the
    // arrangement dies with the app. `usableBounds` refuses a rectangle that no longer lands on
    // any attached screen, which is the failure that matters: bounds saved on a monitor that is
    // no longer there restore a window nobody can see, i.e. an app that did not start.
    const restored = usableBounds(
      readWindowBounds(app.getPath('userData')),
      screen.getAllDisplays().map((d) => d.workArea),
      WINDOW_MINIMUM,
    );
    if (restored) {
      bounds = { x: restored.x, y: restored.y, width: restored.width, height: restored.height };
      maximized = restored.maximized;
    } else {
      // Size only: with no window to match a display against, Electron's own centering is the
      // better answer than guessing which monitor of several the user is sitting at.
      bounds = fittedSize(screen.getPrimaryDisplay().workArea, WINDOW_PREFERRED, WINDOW_MINIMUM);
    }
  }

  const win = new BrowserWindow({
    ...bounds,
    minWidth: WINDOW_MINIMUM.width,
    minHeight: WINDOW_MINIMUM.height,
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

  // Maximized before the first frame, so the renderer never paints at one size and reflows to
  // another: the reflow would land in the gesture's opening frames, re-rastering a path that
  // cannot composite (WP-61) at exactly the moment being measured. The rectangle above is the
  // one it will restore to, which is what getNormalBounds saved.
  //
  // The immediate hide() is the point of this pair, not a leftover. `maximize()` *shows* a
  // hidden window — "this will also show (but not focus) the window if it isn't being
  // displayed already", and it does — so on its own it puts an empty #f6f6f4 rectangle on
  // screen for the whole renderer boot, which is the failure `show: false` below exists to
  // prevent, and it leaves the showAnyway guard's isVisible() check permanently true. Both
  // calls run in the same synchronous tick, before the platform's display cycle, so no frame
  // is ever presented; hide() keeps isMaximized() true and leaves getNormalBounds() untouched.
  if (maximized) {
    win.maximize();
    win.hide();
  }

  // Only the first window of a launch, matching the one rectangle that is saved: a secondary
  // window's position is a cascade offset off whichever window was focused, so letting it write
  // meant the remembered rectangle walked +28/+28 down the screen on every launch that quit with
  // two windows open (Cmd+Q closes both, in an order Electron does not specify, so the cascaded
  // one can close last and win). See DECISIONS.md, „Only the first window's bounds are
  // remembered" — the code now says what that entry always claimed.
  //
  // On `close`, not `closed`: the window has to still exist to be measured. getNormalBounds is
  // the un-maximized, un-fullscreened rectangle — the size the user actually chose — so a
  // maximized window remembers both halves of its state instead of saving the whole screen and
  // reopening as an unmaximizable full-screen rectangle on the next, smaller display.
  if (!isSecondary) {
    win.on('close', () => {
      writeWindowBounds(app.getPath('userData'), {
        ...win.getNormalBounds(),
        maximized: win.isMaximized(),
      });
    });
  }

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
  const res = await fetch(`${ORIGIN}/api/backup/status`);
  const status = (await res.json().catch(() => null)) as {
    backupDir: string;
    hasData: boolean;
    prompted: boolean;
    error?: string;
  } | null;
  // A failed status read must never read as „no folder configured" (WP-R5). An error body
  // carries no `backupDir`, so the old shape fell through to `return ''` and `runStartupChores`
  // skipped the backup — for every season, without throwing, so `reportBackupProblem` never
  // fired and backups stopped with nothing said. The server no longer 500s this route for a
  // season it cannot open; this is the second lock on the same door, for every other reason it
  // might one day fail.
  if (!res.ok || !status) {
    throw new Error(status?.error ?? `Backup-Status nicht abrufbar (HTTP ${res.status}).`);
  }
  if (status.backupDir) return status.backupDir;
  if (!status.hasData || status.prompted) return '';
  // Never open a folder picker with nothing behind it. The chores can now also be
  // released by the window closing (see window-all-closed), and a modal appearing on an
  // empty desktop *after* the user quit reads as a hang, not as a prompt. Leaving
  // `prompted` unset is the right outcome: the next launch asks properly.
  const win = liveWindow();
  if (!win) return '';

  // Explain BEFORE any picker opens. A folder-selection dialog straight out of startup is
  // an unexplained Finder/Explorer window — macOS does not even display its title — and
  // nothing on it says what the folder is for or what happens on cancel. The message box
  // is parented (a sheet on the Auftakt window), names the why, and hands the user an
  // explicit „Später": that path leaves `prompted` unset on purpose, so the next launch
  // asks again until a folder is actually saved (ELP-05) while the amber hint in
  // Einstellungen keeps carrying the state.
  const intro = await dialog.showMessageBox(win, {
    type: 'info',
    message: 'Automatische Sicherungen einrichten?',
    detail:
      'Auftakt kann bei jedem Start eine Sicherung aller Saisons in einem Ordner deiner Wahl anlegen — z. B. in Google Drive oder OneDrive.\n\nDer Ordner lässt sich auch später unter Einstellungen → „Saison & Daten“ festlegen.',
    buttons: ['Backup-Ordner wählen…', 'Später'],
    defaultId: 0,
    cancelId: 1,
  });
  if (intro.response !== 0) return '';

  const chosen = await promptForDirectory(win);
  if (!chosen) return '';
  await saveBackupDir(chosen);
  await post('backup/prompted', {});
  // Same signal as the Einstellungen and menu paths: this prompt runs while a window is
  // already on screen, so an open Einstellungen panel would otherwise keep reading
  // „(noch nicht gewählt)" until something else happened to refetch the settings.
  notifyBackupConfigChanged();
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
 * renderer that reloads itself (a season switch — picking a backup folder used to reload
 * too, until PR50-05 replaced that with an invalidate) and signals a second time, and the
 * last window closing. It returns the same promise to all of them rather than nothing,
 * because that last caller has to know when the backup is finished — it is on its way to
 * app.quit().
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
      // Menu clicks carry no renderer context, so the season comes from the focused window —
      // resolved once, at the click, rather than again inside each helper.
      onExport: () => {
        const win = BrowserWindow.getFocusedWindow();
        void windowSeason(win).then((id) => exportDatabase(id, win));
      },
      onImport: () => {
        const win = BrowserWindow.getFocusedWindow();
        void windowSeason(win).then((id) => importDatabase(id, win));
      },
      onChooseBackup: () => void chooseBackupDir(BrowserWindow.getFocusedWindow()),
    }),
  );
  // Beside the application menu, and for the same reason: both are app-level state, neither
  // belongs to a window, and set here they are in place before the first one exists — a
  // right-click on the Dock icon during a slow launch already has its entry. `app.dock` is
  // typed `Dock | undefined` (undefined off macOS), so the optional call *is* the platform
  // branch: nothing is built on Windows, since `?.` short-circuits the argument too.
  app.dock?.setMenu(buildDockMenu({ onNewWindow: () => void createWindow() }));
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

  // A Dock click used to be answered only when *no* window existed, and a minimized window is
  // still a window — so with both windows minimized the handler did nothing, and the one window
  // that did come back came back without it; the other was reachable only from the Fenster menu
  // or Exposé (WP-67). activatePlan holds the three-way decision and says why each branch is what
  // it is, including why it names nothing as the restorer of that one window; the loop is the
  // same shape notifyBackupConfigChanged uses, because `getAllWindows()` is the only list of
  // windows this app keeps (see liveWindow).
  app.on('activate', (_event, hasVisibleWindows) => {
    const plan = activatePlan(BrowserWindow.getAllWindows(), hasVisibleWindows);
    if (plan.create) void createWindow();
    // All of them come back. Which one ends up frontmost is macOS's call, not this loop's.
    for (const w of plan.restore) w.restore();
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
// The renderer sends its own pin, so no peek is needed here — but the dialogs still have to
// belong to the window that asked, which is the one behind the IPC message (PR50-14).
ipcMain.handle('export-db', (e, seasonId: unknown) =>
  exportDatabase(asSeasonId(seasonId), BrowserWindow.fromWebContents(e.sender)),
);
ipcMain.handle('import-db', (e, seasonId: unknown) =>
  importDatabase(asSeasonId(seasonId), BrowserWindow.fromWebContents(e.sender)),
);
ipcMain.handle('choose-backup-dir', (e) => chooseBackupDir(BrowserWindow.fromWebContents(e.sender)));
ipcMain.handle('get-version', () => app.getVersion());
ipcMain.handle('check-updates', (_e, refresh: boolean) => checkForUpdates(refresh));
// The sender window rides along so the download's progress has somewhere to go: its taskbar
// button and its own update card (WP-60). The other windows are not in the downloading state
// and would have nothing to draw with it.
ipcMain.handle('install-update', (e) =>
  downloadAndInstallUpdate(BrowserWindow.fromWebContents(e.sender)),
);
// The customer's route to their own boot log (WP-54). Main reads and summarizes; the
// renderer receives finished text and never a path it could send back (X-02). Takes no
// argument at all: everything it reads is derived from userData here.
ipcMain.handle('get-diagnostics', async () => ({
  ...bootDiagnostics(app.getPath('userData')),
  system: systemLine(await collectSystemFacts({ gpu: false })),
}));
// The one that does take arguments, and the reasoning that keeps the rule intact is in
// saveDiagnostics: a ten-digit ref cannot name a directory, and the body is capped.
ipcMain.handle('save-diagnostics', (_e, ref: unknown, report: unknown) =>
  saveDiagnostics(ref, report),
);
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
