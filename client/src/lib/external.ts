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

/** Mirror of `BootDiagnostics` in electron/bootLog.ts — the support mail's diagnostic block. */
export interface BootDiagnostics {
  /** German, already sanitized, ready to paste into a mail body. Never empty. */
  summary: string;
  /** false when no log file exists yet — dev never writes one, nor does a first launch. */
  hasLog: boolean;
  /** Display only — the renderer never sends a path back over the bridge (X-02). */
  file: string;
}

/** Mirror of `DiagnosticsReveal` in electron/main.ts. */
export type DiagnosticsReveal = 'revealed' | 'opened' | 'failed';

declare global {
  interface Window {
    auftakt?: {
      openExternal?: (url: string) => void;
      /** Pass the window's season pin so the file operation targets it, not the default. */
      exportDatabase?: (seasonId?: number) => void;
      importDatabase?: (seasonId?: number) => void;
      chooseBackupDir?: () => void;
      /**
       * Main→renderer: the registry-wide backup folder changed (any window's picker, the
       * Datei menu, or the first-launch prompt). A pure signal — refetch, it carries no
       * value. Returns its own unsubscribe. The sole listener lives in `main.tsx`, next to
       * the BroadcastChannel one and sharing its coalesced invalidate.
       */
      onBackupConfigChanged?: (cb: () => void) => () => void;
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
      /** The last boots, already summarized by main — see electron/bootLog.ts (WP-54). */
      getDiagnostics?: () => Promise<BootDiagnostics>;
      /** Show `boot-log.jsonl` in Finder/Explorer, or its folder when there is none yet. */
      revealDiagnostics?: () => Promise<DiagnosticsReveal>;
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
