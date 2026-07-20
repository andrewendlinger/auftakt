import { Menu, type MenuItemConstructorOptions } from 'electron';

export interface MenuHandlers {
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
        { label: 'Datenbank exportieren…', click: () => h.onExport() },
        { label: 'Datenbank importieren…', click: () => h.onImport() },
        { type: 'separator' },
        { label: 'Backup-Ordner wählen…', click: () => h.onChooseBackup() },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  return Menu.buildFromTemplate(template);
}
