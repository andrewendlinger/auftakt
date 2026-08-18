import { describe, expect, it } from 'vitest';
import { activatePlan } from '../../../electron/activate';

/**
 * The module under test lives in `electron/`, not here — same arrangement as `backupDir`,
 * `bootLog`, `cascade` and `exportName`, and for a sharper reason than any of them: this is a
 * Dock click. No `check:*` script drives it, `check:browser` drives a page rather than a process,
 * and launching the real app opens a window on somebody's desktop. Reading the code is the only
 * other check there is, which is exactly why the decision was extracted to be readable here.
 *
 * Why it exists: with two windows minimized, clicking the Dock icon brought one of them back and
 * left the other reachable only from the Fenster menu (WP-67).
 *
 * Why it takes one argument (WP-67b): the first version took macOS' `hasVisibleWindows` as the
 * second, and that flag is `true` while every window is minimized — so the branch WP-67 added was
 * never reached and the bug survived its fix. Every case below is now a statement about the
 * window list, which a bare Electron probe measured as correct at the moment of the event.
 */

const win = (state: { minimized?: boolean; destroyed?: boolean } = {}) => ({
  isMinimized: () => state.minimized ?? false,
  isDestroyed: () => state.destroyed ?? false,
});

describe('activatePlan', () => {
  it('opens a window when none is left', () => {
    // macOS keeps the app alive with no windows; this is the branch that was always here.
    expect(activatePlan([])).toEqual({ create: true, restore: [] });
  });

  it('opens a window when the only ones left are destroyed', () => {
    // getAllWindows() is Electron's registry and a window on its way out is still in it, so
    // counting the raw list would answer the click with nothing at all.
    expect(activatePlan([win({ destroyed: true })])).toEqual({ create: true, restore: [] });
  });

  it('restores every minimized window when none is on screen', () => {
    const [a, b, c] = [win({ minimized: true }), win({ minimized: true }), win({ minimized: true })];
    const plan = activatePlan([a, b, c]);
    expect(plan.create).toBe(false);
    // All of them, in the order they came in — the report is that the second never came back.
    expect(plan.restore).toEqual([a, b, c]);
  });

  it('leaves minimized windows alone while one is on screen', () => {
    // The macOS convention (Finder, Safari): activating an app that already shows a window
    // raises that window. Minimizing the other was deliberate and is not undone by a click
    // aimed at the visible one. This is the case macOS' own flag could not tell apart from the
    // one above — it says „true" for both, which is why the answer is derived here instead.
    const hidden = win({ minimized: true });
    expect(activatePlan([win(), hidden])).toEqual({ create: false, restore: [] });
  });

  it('never creates a second window just because everything is minimized', () => {
    // A minimized window *is* a window: the create branch must stay tied to there being none.
    expect(activatePlan([win({ minimized: true })]).create).toBe(false);
  });

  it('treats a window that is already back as a window on screen', () => {
    // The plan is computed on the state at the moment of the click. If macOS got there first and
    // brought one back, the app is in the „one on screen" case and the click is a no-op — which
    // is also what a second click does, and what the macOS pass judged correct. The probe of
    // 2026-08-18 measured the opposite order anyway: every window still minimized at the event,
    // macOS' own restore first visible in the next sample 657 ms on.
    const restored = win();
    const stillDown = win({ minimized: true });
    expect(activatePlan([restored, stillDown]).restore).toEqual([]);
  });

  it('counts a hidden window that is not minimized as on screen', () => {
    // Cmd+H hides the app without minimizing anything, so `isMinimized()` stays false and this is
    // the branch above. The next Dock click brings back only what was up — B stays in the Dock,
    // the answer the macOS pass of 2026-08-18 recorded for that question, and Finder's.
    const hiddenByCmdH = win();
    const minimizedBefore = win({ minimized: true });
    expect(activatePlan([hiddenByCmdH, minimizedBefore])).toEqual({ create: false, restore: [] });
  });

  it('brings everything back when the app was hidden with everything minimized', () => {
    // Same Cmd+H, other starting point: nothing was left un-minimized, so nothing is on screen
    // and the whole set comes back.
    const [a, b] = [win({ minimized: true }), win({ minimized: true })];
    expect(activatePlan([a, b]).restore).toEqual([a, b]);
  });

  it('does not try to restore a destroyed window', () => {
    const gone = win({ minimized: true, destroyed: true });
    const live = win({ minimized: true });
    expect(activatePlan([gone, live]).restore).toEqual([live]);
  });
});
