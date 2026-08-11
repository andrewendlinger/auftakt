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
      /** Pass the window's season pin so the file operation targets it, not the default. */
      exportDatabase?: (seasonId?: number) => void;
      importDatabase?: (seasonId?: number) => void;
      chooseBackupDir?: () => void;
      getVersion?: () => Promise<string>;
      /** refresh=false → cached silent startup check (null if it failed); true → fresh check, may reject. */
      checkForUpdates?: (refresh: boolean) => Promise<UpdateStatus | null>;
      installUpdate?: () => Promise<void>;
      /**
       * "The boot screen is gone." Called from the overlay's single exit path in
       * `client/index.html`, not from React — React never learns the overlay existed.
       * Releases the startup chores the main process is holding back (see main.ts).
       * The optional payload is the boot report, which main appends to
       * boot-log.jsonl in userData (electron/bootLog.ts).
       */
      bootSettled?: (report?: unknown) => Promise<void>;
      platform?: string;
    };
  }
}

/**
 * Only these schemes may reach `shell.openExternal` / `window.open`. Stored
 * `links.url` and landing-doc URLs render as buttons that bypass the
 * markdown/linkify protocol allowlist, so an imported or injected `file:`,
 * `smb:` (Windows UNC → NTLM leak) or custom-protocol URL would otherwise open
 * unchecked. The main process re-checks this — the renderer is the untrusted
 * side — so this arm is UX + the browser-dev fallback (X-02).
 */
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function isAllowedExternalUrl(url: string): boolean {
  try {
    return ALLOWED_EXTERNAL_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false; // unparseable / relative → not an external link → block
  }
}

export function openExternal(url: string): void {
  if (!isAllowedExternalUrl(url)) {
    console.warn('Blockierter externer Link (nicht unterstütztes Format):', url);
    window.alert('Dieser Link kann nicht geöffnet werden (nicht unterstütztes Format).');
    return;
  }
  const bridge = window.auftakt?.openExternal;
  if (bridge) {
    bridge(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
