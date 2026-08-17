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
 */

const win = (state: { minimized?: boolean; destroyed?: boolean } = {}) => ({
  isMinimized: () => state.minimized ?? false,
  isDestroyed: () => state.destroyed ?? false,
});

describe('activatePlan', () => {
  it('opens a window when none is left', () => {
    // macOS keeps the app alive with no windows; this is the branch that was always here.
    expect(activatePlan([], false)).toEqual({ create: true, restore: [] });
  });

  it('opens a window when the only ones left are destroyed', () => {
    // getAllWindows() is Electron's registry and a window on its way out is still in it, so
    // counting the raw list would answer the click with nothing at all.
    expect(activatePlan([win({ destroyed: true })], false)).toEqual({ create: true, restore: [] });
  });

  it('restores every minimized window when nothing is on screen', () => {
    const [a, b, c] = [win({ minimized: true }), win({ minimized: true }), win({ minimized: true })];
    const plan = activatePlan([a, b, c], false);
    expect(plan.create).toBe(false);
    // In opening order, and all of them — the report is that the second window never came back.
    expect(plan.restore).toEqual([a, b, c]);
  });

  it('leaves minimized windows alone while one is on screen', () => {
    // The macOS convention (Finder, Safari): activating an app that already shows a window
    // raises that window. Minimizing the other was deliberate and is not undone by a click
    // aimed at the visible one.
    const hidden = win({ minimized: true });
    expect(activatePlan([win(), hidden], true)).toEqual({ create: false, restore: [] });
  });

  it('never creates a second window just because everything is minimized', () => {
    // A minimized window *is* a window: the create branch must stay tied to there being none.
    expect(activatePlan([win({ minimized: true })], false).create).toBe(false);
  });

  it('skips whatever AppKit already deminiaturized', () => {
    // AppKit pulls at most one window out by itself, and the order it does that in relative to
    // this handler is not ours to pick — filtering on isMinimized() is what makes the two
    // idempotent side by side, either way round.
    const restored = win();
    const stillDown = win({ minimized: true });
    expect(activatePlan([restored, stillDown], false).restore).toEqual([stillDown]);
  });

  it('does not try to restore a destroyed window', () => {
    const gone = win({ minimized: true, destroyed: true });
    const live = win({ minimized: true });
    expect(activatePlan([gone, live], false).restore).toEqual([live]);
  });
});
