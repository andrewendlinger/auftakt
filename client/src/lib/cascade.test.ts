import { describe, expect, it } from 'vitest';
import { CASCADE_STEP, cascadeBounds, fittedSize, type Rect } from '../../../electron/cascade';

/**
 * Same arrangement as backupDir.test.ts and bootLog.test.ts: the module lives in `electron/`,
 * imports nothing from `electron`, and this suite is the only automated run that reaches it.
 *
 * Why it exists: the cascade's whole job is that two windows are not in the same place, and the
 * previous version failed at exactly that on the two most ordinary laptop panels — it wrapped
 * to a fixed anchor, so from the second Cmd+N onward every window opened pixel-identical and
 * Cmd+N looked like it did nothing (PR50-06). No headless run drives real BrowserWindows, and
 * the arithmetic is where the bug was, so the arithmetic is what gets pinned. The displays
 * below are the traces from the finding.
 */

const PREFERRED = { width: 1440, height: 900 };
const MINIMUM = { width: 1024, height: 680 }; // the BrowserWindow minWidth/minHeight in main.ts

/** macOS 1440×900 panel: menu bar at the top, Dock at the bottom. */
const LAPTOP_1440: Rect = { x: 0, y: 25, width: 1440, height: 875 };
/** Windows 1366×768 panel: taskbar at the bottom. */
const LAPTOP_1366: Rect = { x: 0, y: 0, width: 1366, height: 728 };
/** Room to spare — the cascade must stay a plain diagonal here. */
const DESKTOP: Rect = { x: 0, y: 0, width: 2560, height: 1400 };

/** Walk `count` secondary windows, each cascading off the one before it. */
function openWindows(count: number, workArea: Rect, first: Rect): Rect[] {
  const opened: Rect[] = [];
  let src = first;
  let slot = 0;
  for (let i = 0; i < count; i++) {
    const { bounds, nextWrapSlot } = cascadeBounds(src, workArea, PREFERRED, MINIMUM, slot);
    opened.push(bounds);
    src = bounds;
    slot = nextWrapSlot;
  }
  return opened;
}

function inside(r: Rect, wa: Rect): boolean {
  return r.x >= wa.x && r.y >= wa.y && r.x + r.width <= wa.x + wa.width && r.y + r.height <= wa.y + wa.height;
}

describe('fittedSize', () => {
  it('leaves cascade room on a display that has none to spare', () => {
    // The bug's root: 1440 preferred on a 1440-wide work area is zero free pixels, so no
    // offsetting scheme can place two windows differently until the window itself gives some up.
    const size = fittedSize(LAPTOP_1440, PREFERRED, MINIMUM);
    expect(size.width).toBeLessThan(LAPTOP_1440.width);
    expect(size.height).toBeLessThan(LAPTOP_1440.height);
  });

  it('leaves the preferred size alone when the display is big enough', () => {
    expect(fittedSize(DESKTOP, PREFERRED, MINIMUM)).toEqual(PREFERRED);
  });

  it('never returns less than the window minimum', () => {
    // Electron enforces minWidth/minHeight itself, so a smaller number here would describe a
    // window that is not going to exist and every position derived from it would be off.
    const tiny = fittedSize({ x: 0, y: 0, width: 800, height: 600 }, PREFERRED, MINIMUM);
    expect(tiny).toEqual(MINIMUM);
  });
});

describe('cascadeBounds', () => {
  it('steps down and right off the source window', () => {
    const first: Rect = { x: 100, y: 100, ...PREFERRED };
    const { bounds, nextWrapSlot } = cascadeBounds(first, DESKTOP, PREFERRED, MINIMUM, 0);
    expect(bounds.x).toBe(100 + CASCADE_STEP);
    expect(bounds.y).toBe(100 + CASCADE_STEP);
    expect(nextWrapSlot).toBe(0); // no wrap happened, so the slot is untouched
  });

  for (const [name, wa] of [
    ['a 1440×900 laptop', LAPTOP_1440],
    ['a 1366×768 laptop', LAPTOP_1366],
    ['a 2560×1440 desktop', DESKTOP],
  ] as const) {
    it(`opens six distinct, fully visible windows on ${name}`, () => {
      const size = fittedSize(wa, PREFERRED, MINIMUM);
      const opened = openWindows(6, wa, { x: wa.x, y: wa.y, ...size });

      // The reported symptom, directly: consecutive windows landing on the same pixel.
      for (let i = 1; i < opened.length; i++) {
        expect(`${opened[i]!.x},${opened[i]!.y}`).not.toBe(`${opened[i - 1]!.x},${opened[i - 1]!.y}`);
      }
      // And a wrap that solves it by walking off the screen would be no better.
      for (const r of opened) expect(inside(r, wa)).toBe(true);
    });
  }

  it('advances the wrap anchor instead of resetting it', () => {
    // The fix itself: the old code wrapped to `workArea + CASCADE_STEP` every single time, so
    // two wraps in a row produced the same window twice.
    const far: Rect = { x: 1300, y: 800, ...fittedSize(LAPTOP_1440, PREFERRED, MINIMUM) };
    const slotZero = cascadeBounds(far, LAPTOP_1440, PREFERRED, MINIMUM, 0);
    const slotOne = cascadeBounds(far, LAPTOP_1440, PREFERRED, MINIMUM, 1);

    expect(slotZero.nextWrapSlot).toBe(1);
    expect(slotOne.bounds.x).toBe(slotZero.bounds.x + CASCADE_STEP);
    expect(slotOne.bounds.y).toBe(slotZero.bounds.y + CASCADE_STEP);
  });

  it('wraps into the work area, not to the screen corner', () => {
    // A macOS menu bar means workArea.y is 25, not 0. Wrapping to 0 would put the title bar
    // under it on every wrapped window.
    const far: Rect = { x: 1300, y: 800, ...fittedSize(LAPTOP_1440, PREFERRED, MINIMUM) };
    const { bounds } = cascadeBounds(far, LAPTOP_1440, PREFERRED, MINIMUM, 0);
    expect(bounds.x).toBe(LAPTOP_1440.x);
    expect(bounds.y).toBe(LAPTOP_1440.y);
  });

  it('skips a wrap slot that lands on the window it is cascading off', () => {
    // Found by the 1366×768 walk above: with only two slots the anchor sequence and the step
    // sequence interleave, and the slot's turn came round on the source window's own position.
    const size = fittedSize(LAPTOP_1366, PREFERRED, MINIMUM);
    const src: Rect = { x: LAPTOP_1366.x + CASCADE_STEP, y: LAPTOP_1366.y + CASCADE_STEP, ...size };
    // Slot 1 is exactly where `src` sits, so this must not return src's position.
    const { bounds } = cascadeBounds(src, LAPTOP_1366, PREFERRED, MINIMUM, 1);
    expect(`${bounds.x},${bounds.y}`).not.toBe(`${src.x},${src.y}`);
  });
});
