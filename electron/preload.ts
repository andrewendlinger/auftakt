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
  // The support mail's diagnostic block (WP-54). Takes no argument: main derives the path
  // from userData, so the renderer cannot point it at a file of its choosing.
  getDiagnostics: () => ipcRenderer.invoke('get-diagnostics'),
  // The exception, because a `mailto:` cannot attach anything: this writes the full log plus
  // the machine's details to the desktop, so the customer has one named file to drag in. Both
  // arguments are untrusted — `ref` only ever picks a *name* out of a ten-digit alphabet, and
  // main still picks the directory (see saveDiagnostics in main.ts).
  saveDiagnostics: (ref: string, report: string) =>
    ipcRenderer.invoke('save-diagnostics', ref, report),
  // Fire-and-forget, but invoke rather than send: everything above is renderer→main, and a
  // second idiom for the sake of one unread reply on a local channel is not worth it. The
  // argument is the boot report (see client/index.html); main treats it as untrusted.
  bootSettled: (report?: unknown) => ipcRenderer.invoke('boot-settled', report),
  /**
   * One of two main→renderer directions, hence one of two `ipcRenderer.on`s (the other is
   * `onUpdateProgress` below): the backup folder is registry-wide, so a pick in any window
   * (or from the menu, or from the first-launch prompt) has to reach all of them. `invoke`
   * cannot express it — main is the one starting the conversation — and BroadcastChannel is
   * renderer-only.
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
  /**
   * The download percentage of an in-flight `installUpdate()`, 0–100 (WP-60). Same wrapping
   * rule as above — the `IpcRendererEvent` is dropped, only the number crosses — but the
   * opposite of it in the two ways that matter: it is addressed to *this* window (main sends
   * it to the sender of the `install-update` invoke, not to all windows) and it carries a
   * *value*. It has to: the renderer has no way to ask electron-updater how far along a
   * download is, so „refetch instead of being told" has nothing to refetch from.
   *
   * Unsubscribing matters here where it does not for the backup signal: the sole listener is
   * a component effect in the Einstellungen card, not a document-lifetime one.
   */
  onUpdateProgress: (cb: (percent: number) => void) => {
    const listener = (_event: unknown, percent: number) => cb(percent);
    ipcRenderer.on('update-download-progress', listener);
    return () => ipcRenderer.off('update-download-progress', listener);
  },
  // Static value, not IPC — the Settings card picks platform-specific install copy.
  platform: process.platform,
});
