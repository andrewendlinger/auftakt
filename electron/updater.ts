import { app, type BrowserWindow } from 'electron';
import { autoUpdater, type ProgressInfo } from 'electron-updater';
import { messageBox } from './dialogs';
import { fetchLatestRelease, isNewer, RELEASES_URL, type UpdateStatus } from './updateCheck';

/**
 * Update checks + the Windows in-app updater. macOS cannot auto-update without an
 * Apple Developer ID (Squirrel.Mac rejects the ad-hoc signature), so the split is:
 *
 *  - Windows (packaged): electron-updater against `latest.yml` in the GitHub Release —
 *    the authoritative artifact it would also install. Download + install only on
 *    explicit user request from the Settings card; a downloaded-but-postponed update
 *    still lands via autoInstallOnAppQuit.
 *  - macOS (and dev): plain GitHub Releases API + tag compare (`updateCheck.ts`);
 *    install stays manual via the Releases page in the browser.
 *
 * Both are normalized to one UpdateStatus shape for the preload bridge. While the
 * repo is private the API returns 404 — the silent startup check swallows that, the
 * button surfaces a friendly German message.
 */

export type { UpdateStatus };

const canInstall = () => process.platform === 'win32' && app.isPackaged;

let updaterConfigured = false;

function configuredAutoUpdater(): typeof autoUpdater {
  if (!updaterConfigured) {
    updaterConfigured = true;
    autoUpdater.autoDownload = false; // download only on explicit user request
    autoUpdater.autoInstallOnAppQuit = true; // a postponed download still installs on quit
  }
  return autoUpdater;
}

let cached: UpdateStatus | null = null;

/**
 * True from the moment `downloadAndInstallUpdate` starts until it returns — and the reason
 * is that `autoUpdater` is a process-wide singleton while windows are not (WP-60 review).
 *
 * `AppUpdater.checkForUpdates()` emits `error` on the *same* emitter the running download's
 * failure arm listens to (`AppUpdater.js:271`), so a second window clicking „Nach Updates
 * suchen" while offline would abort the first window's download with „Update fehlgeschlagen"
 * — a download that in fact keeps going and installs on quit. Filtering the event by its
 * message is not an option: the check path and `dispatchError` both pass one, and only the
 * English wording tells them apart.
 *
 * The check is also unsound mid-download for a second, independent reason: it rewrites the
 * `updateInfoAndProvider` the running `downloadUpdate()` reads. And it cannot produce news —
 * the version being downloaded *is* the newest one this app knows about. So while a download
 * runs, a check answers from the cache instead of touching the singleton at all. The cache is
 * populated by construction here: the install button only exists after a successful check.
 *
 * The known cost, and it rides on the pending-download case `downloadWithProgress` describes:
 * if none of the three settles ever arrives, this stays `true` for the session, and „Nach
 * Updates suchen" then keeps answering from the cache in every window. That is one more
 * symptom of a hang that already had two (a frozen card, a spinning taskbar bar) and no
 * timeout behind it — adding one here would be inventing a policy for a state nobody has
 * observed. It is on the Windows checklist to be watched for instead.
 */
let downloadInFlight = false;

async function performCheck(): Promise<UpdateStatus> {
  if (canInstall()) {
    if (downloadInFlight && cached) return cached;
    // Windows: ask electron-updater (reads latest.yml — what it would actually install).
    const result = await configuredAutoUpdater().checkForUpdates();
    const latest = result?.updateInfo.version ?? null;
    return {
      current: app.getVersion(),
      latest,
      url: RELEASES_URL,
      updateAvailable: latest !== null && isNewer(latest, app.getVersion()),
      canInstall: true,
    };
  }
  return { ...(await fetchLatestRelease(app.getVersion())), canInstall: false };
}

/**
 * refresh=false → the silent startup result (null if that check failed or hasn't run);
 * refresh=true → a fresh check that may throw (the Settings card shows the German error).
 */
export async function checkForUpdates(refresh: boolean): Promise<UpdateStatus | null> {
  if (!refresh) return cached;
  cached = await performCheck();
  return cached;
}

/** Fire-and-forget on launch; failures (offline, private repo, rate limit) only log. */
export function startSilentStartupCheck(): void {
  void performCheck()
    .then((status) => {
      cached = status;
    })
    .catch((err) => console.error('Update-Check übersprungen:', err));
}

