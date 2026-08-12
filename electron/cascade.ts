/**
 * Where a new BrowserWindow goes.
 *
 * Imports nothing from `electron`, deliberately — the same rule as backup.ts, bootLog.ts and
 * exportName.ts: `screen.getDisplayMatching().workArea` and the source window's bounds are
 * passed in as plain rectangles, which is what lets `client/src/lib/cascade.test.ts` drive the
 * two laptop displays this got wrong from `check:unit`. Nothing here talks to a display.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** The diagonal step between two cascaded windows. */
export const CASCADE_STEP = 28;

/**
 * How much of the work area stays free so a cascade has somewhere to go. Three steps is four
 * distinct slots — enough that the wrap is visible rather than a stutter, and small enough
 * that the window is still the size the app wants on any display with room for it.
 */
const CASCADE_ROOM = 3 * CASCADE_STEP;

/**
 * The window size to actually use: the preferred size, shrunk to leave cascade room, but never
 * below the window's own minimum (Electron would silently enforce that and every position
 * computed from the smaller number would be wrong) and never larger than the work area.
 *
 * This is half of PR50-06 and not an embellishment: at 1440×900 preferred on a 1440×875 work
 * area there are *zero* free pixels on either axis, so no offsetting scheme whatsoever can
 * place two windows differently. It also stops the default window extending under the Dock,
 * which it has always done on that panel.
 */
export function fittedSize(workArea: Rect, preferred: Size, minimum: Size): Size {
  return {
    width: fitAxis(workArea.width, preferred.width, minimum.width),
    height: fitAxis(workArea.height, preferred.height, minimum.height),
  };
}

function fitAxis(available: number, preferred: number, min: number): number {
  // min first, then the work area: a display too small for the minimum is the OS's problem,
  // and returning less than `min` would make the slot arithmetic below describe a window
  // Electron is not going to create.
  return Math.max(min, Math.min(preferred, Math.max(min, available - CASCADE_ROOM)));
}

/**
 * The bounds for a secondary window, cascaded off `src`.
 *
 * Ordinarily one step down and right from the window it was opened from. When that would push
 * the window past the work area it wraps — and the wrap is where this used to collapse: it
 * reset to a *fixed* anchor (`workArea + CASCADE_STEP`), so on any display narrower than
 * preferred+2·step or shorter than preferred+2·step the second secondary window landed on the
 * first, and every window after it landed there too. 1366×768 and 1440×900 are both below that
 * bound, i.e. the ordinary laptop panels rather than pathological ones, and the symptom is
 * Cmd+N looking like it did nothing at all (PR50-06).
 *
 * So the wrap advances instead of resetting: slot `wrapSlot % slots`, counted from the work
 * area's corner, cycling through the slots that fit — the way a window manager's own cascade
 * behaves. Both axes wrap together, keeping the diagonal; `nextWrapSlot` is what the caller
 * stores for the next window.
 */
export function cascadeBounds(
  src: Rect,
  workArea: Rect,
  preferred: Size,
  minimum: Size,
  wrapSlot: number,
): { bounds: Rect; nextWrapSlot: number } {
  const size = fittedSize(workArea, preferred, minimum);
  const x = src.x + CASCADE_STEP;
  const y = src.y + CASCADE_STEP;
  const fits =
    x >= workArea.x &&
    y >= workArea.y &&
    x + size.width <= workArea.x + workArea.width &&
    y + size.height <= workArea.y + workArea.height;

  if (fits) return { bounds: { x, y, ...size }, nextWrapSlot: wrapSlot };

  // The number of distinct anchors that keep the whole window inside the work area. Shared
  // between the axes so the cascade stays diagonal; at least one, for a display with no room
  // at all, where every window necessarily lands in the same corner.
  const room = Math.min(workArea.width - size.width, workArea.height - size.height);
  const slots = Math.max(1, Math.floor(room / CASCADE_STEP) + 1);
  let slot = wrapSlot % slots;
  // Skip a slot that lands exactly on the window we are cascading off. With few slots the
  // two sequences interleave — on a 1366×768 panel there are two — and the slot's turn can
  // come round on the source's own position, which is the collision the wrap exists to
  // prevent. Only reachable when there is somewhere else to go.
  if (slots > 1 && workArea.x + slot * CASCADE_STEP === src.x && workArea.y + slot * CASCADE_STEP === src.y) {
    slot = (slot + 1) % slots;
  }
  const offset = slot * CASCADE_STEP;
  return {
    bounds: { x: workArea.x + offset, y: workArea.y + offset, ...size },
    nextWrapSlot: slot + 1,
  };
}
