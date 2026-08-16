import {
  BrowserWindow,
  dialog,
  type MessageBoxOptions,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from 'electron';

/**
 * Every dialog hangs off the window that asked for it, when there still is one.
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
 * a card frozen at 100 % (WP-60).
 */
export function alive(win: BrowserWindow | null): win is BrowserWindow {
  return win !== null && !win.isDestroyed();
}

export function messageBox(win: BrowserWindow | null, opts: MessageBoxOptions) {
  return alive(win) ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
}

export function saveDialog(win: BrowserWindow | null, opts: SaveDialogOptions) {
  return alive(win) ? dialog.showSaveDialog(win, opts) : dialog.showSaveDialog(opts);
}

export function openDialog(win: BrowserWindow | null, opts: OpenDialogOptions) {
  return alive(win) ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts);
}