/**
 * The one Main→Renderer channel that carries a value (WP-60): the download percentage,
 * 0–100. It goes to the *one* window that asked, not to all of them like
 * `backup-config-changed` — the other windows' update cards are not in the downloading
 * state and have nothing to draw. See `docs/ARCHITECTURE.md`, „Windows (plural)".
 *
 * Spelled out again in `electron/preload.ts` rather than imported, exactly as
 * `backup-config-changed` is: preload is its own esbuild bundle and importing this module
 * would drag `electron-updater` into it. Grep is the whole coupling — rename both.
 */
const UPDATE_PROGRESS_CHANNEL = 'update-download-progress';

/**
 * Where a download run's progress goes: the asking window's taskbar button and its update
 * card. Both are best-effort — the window can be closed mid-download (the update keeps
 * going, and autoInstallOnAppQuit still lands it), so every call re-checks.
 */
function progressReporter(win: BrowserWindow | null) {
  const to = (fn: (w: BrowserWindow) => void) => {
    if (win && !win.isDestroyed()) fn(win);
  };
  return {
    /** Windows-only mode, and canInstall() has already established the platform. Until the
     *  first `download-progress` the total is unknown, and a determinate bar sitting at 0 %
     *  is exactly the „nothing is happening" the user reported. */
    start: () => to((w) => w.setProgressBar(1, { mode: 'indeterminate' })),
    percent: (pct: number) =>
      to((w) => {
        w.setProgressBar(Math.max(0, Math.min(1, pct / 100)));
        w.webContents.send(UPDATE_PROGRESS_CHANNEL, pct);
      }),
    /** -1 removes the taskbar bar. The card needs no counterpart: the `install-update`
     *  invoke resolving is what takes it out of the downloading state. */
    clear: () => to((w) => w.setProgressBar(-1)),
  };
}

/**
 * `downloadUpdate()` on its own is not a complete await. electron-updater reports part of
 * what can go wrong — a failed differential download, a rejected signature, a dead
 * connection — through the `error` event, and the promise can stay pending behind it; there
 * is no timeout anywhere, so the card sat on „Update wird heruntergeladen…" forever and the
 * user had no way back (the button is gone in that state). Racing the promise against
 * `error` gives that a failure arm, and `update-downloaded` is taken as the other settle so
 * whichever arrives first wins.
 *
 * Every listener comes off again in the `finally`, because `autoUpdater` is a module
 * singleton: a second run in the same session would otherwise stack a second set on the
 * first and report each chunk twice.
 */
function downloadWithProgress(
  updater: typeof autoUpdater,
  onProgress: (pct: number) => void,
): Promise<void> {
  let cleanup = () => {};
  return new Promise<void>((resolve, reject) => {
    const progress = (info: ProgressInfo) => onProgress(info.percent);
    const downloaded = () => resolve();
    const failed = (err: Error) => reject(err);
    cleanup = () => {
      updater.off('download-progress', progress);
      updater.off('update-downloaded', downloaded);
      updater.off('error', failed);
    };
    updater.on('download-progress', progress);
    updater.once('update-downloaded', downloaded);
    updater.on('error', failed);
    updater.downloadUpdate().then(() => resolve(), reject);
  }).finally(() => cleanup());
}

/**
 * Windows only: download the update, then offer the restart. Declining is fine —
 * autoInstallOnAppQuit installs it on the next regular quit instead.
 *
 * `win` is the window whose button shows the taskbar progress and whose renderer draws the
 * bar — main.ts derives it from the invoke's sender, so it is the window the user clicked in.
 */
export async function downloadAndInstallUpdate(win: BrowserWindow | null): Promise<void> {
  if (!canInstall()) return;
  // The other half of `downloadInFlight`: a second window's Einstellungen card still shows a
  // live install button while this one downloads, and two `downloadUpdate()` runs on one
  // singleton race each other's state. Saying so is better than a button that does nothing.
  if (downloadInFlight) {
    await messageBox(win, {
      type: 'info',
      message: 'Das Update wird bereits heruntergeladen.',
      detail:
        'Ein anderes Auftakt-Fenster lädt gerade dieselbe Version. Sobald der Download fertig ist, fragt Auftakt dort nach dem Neustart.',
    });
    return;
  }
  downloadInFlight = true;
  try {
    await runDownloadAndInstall(win);
  } finally {
    // In a `finally` and nowhere else: latched at `true` — by a throwing dialog, say — every
    // later check would answer from the cache and every install button would be a no-op for
    // the rest of the session, and nothing in the UI would explain why. On „Später" it falls
    // here too, and the next click starts a fresh run. `quitAndInstall` is inside, but it
    // quits, so what the flag says afterwards never gets read.
    downloadInFlight = false;
  }
}

