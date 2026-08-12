import type { LayoutEntry } from '../api/types';

/**
 * The three pure moves on a stored layout array that section removal is built from
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

/** The array with an entry for `key`, appended `full` when no stored entry carries it yet. */
export function ensureEntry(entries: LayoutEntry[], key: string): LayoutEntry[] {
  return entries.some((e) => e.key === key) ? entries : [...entries, { key, width: 'full' }];
}
