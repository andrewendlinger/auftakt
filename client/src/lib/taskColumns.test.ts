import { describe, expect, it } from 'vitest';
import type { CustomColumn } from '../api/types';
import {
  columnVisible,
  parseColumnOverrides,
  visibleColumns,
  withColumnVisible,
} from './taskColumns';

/**
 * The rule these tests pin: **a page's stored map is sparse, and an override that agrees with the
 * season default is not stored at all** (WP-59). Both halves are invisible when they break.
 *
 * A non-sparse map would freeze a page's column set: a column added in Einstellungen afterwards
 * would never reach any page that had ever been configured. And an override kept after it stopped
 * differing would leave `task_columns` non-NULL on a page that looks untouched — which then
 * silently stops following the season default, the same trap `useEntityLayout`'s removal undo
 * answers with `resetToDefault()`.
 */

// Only the fields the module reads; a real CustomColumn carries a dozen more.
const builtin = (key: string, enabled = 1): CustomColumn =>
  ({ id: 0, kind: 'builtin', key, name: key, scope: 'global', enabled, sort_order: 0 }) as unknown as CustomColumn;
const custom = (id: number, enabled = 1, scope = 'global', sort_order = 0): CustomColumn =>
  ({ id, kind: 'custom', key: null, name: `Spalte ${id}`, scope, enabled, sort_order }) as unknown as CustomColumn;

describe('columnVisible', () => {
  it('follows the season default when the page says nothing', () => {
    expect(columnVisible(builtin('due', 0))).toBe(false);
    expect(columnVisible(builtin('status'), {})).toBe(true);
  });

  it('lets a page show what the season hides, and hide what it shows', () => {
    expect(columnVisible(builtin('due', 0), { due: true })).toBe(true);
    expect(columnVisible(builtin('comment'), { comment: false })).toBe(false);
  });

  it('keys a custom column by its wire id', () => {
    expect(columnVisible(custom(7, 0), { 'custom:7': true })).toBe(true);
    expect(columnVisible(custom(7, 0), { '7': true })).toBe(false);
  });
});

describe('visibleColumns', () => {
  it('filters and orders in one go, globals before the page’s own (TTU-21)', () => {
    const cols = [custom(2, 1, 'project', 0), custom(1, 1, 'global', 5), custom(3, 0, 'global', 1)];
    expect(visibleColumns(cols).map((c) => c.id)).toEqual([1, 2]);
  });

  it('never mutates its input', () => {
    const cols = [custom(2, 1, 'project'), custom(1)];
    visibleColumns(cols);
    expect(cols.map((c) => c.id)).toEqual([2, 1]);
  });
});

describe('parseColumnOverrides', () => {
  it('reads a stored map', () => {
    expect(parseColumnOverrides('{"due":true,"comment":false}')).toEqual({ due: true, comment: false });
  });

  it('reads null, junk and the wrong shape as “no override”', () => {
    for (const raw of [null, undefined, '', 'nonsense', '[]', '"due"', '3', '{}']) {
      expect(parseColumnOverrides(raw)).toEqual({});
    }
  });

  it('drops entries that are not booleans, keeping the rest', () => {
    expect(parseColumnOverrides('{"due":1,"comment":false,"":true}')).toEqual({ comment: false });
  });
});

describe('withColumnVisible', () => {
  it('stores only a departure from the season default', () => {
    expect(withColumnVisible({}, builtin('due', 0), true)).toEqual({ due: true });
    expect(withColumnVisible({}, builtin('due', 0), false)).toBeNull();
  });

  it('prunes back to NULL when the last override agrees again', () => {
    expect(withColumnVisible({ due: true }, builtin('due', 0), false)).toBeNull();
  });

  it('keeps the other entries when one is pruned', () => {
    expect(withColumnVisible({ due: true, comment: false }, builtin('due', 0), false)).toEqual({
      comment: false,
    });
  });

  it('does not mutate the map it was given', () => {
    const before = { due: true };
    withColumnVisible(before, builtin('comment'), false);
    expect(before).toEqual({ due: true });
  });
});
