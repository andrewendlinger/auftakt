import { describe, expect, it } from 'vitest';
import type { LayoutEntry } from '../api/types';
import { clearHidden, ensureEntry, markHidden, sameLayout } from './layoutEntries';

/**
 * These three build section removal and its undo (`Arranger.removeBuiltin`). What matters is
 * the tombstone contract from issue #57: removal must keep the entry (position + width are the
 * re-add), and the undo arms run on `store.current()` seconds later, so each helper has to be
 * safe against the array having changed in between — a missing key must never throw, and no
 * helper may touch entries it was not asked about (a bystander's `hidden` flag is another
 * section's removal).
 */

const e = (key: string, width: 'full' | 'half' = 'full', hidden?: boolean): LayoutEntry => ({
  key,
  width,
  ...(hidden ? { hidden: true } : {}),
});

describe('markHidden', () => {
  it('flags only the named entry and keeps position and width', () => {
    const next = markHidden([e('a', 'half'), e('b'), e('c', 'half')], 'b');
    expect(next).toEqual([e('a', 'half'), { key: 'b', width: 'full', hidden: true }, e('c', 'half')]);
  });

  it('leaves an array without the key unchanged in content', () => {
    const entries = [e('a'), e('b')];
    expect(markHidden(entries, 'x')).toEqual(entries);
  });

  it('does not mutate its input', () => {
    const entries = [e('a')];
    markHidden(entries, 'a');
    expect(entries).toEqual([e('a')]);
  });
});

describe('clearHidden', () => {
  it('drops the flag and keeps position and width', () => {
    const next = clearHidden([e('a'), e('b', 'half', true), e('c')], 'b');
    expect(next).toEqual([e('a'), e('b', 'half'), e('c')]);
  });

  it('removes the property entirely rather than writing hidden: false', () => {
    // Stored layouts only ever carry `hidden: true`; parseLayoutEntries drops anything else,
    // and a literal `false` would survive JSON round trips as noise. toStrictEqual is the
    // point: it fails on a present-but-undefined `hidden` where toEqual would not.
    const next = clearHidden([e('a', 'full', true)], 'a');
    expect(next[0]).toStrictEqual({ key: 'a', width: 'full' });
  });

  it('leaves other tombstones alone', () => {
    const next = clearHidden([e('a', 'full', true), e('b', 'full', true)], 'b');
    expect(next).toEqual([e('a', 'full', true), e('b')]);
  });

  it('is a no-op in content when the key is absent', () => {
    const entries = [e('a')];
    expect(clearHidden(entries, 'x')).toEqual(entries);
  });
});

describe('ensureEntry', () => {
  it('appends a full-width entry when the key is not stored', () => {
    expect(ensureEntry([e('a')], 'b')).toEqual([e('a'), e('b')]);
  });

  it('appends at the given width — the spec default the redo arm threads through (WP-48)', () => {
    expect(ensureEntry([e('a')], 'b', 'half')).toEqual([e('a'), e('b', 'half')]);
  });

  it('returns the array unchanged when the key exists — even hidden', () => {
    // The redo arm calls ensureEntry before markHidden; an existing tombstone must not be
    // duplicated, or the layout carries the key twice and the first occurrence wins forever.
    const entries = [e('a', 'half', true)];
    expect(ensureEntry(entries, 'a')).toBe(entries);
  });

  it('composes with markHidden into a tombstone for a never-stored key', () => {
    // The redo path for a section the store never held (appended by a newer build): the
    // result must be a tombstone entry, so the picker can offer the section back.
    const next = markHidden(ensureEntry([e('a')], 'b'), 'b');
    expect(next).toEqual([e('a'), { key: 'b', width: 'full', hidden: true }]);
  });
});

/**
 * The gate on the revert arm's second path: on a page that was following the standard, the
 * removal is what gave it a layout of its own, and the undo hands that back — but only while
 * nothing has been arranged since. So a `true` here has to survive a store round trip, and a
 * `false` has to catch every edit the arranger can make (order, width, another section's
 * removal), or the undo either freezes the standard onto the page or throws the user's own
 * arrangement away.
 */
describe('sameLayout', () => {
  it('ignores property order and an absent-vs-undefined hidden', () => {
    // Both sides come back through a store: the entity column is JSON text, and
    // parseEntityLayout rebuilds the objects key by key.
    const a: LayoutEntry[] = [{ width: 'half', key: 'a' }, { key: 'b', width: 'full', hidden: undefined }];
    expect(sameLayout(a, [e('a', 'half'), e('b')])).toBe(true);
  });

  it('is false on a reorder', () => {
    expect(sameLayout([e('a'), e('b')], [e('b'), e('a')])).toBe(false);
  });

  it('is false on a width change', () => {
    expect(sameLayout([e('a')], [e('a', 'half')])).toBe(false);
  });

  it('is false when another section was removed in between', () => {
    expect(sameLayout([e('a'), e('b')], [e('a'), e('b', 'full', true)])).toBe(false);
  });

  it('is false on a length change either way', () => {
    expect(sameLayout([e('a')], [e('a'), e('b')])).toBe(false);
    expect(sameLayout([e('a'), e('b')], [e('a')])).toBe(false);
  });

  it('matches what the removal wrote against what the revert reads back', () => {
    // The revert's own comparison: the array the page showed, tombstoned, against the store.
    const before = [e('a'), e('b', 'half'), e('c')];
    expect(sameLayout(markHidden(before, 'b'), markHidden(before, 'b'))).toBe(true);
    expect(sameLayout(markHidden(before, 'b'), markHidden(before, 'c'))).toBe(false);
  });
});
