import { Menu, type MenuItemConstructorOptions } from 'electron';

export interface MenuHandlers {
  onNewWindow: () => void;
  onExport: () => void;
  onImport: () => void;
  onChooseBackup: () => void;
}

/** One string, because the Datei menu and the Dock menu offer the same action (WP-67). */
const NEW_WINDOW = 'Neues Fenster';

export function buildMenu(h: MenuHandlers): Menu {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? ([{ role: 'appMenu' }] as MenuItemConstructorOptions[]) : []),
    {
      label: 'Datei',
      submenu: [
        // CmdOrCtrl+N is free: this app defines no other explicit accelerator, and the
        // role menus own theirs.
        { label: NEW_WINDOW, accelerator: 'CmdOrCtrl+N', click: () => h.onNewWindow() },
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

/**
 * The Dock icon's context menu — macOS only, because nothing else has a Dock.
 *
 * macOS appends its own „Alle Fenster anzeigen" and „Beenden" below whatever is added here; what
 * it has no entry for is a *second* window, and a right-click on a running app is where a mac
 * user looks for one (WP-67). Same label and the same handler as the Datei menu's item — one
 * action with one name, not two.
 *
 * No accelerator: Cmd+N belongs to the application menu, which owns it whenever the app is
 * frontmost, and a Dock menu item does not dispatch one anyway. Setting it here would only print
 * a shortcut next to an entry that is not the one answering it.
 */
export function buildDockMenu(h: Pick<MenuHandlers, 'onNewWindow'>): Menu {
  return Menu.buildFromTemplate([{ label: NEW_WINDOW, click: () => h.onNewWindow() }]);
}
