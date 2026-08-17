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
  /** The windows to `restore()`, in the order they were opened. */
  restore: T[];
}

/**
 * macOS keeps the app running with its windows closed, so a Dock click has three answers:
 *
 * - **Nothing left** → open a window. That branch was always here.
 * - **Something on screen** → do nothing. `hasVisibleWindows` is AppKit's own answer, handed to
 *   `applicationShouldHandleReopen:hasVisibleWindows:` and passed straight through to the
 *   `activate` event, and the convention it encodes is Finder's and Safari's: activating an app
 *   that already has a window on screen raises that window and leaves the minimized ones in the
 *   Dock. Minimizing is deliberate; a click meant for the window on screen must not undo it.
 * - **Everything minimized** → bring them all back. AppKit deminiaturizes at most one window by
 *   itself, so with two minimized windows the second one was reachable only through the Fenster
 *   menu or Exposé — the report this exists for (WP-67).
 *
 * Restoring is filtered on `isMinimized()`, which is what makes it idempotent next to AppKit:
 * whichever window it has already pulled out is simply not in the set, whether it got there
 * before this ran or after.
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
