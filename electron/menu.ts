import { Menu, type MenuItemConstructorOptions } from 'electron';

export interface MenuHandlers {
  onNewWindow: () => void;
  onExport: () => void;
  onImport: () => void;
  onChooseBackup: () => void;
}

export function buildMenu(h: MenuHandlers): Menu {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? ([{ role: 'appMenu' }] as MenuItemConstructorOptions[]) : []),
    {
      label: 'Datei',
      submenu: [
        // CmdOrCtrl+N is free: this app defines no other explicit accelerator, and the
        // role menus own theirs.
        { label: 'Neues Fenster', accelerator: 'CmdOrCtrl+N', click: () => h.onNewWindow() },
        { type: 'separator' },
        { label: 'Datenbank exportieren…', click: () => h.onExport() },
        { label: 'Datenbank importieren…', click: () => h.onImport() },
        { type: 'separator' },
        { label: 'Backup-Ordner wählen…', click: () => h.onChooseBackup() },
        { type: 'separator' },
        // With several windows, closing one and quitting are different actions on Windows
        // too — and Electron's role labels are English there, hence the explicit German.
        ...(isMac
          ? ([{ role: 'close' }] as MenuItemConstructorOptions[])
          : ([
              { role: 'close', label: 'Fenster schließen' },
              { role: 'quit', label: 'Beenden' },
            ] as MenuItemConstructorOptions[])),
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  return Menu.buildFromTemplate(template);
}
