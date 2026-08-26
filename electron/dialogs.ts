import {
  BrowserWindow,
  dialog,
  type MessageBoxOptions,
  type MessageBoxSyncOptions,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from 'electron';

/**
 * Every dialog hangs off the window that asked for it, when there still is one, and carries
 * „Auftakt" as its title unless the call has something better to say.
 *
 * Parenting is not decoration. macOS does not display an open-dialog's `title` at all, so an
 * unparented picker is a bare Finder window with nothing saying which app wants it or why; and
 * with several windows open, „„Festival 2026" wird zuerst gesichert und dann ersetzt" has to
 * belong to a window or it does not say whose season that is. On Windows an unparented dialog
 * is modal to nothing: it can be sent behind the windows, the user clicks the menu item again
 * thinking nothing happened, and a second file picker opens over a pending destructive confirm
 * (PR50-14). macOS hides that half — an unparented dialog is app-modal there.
 *
 * The `isDestroyed` check is per call, not once at entry: importDatabase awaits an HTTP check
 * and a confirmation between its dialogs, and parenting to a window closed in the meantime
 * throws. The update path awaits a whole download between the click and its dialogs, which is
 * the longest such gap in the app.
 *
 * These live in their own module rather than in `main.ts` because `updater.ts` needs them too
 * and `main.ts` imports *it* — the update dialogs were the one place that had reimplemented
 * „just call `dialog.showMessageBox`" and so landed behind the window on Windows, in front of
 * a card frozen at 100 % (WP-60). Since WP-73 a reimplementation costs the title as well, so
 * `dialog.*` outside this file is the thing to look for: `showErrorBox`, whose first argument
 * already is its title, is the only one left.
 */
export function alive(win: BrowserWindow | null): win is BrowserWindow {
  return win !== null && !win.isDestroyed();
}

/**
 * The title a dialog falls back to (WP-73).
 *
 * Windows captions a message box with `app.getName()` when the call names no title, and
 * `app.getName()` is `package.json`'s `name` field — `auftakt`, lowercase. So every native
 * dialog on a customer machine was titled with the package name while the exe's ProductName,
 * the installer, the registry entry, the shortcut and the install path all said „Auftakt"
 * (electron-builder's `productName`, which never reaches this process). macOS shows no message
 * box title at all, which is why it was a Windows screenshot that found it.
 *
 * Renaming the app is the repair that must not be made. `app.setName('Auftakt')` — and equally
 * a top-level `productName` in `package.json`, which Electron prefers over `name` — also
 * renames `app.getPath('userData')`. On Windows that happens to be harmless, since the paths
 * differ only in case; on macOS it derives a NEW, empty `~/Library/Application Support/Auftakt/`
 * and every existing installation loses sight of its database (`docs/BACKUP-TESTING.md`,
 * „Notes"). The app therefore keeps its lowercase name and the dialogs carry the capitalised
 * one, which is the only place the name was ever shown wrong.
 *
 * A default rather than a fixed string, because three calls have something better to say than
 * the app's name — the two file pickers and the export's save dialog — and theirs wins. On
 * macOS none of the three titles is normally visible: an open dialog's title is ignored there,
 * and a parented save panel is a title-bar-less sheet — the titles are for Windows, where all
 * three show.
 */
const TITLE = 'Auftakt';

/** `title` after the spread, so an explicit one wins and an absent one still gets the default. */
function titled<T extends { title?: string }>(opts: T): T & { title: string } {
  return { ...opts, title: opts.title ?? TITLE };
}

export function messageBox(win: BrowserWindow | null, opts: MessageBoxOptions) {
  const o = titled(opts);
  return alive(win) ? dialog.showMessageBox(win, o) : dialog.showMessageBox(o);
}

/**
 * Never parented and never awaited: the one caller is the `uncaughtException` handler, whose
 * next statement ends the process — an async dialog on a dying process is one that never
 * appears, and a main process that has already thrown is not a place to reach for a window.
 */
export function messageBoxSync(opts: MessageBoxSyncOptions) {
  return dialog.showMessageBoxSync(titled(opts));
}

export function saveDialog(win: BrowserWindow | null, opts: SaveDialogOptions) {
  const o = titled(opts);
  return alive(win) ? dialog.showSaveDialog(win, o) : dialog.showSaveDialog(o);
}

export function openDialog(win: BrowserWindow | null, opts: OpenDialogOptions) {
  const o = titled(opts);
  return alive(win) ? dialog.showOpenDialog(win, o) : dialog.showOpenDialog(o);
}
