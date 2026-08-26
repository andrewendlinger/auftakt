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

/** Mirror of `Diagnostics` in electron/diagnostics.ts — what the support mail draws on. */
export interface Diagnostics {
  /** German, already sanitized, ready to paste into a mail body. Never empty. */
  summary: string;
  /** false when no log file exists yet — dev never writes one, nor does a first launch. */
  hasLog: boolean;
  /** Display only — the renderer never sends a path back over the bridge (X-02). */
  file: string;
  /** „Windows 11 Pro (10.0.26100) · 2560×1440 @1.5×" — one line, built by main. */
  system: string;
}

/** Mirror of `DiagnosticsSave` in electron/main.ts — `name` is what the mail says to attach. */
export type DiagnosticsSave = { ok: true; name: string } | { ok: false };

declare global {
  interface Window {
    auftakt?: {
      openExternal?: (url: string) => void;
      /** Pass the window's season pin so the file operation targets it, not the default. */
      exportDatabase?: (seasonId?: number) => void;
      importDatabase?: (seasonId?: number) => void;
      chooseBackupDir?: () => void;
      /**
       * Save the calling window's page as a PDF (WP-71) — the print sheets' one button, and the
       * replacement for `window.print()`, which on Windows opens a *printer* list. Main renders
       * the page with `webContents.printToPDF()` and asks where to put it.
       *
       * `title` is a proposed *name* and nothing else: main puts it through the same `labelSlug`
       * the database export's filename goes through and picks the directory from the dialog, so
       * the renderer never names a path (X-02). The promise resolves when the save is over —
       * written, cancelled or failed alike — because every dialog on this path, the error one
       * included, belongs to main. There is nothing here for a caller to branch on.
       */
      savePdf?: (title: string) => Promise<void>;
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
       * Main→renderer #2, and the only one that carries a value: the percentage (0–100) of
       * the `installUpdate()` this window started. Addressed to this window alone, so a
       * second window's card stays quiet. Returns its own unsubscribe, which matters here —
       * the sole listener is a component effect in `UpdateCard`, not a document-lifetime
       * one like `onBackupConfigChanged`'s. Not a signal to refetch from, because there is
       * nothing to refetch: electron-updater's progress exists only in main (WP-60).
       */
      onUpdateProgress?: (cb: (percent: number) => void) => () => void;
      /**
       * "The boot screen is gone." Called from the overlay's single exit path in
       * `client/index.html`, not from React — React never learns the overlay existed.
       * Releases the startup chores the main process is holding back (see main.ts).
       * The optional payload is the boot report, which main appends to
       * app-log.jsonl in userData (electron/appLog.ts).
       */
      bootSettled?: (report?: unknown) => Promise<void>;
      /**
       * One runtime line into that same app-log.jsonl (WP-69e) — a window error, an unhandled
       * rejection, a React render error. Fire-and-forget in both directions: it answers
       * nothing, and a caller learns nothing about whether the line was written, because the
       * places that call it are error paths that have no better plan either way.
       *
       * `unknown` rather than a shape, deliberately: main is the side that decides what a line
       * may contain — it validates the payload, budgets how many arrive per run and caps the
       * fields — so a type here would only describe an intention. Call it through
       * `lib/logEvent.ts`, which is where the renderer's own dedupe and cap live.
       */
      logEvent?: (payload: unknown) => void;
      /** The last boots, already summarized by main — see electron/appLog.ts (WP-54). */
      getDiagnostics?: () => Promise<Diagnostics>;
      /**
       * Write the full log + machine details to the desktop as `Auftakt-Diagnose-<ref>.txt`,
       * because a `mailto:` cannot attach a file — and *only* write it: the file manager the
       * call used to open on top of it went with WP-66. `ref` is the mail's own reference;
       * main re-validates its shape before it becomes a filename (X-02).
       */
      saveDiagnostics?: (ref: string, report: string) => Promise<DiagnosticsSave>;
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
