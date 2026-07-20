import { contextBridge, ipcRenderer } from 'electron';

// The only surface React sees of Electron. Keeps the REST boundary clean and
// lets external links open via shell.openExternal (default browser / mail client).
contextBridge.exposeInMainWorld('auftakt', {
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  exportDatabase: () => ipcRenderer.invoke('export-db'),
  importDatabase: () => ipcRenderer.invoke('import-db'),
  chooseBackupDir: () => ipcRenderer.invoke('choose-backup-dir'),
});
