/**
 * Return a copy of `list` with the item at index `i` moved by `dir` (-1 = up, +1 = down).
 * Out-of-bounds moves are a no-op and return the original array (reference-equal), so callers
 * can skip work with `next !== list`.
 */
export function arrayMove<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}
