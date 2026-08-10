import { contextBridge, ipcRenderer } from 'electron';

// The only surface React sees of Electron. Keeps the REST boundary clean and
// lets external links open via shell.openExternal (default browser / mail client).
contextBridge.exposeInMainWorld('auftakt', {
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  exportDatabase: () => ipcRenderer.invoke('export-db'),
  importDatabase: () => ipcRenderer.invoke('import-db'),
  chooseBackupDir: () => ipcRenderer.invoke('choose-backup-dir'),
  getVersion: () => ipcRenderer.invoke('get-version'),
  checkForUpdates: (refresh: boolean) => ipcRenderer.invoke('check-updates', refresh),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  // Fire-and-forget, but invoke rather than send: this file is one shape, and a second
  // idiom for the sake of one unread reply on a local channel is not worth it.
  bootSettled: () => ipcRenderer.invoke('boot-settled'),
  // Static value, not IPC — the Settings card picks platform-specific install copy.
  platform: process.platform,
});
