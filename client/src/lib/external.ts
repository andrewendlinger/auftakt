/**
 * Open a URL/mailto outside the app. Under Electron this routes through the
 * preload `window.auftakt.openExternal` bridge (→ shell.openExternal); in the
 * browser it falls back to a new tab. React never touches Electron directly.
 */

/** Mirror of `UpdateStatus` in electron/updater.ts — the bridge's update-check result. */
export interface UpdateStatus {
  current: string;
  latest: string | null;
  url: string;
  updateAvailable: boolean;
  /** true when the app can download + install itself (packaged Windows). */
  canInstall: boolean;
}

declare global {
  interface Window {
    auftakt?: {
      openExternal?: (url: string) => void;
      exportDatabase?: () => void;
      importDatabase?: () => void;
      chooseBackupDir?: () => void;
      getVersion?: () => Promise<string>;
      /** refresh=false → cached silent startup check (null if it failed); true → fresh check, may reject. */
      checkForUpdates?: (refresh: boolean) => Promise<UpdateStatus | null>;
      installUpdate?: () => Promise<void>;
      platform?: string;
    };
  }
}

export function openExternal(url: string): void {
  const bridge = window.auftakt?.openExternal;
  if (bridge) {
    bridge(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
