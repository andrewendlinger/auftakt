import type { LayoutEntry } from '../api/types';

/**
 * The pure moves on a stored layout array that section removal is built from
 * (`Arranger.removeBuiltin` and its undo arms). They live here rather than in
 * `SectionArranger.tsx` so `check:unit` can reach them without pulling React and the API
 * client into a node test run.
 */

/**
 * Flag `key`'s entry as removed. The entry is a tombstone, not a deletion: position and width
 * survive for the picker's re-add, and its presence is what distinguishes „the user took this
 * away" from „a later build added a key this layout has never seen" (issue #57 — the second
 * case must keep auto-appending as visible, or new sections never reach existing pages).
 */
export function markHidden(entries: LayoutEntry[], key: string): LayoutEntry[] {
  return entries.map((e) => (e.key === key ? { ...e, hidden: true } : e));
}

/** Drop the tombstone: `key` renders again at its remembered position and width. */
export function clearHidden(entries: LayoutEntry[], key: string): LayoutEntry[] {
  return entries.map((e) => {
    if (e.key !== key) return e;
    const { hidden, ...rest } = e;
    void hidden;
    return rest;
  });
}

/**
 * The array with an entry for `key`, appended at `width` when no stored entry carries it yet —
 * pass the key's spec default so a recreated entry matches what the arranger's own append paths
 * would have written (`defaultWidths`, WP-46/48).
 */
export function ensureEntry(
  entries: LayoutEntry[],
  key: string,
  width: 'full' | 'half' = 'full',
): LayoutEntry[] {
  return entries.some((e) => e.key === key) ? entries : [...entries, { key, width }];
}

/**
 * Do two layouts say the same thing — same keys, same order, same widths, same tombstones?
 * Compared field by field rather than by identity or `JSON.stringify`: both sides have been
 * through a store round trip (the entity column serialises, `parseEntityLayout` reads back), so
 * property order and an absent-vs-`undefined` `hidden` must not count as a difference.
 *
 * The removal undo asks it one question — has anything been arranged since the removal? — and
 * that decides whether the revert may hand a page's layout back to the template.
 */
export function sameLayout(a: LayoutEntry[], b: LayoutEntry[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((e, i) => {
    const o = b[i]!;
    return e.key === o.key && e.width === o.width && (e.hidden === true) === (o.hidden === true);
  });
}
