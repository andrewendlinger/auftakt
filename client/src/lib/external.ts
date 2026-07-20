/**
 * Open a URL/mailto outside the app. Under Electron this routes through the
 * preload `window.auftakt.openExternal` bridge (→ shell.openExternal); in the
 * browser it falls back to a new tab. React never touches Electron directly.
 */
declare global {
  interface Window {
    auftakt?: {
      openExternal?: (url: string) => void;
      exportDatabase?: () => void;
      importDatabase?: () => void;
      chooseBackupDir?: () => void;
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
