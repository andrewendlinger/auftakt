import { app, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
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

async function performCheck(): Promise<UpdateStatus> {
  if (canInstall()) {
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

let cached: UpdateStatus | null = null;

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
 * Windows only: download the update, then offer the restart. Declining is fine —
 * autoInstallOnAppQuit installs it on the next regular quit instead.
 */
export async function downloadAndInstallUpdate(): Promise<void> {
  if (!canInstall()) return;
  // configuredAutoUpdater() inside the try as well: anything that throws before the
  // download must land in the dialog below rather than rejecting the IPC call, which
  // the renderer could only show as a stuck update card (PGS-16).
  let updater: typeof autoUpdater;
  try {
    updater = configuredAutoUpdater();
    await updater.checkForUpdates(); // downloadUpdate needs a fresh check result
    await updater.downloadUpdate();
  } catch (err) {
    await dialog.showMessageBox({
      type: 'error',
      message: `Update fehlgeschlagen: ${(err as Error).message}`,
      detail: 'Die aktuelle Version bleibt unverändert. Du kannst die neue Version auch manuell von der Releases-Seite laden.',
    });
    return;
  }
  const confirm = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Später', 'Jetzt neu starten'],
    defaultId: 1,
    cancelId: 0,
    message: 'Update heruntergeladen. Jetzt neu starten und installieren?',
    detail: 'Bei „Später" wird das Update beim nächsten Beenden der App installiert.',
  });
  if (confirm.response === 1) updater.quitAndInstall(true, true);
}
