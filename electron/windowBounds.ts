import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Rect, Size } from './cascade';

/**
 * Where the window was when it was last closed (WP-55).
 *
 * Lowering the minimum size lets the customer put two windows side by side; without this the
 * next launch throws the arrangement away, which is half the feature. Every window writes on
 * `close`, so the last one closed wins, and only the *first* window of a launch reads it back —
 * secondary windows keep cascading off the focused one (`cascade.ts`).
 *
 * Imports nothing from `electron`, deliberately — the same rule as backup.ts, bootLog.ts and
 * cascade.ts, and for the same reason: it is what lets `client/src/lib/windowBounds.test.ts`
 * drive `usableBounds` from `check:unit`, which is the only automated run that reaches
 * main-process code at all. The userData path and the work areas are passed in.
 *
 * **This is per-machine state, so it lives beside `boot-log.jsonl` in userData and deliberately
 * not in `seasons.json`.** The registry is exported, imported and backed up; a monitor layout
 * has no business travelling to another machine inside somebody's data.
 */

export const WINDOW_BOUNDS_NAME = 'window-bounds.json';

/** A remembered window: the rectangle it would restore to, plus whether it was maximized. */
export interface SavedWindow extends Rect {
  maximized: boolean;
}

/** Pure: is this parsed JSON a rectangle at all? */
function isRect(v: unknown): v is Rect {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (['x', 'y', 'width', 'height'] as const).every((k) => typeof r[k] === 'number' && Number.isFinite(r[k]));
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** How much of the saved rectangle has to land on a work area for it to count as that screen's. */
function overlap(r: Rect, wa: Rect): number {
  const w = Math.min(r.x + r.width, wa.x + wa.width) - Math.max(r.x, wa.x);
  const h = Math.min(r.y + r.height, wa.y + wa.height) - Math.max(r.y, wa.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Pure: the bounds to actually open at, or `null` when the saved rectangle cannot be salvaged
 * and the caller should fall back to `fittedSize` and Electron's own centring.
 *
 * **The failure this exists for is a window that opens where no screen is.** Bounds saved on an
 * external monitor outlive the monitor: at the desk the rectangle is real, on the train it is
 * 2000 px to the right of everything, and an app that restores it faithfully appears not to
 * start at all. So the work area with the largest overlap wins, and *no* overlap is a refusal
 * rather than a guess.
 *
 * Everything short of that is clamped rather than refused — dragging a window half off the
 * bottom edge is a thing people do on purpose, and answering it by throwing the position away
 * would be more surprising than pulling it back on. The size is clamped up to `minimum` too:
 * Electron enforces minWidth/minHeight itself, so a stale file written by a version with a
 * larger window would otherwise describe a window that is not going to exist — the same reason
 * `fittedSize` never returns less than the minimum.
 */
export function usableBounds(
  saved: SavedWindow | null,
  workAreas: readonly Rect[],
  minimum: Size,
): SavedWindow | null {
  if (!saved || workAreas.length === 0) return null;

  let best = workAreas[0]!;
  let bestOverlap = 0;
  for (const wa of workAreas) {
    const area = overlap(saved, wa);
    if (area > bestOverlap) {
      best = wa;
      bestOverlap = area;
    }
  }
  if (bestOverlap === 0) return null;

  // A work area smaller than the minimum keeps the minimum and overflows, which is what
  // fittedSize does on the same panel — the two must not disagree about how big the window is.
  const width = clamp(Math.round(saved.width), minimum.width, Math.max(minimum.width, best.width));
  const height = clamp(Math.round(saved.height), minimum.height, Math.max(minimum.height, best.height));
  return {
    x: clamp(Math.round(saved.x), best.x, Math.max(best.x, best.x + best.width - width)),
    y: clamp(Math.round(saved.y), best.y, Math.max(best.y, best.y + best.height - height)),
    width,
    height,
    maximized: saved.maximized,
  };
}

/** The saved window, or null when there is none, it is unreadable, or it is not a rectangle. */
export function readWindowBounds(dir: string): SavedWindow | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(dir, WINDOW_BOUNDS_NAME), 'utf8'));
    if (!isRect(raw)) return null;
    const { x, y, width, height } = raw;
    if (width <= 0 || height <= 0) return null;
    return { x, y, width, height, maximized: (raw as { maximized?: unknown }).maximized === true };
  } catch {
    /* no file yet, unreadable userData, torn write — the launch goes on centred */
    return null;
  }
}

/**
 * Write via a temp file and a rename, the same shape as `saveRegistry()` in server/src/db.ts:
 * this runs on `close`, i.e. while the app is on its way out, and a half-written file is the
 * one thing worse than no file — `readWindowBounds` would have to survive it on every launch
 * thereafter.
 */
export function writeWindowBounds(dir: string, saved: SavedWindow): void {
  const target = join(dir, WINDOW_BOUNDS_NAME);
  const tmp = `${target}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(saved), 'utf8');
    renameSync(tmp, target);
  } catch {
    /* unwritable userData — the window position is not worth a dialog on the way out */
    try {
      unlinkSync(tmp);
    } catch {
      /* nothing to clean up */
    }
  }
}
