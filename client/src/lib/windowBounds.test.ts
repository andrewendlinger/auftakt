import { describe, expect, it } from 'vitest';
import { WINDOW_MINIMUM, type Rect } from '../../../electron/cascade';
import { usableBounds, type SavedWindow } from '../../../electron/windowBounds';

/**
 * Same arrangement as cascade.test.ts, backupDir.test.ts and bootLog.test.ts: the module lives
 * in `electron/`, imports nothing from `electron`, and this suite is the only automated run
 * that reaches it.
 *
 * Why it exists: restoring a window is one of those features whose failure mode is silence.
 * A rectangle saved on a monitor that is not plugged in any more restores perfectly — onto
 * coordinates nobody can see — and the symptom the user reports is „the app does not start".
 * There is no headless run that drives real displays, so the decision of *which* saved
 * rectangle is still usable is the thing that gets pinned.
 *
 * Only the pure half is driven here. `readWindowBounds`/`writeWindowBounds` touch disk, and
 * none of the four suites in this arrangement do.
 */

const MINIMUM = WINDOW_MINIMUM;

/** A laptop panel with the menu bar and Dock taken off, i.e. the primary work area. */
const LAPTOP: Rect = { x: 0, y: 25, width: 1440, height: 875 };
/** A second screen to the right of it. Its origin is what makes saved bounds non-portable. */
const EXTERNAL: Rect = { x: 1440, y: 0, width: 1920, height: 1080 };

const saved = (r: Partial<SavedWindow>): SavedWindow => ({
  x: 100,
  y: 100,
  width: 900,
  height: 700,
  maximized: false,
  ...r,
});

describe('usableBounds', () => {
  it('hands back a rectangle that is already on a screen', () => {
    const want = saved({ x: 40, y: 60, width: 800, height: 600 });
    expect(usableBounds(want, [LAPTOP], MINIMUM)).toEqual(want);
  });

  it('refuses bounds from a screen that is no longer attached', () => {
    // The whole point. Saved at the desk on the external monitor, reopened on the train: the
    // rectangle is still perfectly valid, it just describes a place that does not exist. Null
    // sends the caller back to fittedSize + Electron's centring, i.e. a visible window.
    const onExternal = saved({ x: 2000, y: 200, width: 900, height: 700 });
    expect(usableBounds(onExternal, [LAPTOP], MINIMUM)).toBeNull();
  });

  it('keeps a window on the screen it was mostly on, not the first one listed', () => {
    const onExternal = saved({ x: 1600, y: 200, width: 900, height: 700 });
    const got = usableBounds(onExternal, [LAPTOP, EXTERNAL], MINIMUM);
    expect(got).toEqual(onExternal);
  });

  it('pulls a half-dragged window back on instead of throwing its position away', () => {
    // Dragging a window off the bottom-right edge is something people do on purpose, so the
    // answer is a clamp, not a refusal — refusing would re-centre a window the user had placed.
    const got = usableBounds(saved({ x: 1300, y: 800, width: 800, height: 600 }), [LAPTOP], MINIMUM);
    expect(got).toEqual({ x: 640, y: 300, width: 800, height: 600, maximized: false });
  });

  it('never returns less than the window minimum', () => {
    // A file written by a version with a smaller minimum would otherwise describe a window
    // Electron is not going to create — the same rule fittedSize follows.
    const got = usableBounds(saved({ x: 0, y: 25, width: 320, height: 240 }), [LAPTOP], MINIMUM);
    expect(got).toMatchObject({ width: MINIMUM.width, height: MINIMUM.height });
  });

  it('keeps the minimum even on a work area too small to hold it', () => {
    // fittedSize overflows a tiny panel rather than going under the minimum; if this clamped
    // down to the work area instead, the two would disagree about how big the window is.
    const tiny: Rect = { x: 0, y: 0, width: 600, height: 500 };
    expect(usableBounds(saved({ x: 0, y: 0 }), [tiny], MINIMUM)).toEqual({
      x: 0,
      y: 0,
      width: MINIMUM.width,
      height: MINIMUM.height,
      maximized: false,
    });
  });

  it('shrinks a window that is wider than the screen it landed on', () => {
    const got = usableBounds(saved({ x: 0, y: 25, width: 3000, height: 2000 }), [LAPTOP], MINIMUM);
    expect(got).toEqual({ x: 0, y: 25, width: LAPTOP.width, height: LAPTOP.height, maximized: false });
  });

  it('carries the maximized flag through', () => {
    expect(usableBounds(saved({ maximized: true }), [LAPTOP], MINIMUM)?.maximized).toBe(true);
  });

  it('refuses when there is nothing saved, or no display to put it on', () => {
    expect(usableBounds(null, [LAPTOP], MINIMUM)).toBeNull();
    expect(usableBounds(saved({}), [], MINIMUM)).toBeNull();
  });
});
