import { describe, expect, it } from 'vitest';
import { arrayMove, arrayMoveTo } from './arrays';

/**
 * Both functions promise the same thing to their callers: a refused move returns the *original
 * array*, reference-equal, so `next !== list` is a reliable "did anything happen". Every drag
 * call site skips its network request on that check, so a violation is not a wrong order — it is
 * a request that renumbers the list to what it already was, or a silent no-op that looks saved.
 * The identity assertions below matter as much as the ordering ones.
 */

describe('arrayMove', () => {
  const list = ['a', 'b', 'c'];

  it('swaps with the neighbour in the given direction', () => {
    expect(arrayMove(list, 0, 1)).toEqual(['b', 'a', 'c']);
    expect(arrayMove(list, 2, -1)).toEqual(['a', 'c', 'b']);
  });

  it('does not mutate the input', () => {
    arrayMove(list, 0, 1);
    expect(list).toEqual(['a', 'b', 'c']);
  });

  it('returns the original array when the destination is out of bounds', () => {
    expect(arrayMove(list, 0, -1)).toBe(list);
    expect(arrayMove(list, 2, 1)).toBe(list);
  });

  // CCL-32. A destination-only guard let `i === list.length` through: `j` was in bounds, so the
  // swap wrote index `length`, grew the array by one and left a hole at `length - 1`. The caller's
  // `next !== list` check then reported that corruption as a successful move.
  it('rejects an out-of-bounds source, not just an out-of-bounds destination (CCL-32)', () => {
    expect(arrayMove(list, list.length, -1)).toBe(list);
    expect(arrayMove(list, -1, 1)).toBe(list);
  });

  it('never grows or shrinks the list', () => {
    for (const i of [-1, 0, 1, 2, 3, 4]) {
      for (const dir of [-1, 1] as const) {
        expect(arrayMove(list, i, dir)).toHaveLength(list.length);
      }
    }
  });

  it('is a no-op on an empty list', () => {
    const empty: string[] = [];
    expect(arrayMove(empty, 0, 1)).toBe(empty);
  });
});

describe('arrayMoveTo', () => {
  const list = ['a', 'b', 'c', 'd'];

  // The drag semantic, and the reason this is not `arrayMove`: dropping onto a distant row moves
  // only the dragged item and shifts what it passes. A swap would displace an unrelated row.
  it('lifts the item out and re-inserts it, shifting everything between', () => {
    expect(arrayMoveTo(list, 0, 3)).toEqual(['b', 'c', 'd', 'a']);
    expect(arrayMoveTo(list, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(arrayMoveTo(list, 1, 2)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('does not mutate the input', () => {
    arrayMoveTo(list, 0, 3);
    expect(list).toEqual(['a', 'b', 'c', 'd']);
  });

  // `useListReorder` derives both indices from `findIndex`, which returns -1 for a row that was
  // purged or belongs to a season swapped mid-drag. That must not renumber the list.
  it('returns the original array for a -1 index from a failed findIndex', () => {
    expect(arrayMoveTo(list, -1, 2)).toBe(list);
    expect(arrayMoveTo(list, 2, -1)).toBe(list);
  });

  it('returns the original array when from === to', () => {
    expect(arrayMoveTo(list, 2, 2)).toBe(list);
  });

  it('returns the original array for out-of-range indices', () => {
    expect(arrayMoveTo(list, 0, list.length)).toBe(list);
    expect(arrayMoveTo(list, list.length, 0)).toBe(list);
  });

  it('preserves every element — a move reorders, it never drops or duplicates', () => {
    for (let from = 0; from < list.length; from++) {
      for (let to = 0; to < list.length; to++) {
        expect([...arrayMoveTo(list, from, to)].sort()).toEqual([...list].sort());
      }
    }
  });
});