async function runDownloadAndInstall(win: BrowserWindow | null): Promise<void> {
  const progress = progressReporter(win);
  // configuredAutoUpdater() inside the try as well: anything that throws before the
  // download must land in the dialog below rather than rejecting the IPC call, which
  // the renderer could only show as a stuck update card (PGS-16).
  let updater: typeof autoUpdater;
  try {
    updater = configuredAutoUpdater();
    progress.start();
    await updater.checkForUpdates(); // downloadUpdate needs a fresh check result
    await downloadWithProgress(updater, progress.percent);
  } catch (err) {
    progress.clear();
    // Parented, like every other dialog in the app (`electron/dialogs.ts`). Unparented it is
    // modal to nothing on Windows and can sit *behind* the window, which here would leave the
    // card apparently frozen mid-download with the explanation hidden on another z-order
    // (PR50-14) — the exact failure this package exists to remove.
    await messageBox(win, {
      type: 'error',
      message: `Update fehlgeschlagen: ${(err as Error).message}`,
      detail: 'Die aktuelle Version bleibt unverändert. Du kannst die neue Version auch manuell von der Releases-Seite laden.',
    });
    return;
  }
  // The last `download-progress` need not be 100, so the card is told once more explicitly;
  // the taskbar bar comes off, because nothing is downloading any more and what is left is a
  // question for the user rather than work to watch.
  progress.percent(100);
  progress.clear();
  /**
   * The one gap no progress bar reaches. `quitAndInstall(true, true)` starts NSIS *silently*
   * — from that call on there is no window, no taskbar item and no renderer left to report
   * anything, and on the customer machines a virus scanner takes its time over the fresh
   * .exe before Windows lets it run. The symptom is a blank desktop for a minute or more
   * after clicking a button labelled „Jetzt neu starten", which reads as a crash.
   *
   * `isSilent = false` would let NSIS show its own progress window and was the obvious
   * alternative; it was rejected because it buys a bar at the price of extra clicks in a
   * dialog nobody wants to read (see docs/DECISIONS.md). So the silence stays and this is
   * the place it gets announced: the steps by name, and the wait named before it happens —
   * a wait somebody expects is not the same event as a wait that arrives unexplained.
   *
   * Parented to `win` for the same reason as the error box above, and it matters more here:
   * this is the longest gap in the app between a click and its dialog — a whole download —
   * so „the window the user has been looking at" and „the window this dialog belongs to"
   * have had every chance to come apart. `messageBox` re-checks `isDestroyed` per call, so a
   * window closed mid-download falls back to an unparented box rather than throwing.
   */
  const confirm = await messageBox(win, {
    type: 'info',
    buttons: ['Später', 'Jetzt neu starten'],
    defaultId: 1,
    cancelId: 0,
    message: 'Update heruntergeladen. Jetzt neu starten und installieren?',
    detail:
      'Nach „Jetzt neu starten“ passiert Folgendes:\n' +
      '1. Auftakt schließt sich.\n' +
      '2. Das Update installiert sich still im Hintergrund — ohne weiteres Fenster und ohne Rückfrage.\n' +
      '3. Auftakt startet von selbst neu.\n\n' +
      'Zwischen Schritt 2 und 3 kann es dauern: Virenscanner prüfen die neue Programmdatei zuerst, ' +
      'das kostet auf manchen Rechnern eine Minute oder mehr. Solange ist auf dem Bildschirm nichts ' +
      'zu sehen — das ist normal. Bitte einfach warten, nicht mehrfach klicken und den Rechner nicht ' +
      'ausschalten.\n\n' +
      'Bei „Später“ wird das Update beim nächsten Beenden der App installiert. Deine Daten bleiben ' +
      'in beiden Fällen erhalten.',
  });
  if (confirm.response === 1) updater.quitAndInstall(true, true);
}
