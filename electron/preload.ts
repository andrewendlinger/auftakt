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
  // Fire-and-forget, but invoke rather than send: this file is one shape, and a second
  // idiom for the sake of one unread reply on a local channel is not worth it. The
  // argument is the boot report (see client/index.html); main treats it as untrusted.
  bootSettled: (report?: unknown) => ipcRenderer.invoke('boot-settled', report),
  // Static value, not IPC — the Settings card picks platform-specific install copy.
  platform: process.platform,
});
