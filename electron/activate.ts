/**
 * What clicking the Dock icon means (macOS).
 *
 * Imports nothing from `electron`, deliberately — the same rule as cascade.ts, backup.ts,
 * bootLog.ts and exportName.ts: the windows arrive as anything that can answer `isDestroyed()`
 * and `isMinimized()`, which is what lets `client/src/lib/activate.test.ts` drive the branch
 * matrix from `check:unit`. The Dock is the one surface no automated run in this repository can
 * reach — `check:browser` drives a page, not a process, and launching the real app is off the
 * table — so the decision is worth having somewhere a test can see it.
 */

export interface ActivatableWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
}

export interface ActivatePlan<T> {
  /** Open a window: the app is running with nothing left to show. */
  create: boolean;
  /** The windows to `restore()`, in the order `getAllWindows()` handed them over. */
  restore: T[];
}

/**
 * macOS keeps the app running with its windows closed, so a Dock click has three answers:
 *
 * - **Nothing left** → open a window. That branch was always here.
 * - **Something on screen** → do nothing. `hasVisibleWindows` is macOS's own answer: AppKit hands
 *   it to `applicationShouldHandleReopen:hasVisibleWindows:`, which Electron forwards to the
 *   `activate` event, and the convention it encodes is Finder's and Safari's: activating an app
 *   that already has a window on screen raises that window and leaves the minimized ones in the
 *   Dock. Minimizing is deliberate; a click meant for the window on screen must not undo it.
 * - **Everything minimized** → bring them all back. On a Dock click *one* window returns without
 *   any help from here, and with two minimized windows the second one was reachable through
 *   nothing but the Fenster menu or Exposé — the report this exists for (WP-67).
 *
 * Whatever macOS restores on its own is deliberately left unnamed: this code can observe neither
 * which part of it does that nor whether it happens before this runs or after, and it does not
 * need to. The set is filtered on `isMinimized()`, so a window that is already back is simply not
 * in it and one that is still down is restored exactly once — either way round.
 *
 * Nothing here decides which window ends up frontmost. That is macOS's, together with whatever it
 * brought back itself; the guarantee is only that no window is left in the Dock.
 *
 * Destroyed windows are dropped before the count rather than after, for the reason `liveWindow()`
 * in main.ts gives at length: `getAllWindows()` is Electron's registry, and a window on its way
 * out can still be in it — counting one would answer a Dock click with nothing at all.
 */
export function activatePlan<T extends ActivatableWindow>(
  windows: readonly T[],
  hasVisibleWindows: boolean,
): ActivatePlan<T> {
  const live = windows.filter((w) => !w.isDestroyed());
  if (live.length === 0) return { create: true, restore: [] };
  if (hasVisibleWindows) return { create: false, restore: [] };
  return { create: false, restore: live.filter((w) => w.isMinimized()) };
}
