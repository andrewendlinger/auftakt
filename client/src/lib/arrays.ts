/**
 * Return a copy of `list` with the item at index `i` moved by `dir` (-1 = up, +1 = down).
 * Out-of-bounds moves are a no-op and return the original array (reference-equal), so callers
 * can skip work with `next !== list`.
 */
export function arrayMove<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  // Both indices, not just the destination: `arrayMove(list, list.length, -1)` passed a
  // destination-only guard, then wrote index `length` — growing the array by one and leaving a
  // hole at `length - 1`, which the caller's `next !== list` check reported as a successful move.
  // No current caller can supply it (all three derive `i` from the same list), but the doc
  // contract above and `arrayMoveTo` below both promise the symmetric check (CCL-32).
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/**
 * Return a copy of `list` with the item at `from` lifted out and re-inserted at `to`, shifting
 * everything in between. This is the drag semantic — unlike `arrayMove`'s swap, dropping onto a
 * distant row moves only the dragged item. Out-of-bounds or no-op moves return the original
 * array (reference-equal), so callers can skip work with `next !== list`.
 */
export function arrayMoveTo<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= list.length || to >= list.length || from === to) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}
