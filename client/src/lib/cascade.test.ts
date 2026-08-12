import { describe, expect, it } from 'vitest';
import { CASCADE_STEP, cascadeAnchors, cascadeBounds, fittedSize, type Rect } from '../../../electron/cascade';

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
 *
 * **The assertions compare the whole set, not each window with its predecessor.** A neighbour
 * check passes a two-position cycle — six windows in two places, which is the reported bug —
 * and an intermediate version of this fix did exactly that.
 */

const PREFERRED = { width: 1440, height: 900 };
const MINIMUM = { width: 1024, height: 680 }; // the BrowserWindow minWidth/minHeight in main.ts

/** macOS 1440×900 panel: menu bar at the top, Dock at the bottom. */
const LAPTOP_1440: Rect = { x: 0, y: 25, width: 1440, height: 875 };
/** Windows 1366×768 panel: taskbar at the bottom. Its height *minimum* binds — see below. */
const LAPTOP_1366: Rect = { x: 0, y: 0, width: 1366, height: 728 };
/** Room to spare — the cascade must stay a plain diagonal here. */
const DESKTOP: Rect = { x: 0, y: 0, width: 2560, height: 1400 };

/** Where Electron puts the first window: centred, size-fitted, off the anchor lattice. */
function firstWindow(workArea: Rect): Rect {
  const size = fittedSize(workArea, PREFERRED, MINIMUM);
  return {
    x: workArea.x + Math.floor((workArea.width - size.width) / 2),
    y: workArea.y + Math.floor((workArea.height - size.height) / 2),
    ...size,
  };
}

/** Walk `count` further windows the way createWindow does, accumulating what is on screen. */
function openWindows(count: number, workArea: Rect): Rect[] {
  const open = [firstWindow(workArea)];
  for (let i = 0; i < count; i++) {
    open.push(cascadeBounds(open[open.length - 1]!, workArea, PREFERRED, MINIMUM, open));
  }
  return open;
}

const spots = (rects: Rect[]) => new Set(rects.map((r) => `${r.x},${r.y}`));

function inside(r: Rect, wa: Rect): boolean {
  return r.x >= wa.x && r.y >= wa.y && r.x + r.width <= wa.x + wa.width && r.y + r.height <= wa.y + wa.height;
}

describe('fittedSize', () => {
  it('leaves cascade room on a display that has none to spare', () => {
    // The bug's root: 1440 preferred on a 1440-wide work area is zero free pixels, so no
    // placement scheme can put two windows in different places until the window gives some up.
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
    expect(fittedSize({ x: 0, y: 0, width: 800, height: 600 }, PREFERRED, MINIMUM)).toEqual(MINIMUM);
  });
});

describe('cascadeAnchors', () => {
  it('counts the axes separately when the minimum eats one of them', () => {
    // 1366×768: the width keeps its 84 px of room (4 columns) but the 680 minimum leaves the
    // height only 48 (2 rows). Insisting on a square diagonal here would offer 2 anchors where
    // 8 exist — which is how this collapses back into the bug it exists to fix.
    const anchors = cascadeAnchors(LAPTOP_1366, fittedSize(LAPTOP_1366, PREFERRED, MINIMUM));
    expect(anchors).toHaveLength(8); // 4 columns × 2 rows
    expect(new Set(anchors.map((p) => `${p.x},${p.y}`)).size).toBe(anchors.length);
  });

  it('offers the diagonal first, so a fallback still looks like a cascade', () => {
    const anchors = cascadeAnchors(DESKTOP, fittedSize(DESKTOP, PREFERRED, MINIMUM));
    expect(anchors[0]).toEqual({ x: 0, y: 0 });
    expect(anchors[1]).toEqual({ x: CASCADE_STEP, y: CASCADE_STEP });
  });
});

describe('cascadeBounds', () => {
  it('steps down and right off the source window', () => {
    const first = firstWindow(DESKTOP);
    const next = cascadeBounds(first, DESKTOP, PREFERRED, MINIMUM, [first]);
    expect(next.x).toBe(first.x + CASCADE_STEP);
    expect(next.y).toBe(first.y + CASCADE_STEP);
  });

  it('keeps stepping while there is room — a plain diagonal on a big display', () => {
    const open = openWindows(6, DESKTOP);
    for (let i = 1; i < open.length; i++) {
      expect(open[i]!.x).toBe(open[i - 1]!.x + CASCADE_STEP);
      expect(open[i]!.y).toBe(open[i - 1]!.y + CASCADE_STEP);
    }
  });

  for (const [name, wa] of [
    ['a 1440×900 laptop', LAPTOP_1440],
    ['a 1366×768 laptop', LAPTOP_1366],
    ['a 2560×1400 desktop', DESKTOP],
  ] as const) {
    it(`opens eight windows in eight different places on ${name}`, () => {
      const open = openWindows(7, wa);
      // The reported symptom, directly — and the whole set, because the old fix produced a
      // two-position cycle that any neighbour-only assertion waves through.
      expect(spots(open).size).toBe(open.length);
      // A placement that solved it by walking off the screen would be no better.
      for (const r of open) expect(inside(r, wa)).toBe(true);
    });
  }

  it('skips a place while a window is in it, and takes it back when that window closes', () => {
    // The state is the open windows, not a counter: a counter and the stepped positions share
    // the same 28-pixel lattice, so the seventh window landed exactly on the fourth. Deriving
    // it from what is on screen cannot drift — and it frees a place when a window closes,
    // which a counter that only ever goes up never would.
    const wa = LAPTOP_1440;
    const first = firstWindow(wa);
    const stepped = { x: first.x + CASCADE_STEP, y: first.y + CASCADE_STEP, width: 0, height: 0 };

    const blocked = cascadeBounds(first, wa, PREFERRED, MINIMUM, [first, stepped]);
    expect(`${blocked.x},${blocked.y}`).not.toBe(`${stepped.x},${stepped.y}`);

    const freed = cascadeBounds(first, wa, PREFERRED, MINIMUM, [first]);
    expect(`${freed.x},${freed.y}`).toBe(`${stepped.x},${stepped.y}`);
  });

  it('reuses a place only once every anchor is occupied', () => {
    // Eight anchors on this panel, so nine windows must overlap somewhere — but not before.
    const open = openWindows(8, LAPTOP_1366);
    expect(spots(open).size).toBe(open.length);
    const ninth = cascadeBounds(open[open.length - 1]!, LAPTOP_1366, PREFERRED, MINIMUM, open);
    expect(inside(ninth, LAPTOP_1366)).toBe(true);
  });

});
