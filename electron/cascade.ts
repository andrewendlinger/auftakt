/**
 * Where a new BrowserWindow goes.
 *
 * Imports nothing from `electron`, deliberately — the same rule as backup.ts, bootLog.ts and
 * exportName.ts: `screen.getDisplayMatching().workArea`, the source window's bounds and the
 * bounds of the windows already open are passed in as plain rectangles, which is what lets
 * `client/src/lib/cascade.test.ts` drive the two laptop displays this got wrong from
 * `check:unit`. Nothing here talks to a display.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
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
 * How much of the work area to keep free so a cascade has somewhere to go. Three steps is four
 * anchors per axis — enough that the cascade is visible rather than a stutter, and small enough
 * that the window is still the size the app wants on any display with room for it.
 */
const CASCADE_ROOM = 3 * CASCADE_STEP;

/**
 * The window size to actually use: the preferred size, shrunk to leave cascade room, but never
 * below the window's own minimum (Electron enforces that itself, and every position computed
 * from a smaller number would describe a window that is not going to exist) and never larger
 * than the work area.
 *
 * Half of PR50-06, and not an embellishment: at 1440×900 preferred on a 1440×875 work area
 * there are *zero* free pixels on either axis, so no placement scheme whatsoever can put two
 * windows in different places. It also stops the default window extending under the Dock, which
 * it has always done on that panel.
 *
 * The minimum can still bind and eat the room — 680 tall on a 728 work area leaves 48 px, not
 * 84 — which is why the anchors below are counted per axis from what is actually left rather
 * than assumed to be `CASCADE_ROOM`.
 */
export function fittedSize(workArea: Rect, preferred: Size, minimum: Size): Size {
  return {
    width: fitAxis(workArea.width, preferred.width, minimum.width),
    height: fitAxis(workArea.height, preferred.height, minimum.height),
  };
}

function fitAxis(available: number, preferred: number, min: number): number {
  return Math.max(min, Math.min(preferred, Math.max(min, available - CASCADE_ROOM)));
}

/**
 * Every position on the work area's cascade lattice, in the order to try them: the diagonal
 * first, so the fallback still looks like a cascade, then whatever anchors are left.
 *
 * Counted per axis, because the two are not always equal — on a 1366×768 panel the height
 * minimum binds and leaves 48 px against the width's 84, so there are four columns but only
 * two rows. Insisting on a square diagonal there would offer two positions where eight exist,
 * which is how this collapses back into the bug it is meant to fix.
 */
export function cascadeAnchors(workArea: Rect, size: Size): Point[] {
  const cols = Math.max(1, Math.floor((workArea.width - size.width) / CASCADE_STEP) + 1);
  const rows = Math.max(1, Math.floor((workArea.height - size.height) / CASCADE_STEP) + 1);
  const at = (i: number, j: number) => ({ x: workArea.x + i * CASCADE_STEP, y: workArea.y + j * CASCADE_STEP });

  const diagonal = Math.min(cols, rows);
  const anchors: Point[] = [];
  for (let k = 0; k < diagonal; k++) anchors.push(at(k, k));
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) if (i !== j || i >= diagonal) anchors.push(at(i, j));
  }
  return anchors;
}

/**
 * Whether a window already sits close enough to `p` to read as the same place.
 *
 * Half a step, not a whole one: a full step is the distance between two *adjacent anchors*, so
 * using it lets one off-lattice window — the first one, which Electron centres — veto four of
 * the eight anchors a 1366×768 panel has, and the cascade runs out of places to go by the sixth
 * window. Windows offset by a half step in both axes are visibly two windows; only something
 * nearer than that is stacked.
 */
function occupied(p: Point, taken: readonly Point[]): boolean {
  const tolerance = CASCADE_STEP / 2;
  return taken.some((t) => Math.abs(t.x - p.x) < tolerance && Math.abs(t.y - p.y) < tolerance);
}

function fits(p: Point, size: Size, workArea: Rect): boolean {
  return (
    p.x >= workArea.x &&
    p.y >= workArea.y &&
    p.x + size.width <= workArea.x + workArea.width &&
    p.y + size.height <= workArea.y + workArea.height
  );
}

/**
 * The bounds for a secondary window: one step down and right from the window it was opened
 * from, or — when that would leave the work area or land on a window that is already there —
 * the first free anchor on the lattice.
 *
 * **`taken` is the whole state.** A counter was the obvious way to remember which anchor came
 * next, and it does not work: the stepped positions and the anchors sit on the same 28-pixel
 * lattice, so after a wrap the cascade walks straight back over anchors it had already used
 * and the seventh window lands exactly on the fourth. Asking where the windows actually are
 * cannot drift, and it frees a slot when a window closes, which a counter never would.
 *
 * What this replaced wrapped to a *fixed* anchor, so on any display narrower than
 * preferred+2·step or shorter than preferred+2·step the second secondary window landed on the
 * first and so did every window after it. 1366×768 and 1440×900 are both under that bound —
 * the ordinary laptop panels rather than pathological ones — and the symptom is Cmd+N looking
 * like it did nothing at all (PR50-06).
 */
export function cascadeBounds(
  src: Point,
  workArea: Rect,
  preferred: Size,
  minimum: Size,
  taken: readonly Point[],
): Rect {
  const size = fittedSize(workArea, preferred, minimum);
  const anchors = cascadeAnchors(workArea, size);
  const stepped = { x: src.x + CASCADE_STEP, y: src.y + CASCADE_STEP };
  const spot =
    [stepped, ...anchors].find((p) => fits(p, size, workArea) && !occupied(p, taken)) ??
    // More windows than anchors: something has to overlap, and the first anchor is the
    // least surprising place for it.
    anchors[0]!;
  return { ...spot, ...size };
}
