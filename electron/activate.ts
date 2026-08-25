/**
 * What clicking the Dock icon means (macOS).
 *
 * Imports nothing from `electron`, deliberately — the same rule as cascade.ts, backup.ts,
 * appLog.ts and exportName.ts: the windows arrive as anything that can answer `isDestroyed()`
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
 * - **Something on screen** → do nothing. The convention is Finder's and Safari's: activating an
 *   app that already has a window up raises that window and leaves the minimized ones in the
 *   Dock. Minimizing the other one was deliberate, and a click aimed at the window on screen must
 *   not undo it.
 * - **Everything minimized** → bring them all back. On a Dock click *one* window returns without
 *   any help from here, and with two minimized windows the second one was reachable through
 *   nothing but the Fenster menu or Exposé — the report this exists for (WP-67).
 *
 * **„On screen" is read off the windows, never from `hasVisibleWindows`** (WP-67b). That flag —
 * AppKit's answer to `applicationShouldHandleReopen:hasVisibleWindows:`, which Electron forwards
 * to the `activate` event — is `true` here *while every window is minimized*. Measured on Electron
 * 43.3.0 / macOS 15.6 with a bare two-window probe that restores nothing of its own:
 *
 *     ACTIVATE  hasVisibleWindows = true
 *       state at event: #0 min=true vis=false | #1 min=true vis=false
 *
 * WP-67 branched on the flag and therefore never reached the branch it had just built; the
 * reported bug survived its own fix. The same measurement shows the list is right at that moment —
 * both windows answer `isMinimized()` with `true` — and that the flag is honest in the one case
 * that does not need it (no windows at all → `false`). So the state comes from the list.
 *
 * `isMinimized()` and not `isVisible()`, which settles one further case: a window hidden without
 * being minimized — the app behind Cmd+H, or one still on its way up — counts as on screen. Cmd+H
 * with one window minimized therefore answers the next Dock click with only the window that was
 * up, which is Finder's answer and the one the macOS pass of 2026-08-18 recorded. It is also what
 * the probe showed happening anyway: macOS unhides before the event, so the handler already reads
 * that window as un-minimized.
 *
 * Whatever macOS restores on its own is deliberately left unnamed: this code can observe neither
 * which part of it does that nor precisely when. What the probe shows is the *order*, and only
 * that: at the moment of the event every window was still minimized, and the window macOS brings
 * back first appeared in the next sample, taken 657 ms later. The margin between the two is not
 * measured — the plan is simply computed on the state at the click, and whatever macOS does next
 * finds nothing left to do.
 *
 * Destroyed windows are dropped before the count rather than after, for the reason `liveWindow()`
 * in main.ts gives at length: `getAllWindows()` is Electron's registry, and a window on its way
 * out can still be in it — counting one would answer a Dock click with nothing at all.
 */
export function activatePlan<T extends ActivatableWindow>(windows: readonly T[]): ActivatePlan<T> {
  const live = windows.filter((w) => !w.isDestroyed());
  if (live.length === 0) return { create: true, restore: [] };
  if (live.some((w) => !w.isMinimized())) return { create: false, restore: [] };
  // Every live window is minimized — that is exactly what the branch above ruled out.
  return { create: false, restore: live };
}
