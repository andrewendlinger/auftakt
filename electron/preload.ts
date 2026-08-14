import { contextBridge, ipcRenderer } from 'electron';

// The only surface React sees of Electron. Keeps the REST boundary clean and
// lets external links open via shell.openExternal (default browser / mail client).
contextBridge.exposeInMainWorld('auftakt', {
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  // The caller's season pin rides along so export/import target the window's season,
  // not the registry default. Main treats the value as untrusted.
  exportDatabase: (seasonId?: number) => ipcRenderer.invoke('export-db', seasonId),
  importDatabase: (seasonId?: number) => ipcRenderer.invoke('import-db', seasonId),
  chooseBackupDir: () => ipcRenderer.invoke('choose-backup-dir'),
  getVersion: () => ipcRenderer.invoke('get-version'),
  checkForUpdates: (refresh: boolean) => ipcRenderer.invoke('check-updates', refresh),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  // The support mail's diagnostic block, and the button showing the customer where the raw
  // log lives (WP-54). Neither takes an argument: main derives the path from userData, so
  // the renderer cannot point either of them at a file of its choosing.
  getDiagnostics: () => ipcRenderer.invoke('get-diagnostics'),
  revealDiagnostics: () => ipcRenderer.invoke('reveal-diagnostics'),
  // Fire-and-forget, but invoke rather than send: everything above is renderer→main, and a
  // second idiom for the sake of one unread reply on a local channel is not worth it. The
  // argument is the boot report (see client/index.html); main treats it as untrusted.
  bootSettled: (report?: unknown) => ipcRenderer.invoke('boot-settled', report),
  /**
   * The one main→renderer direction, hence the one `ipcRenderer.on`: the backup folder is
   * registry-wide, so a pick in any window (or from the menu, or from the first-launch
   * prompt) has to reach all of them. `invoke` cannot express it — main is the one starting
   * the conversation — and BroadcastChannel is renderer-only.
   *
   * The listener is wrapped rather than passed through: `ipcRenderer.on` hands its callback
   * an `IpcRendererEvent` carrying `sender`, and contextIsolation exists precisely so the
   * renderer never gets a handle on that. The payload is empty by design — a pure signal,
   * like the broadcast messages; the renderer refetches rather than being told a value.
   */
  onBackupConfigChanged: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('backup-config-changed', listener);
    return () => ipcRenderer.off('backup-config-changed', listener);
  },
  // Static value, not IPC — the Settings card picks platform-specific install copy.
  platform: process.platform,
});
