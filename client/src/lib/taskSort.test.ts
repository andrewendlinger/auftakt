import { describe, expect, it } from 'vitest';
import type { CustomColumn, TaskSortRule } from '../api/types';
import {
  MANUAL_SORT_ID,
  activeSortRules,
  colId,
  customColId,
  describeSortColumn,
  sortRuleState,
} from './taskSort';

/**
 * The rule these tests pin: **a column you cannot see does not order the table** (WP-32). It is
 * the reason a fresh season needs no `task_sort` migration — the shipped
 * `[status, priority, due]` behaves as `[status]` because Priorität and Fällig are `enabled: 0` —
 * so if `activeSortRules` ever stops dropping a hidden column, an invisible column silently
 * decides where a new task lands again, which is the complaint WP-32 came from.
 *
 * `colId`/`customColId` are here too because the id encoding is what TTU-31 broke and nothing
 * else covers it: the built-in `comment` key once decoded as custom column `Number('omment')`.
 */

// Only the fields the module reads; a real CustomColumn carries a dozen more.
const builtin = (key: string, enabled = 1): CustomColumn =>
  ({ id: 0, kind: 'builtin', key, name: '', enabled }) as unknown as CustomColumn;
const custom = (id: number, name = `Spalte ${id}`, enabled = 1): CustomColumn =>
  ({ id, kind: 'custom', key: null, name, enabled }) as unknown as CustomColumn;
const rule = (id: string, dir: 'asc' | 'desc' = 'asc'): TaskSortRule => ({ id, dir });

/** The factory column set: Priorität, Fällig and „Erstellt am" ship hidden (BUILTIN_COLUMNS). */
const FACTORY_COLUMNS: CustomColumn[] = [
  builtin('status'),
  builtin('title'),
  builtin('priority', 0),
  builtin('due', 0),
  builtin('comment'),
  builtin('updated'),
  builtin('created', 0),
];

describe('colId / customColId', () => {
  it('gives a built-in its own key', () => {
    expect(colId(builtin('comment'))).toBe('comment');
  });

  it('prefixes a custom column', () => {
    expect(colId(custom(5))).toBe('custom:5');
  });

  it('round-trips a custom id', () => {
    expect(customColId('custom:5')).toBe(5);
  });

  it('does not read a built-in key as a custom column (TTU-31)', () => {
    expect(customColId('comment')).toBeNull();
  });

  it('rejects a non-numeric suffix', () => {
    expect(customColId('custom:omment')).toBeNull();
  });
});

describe('sortRuleState', () => {
  it('is active for a visible column', () => {
    expect(sortRuleState('status', FACTORY_COLUMNS)).toBe('active');
  });

  it('is hidden for a disabled column', () => {
    expect(sortRuleState('priority', FACTORY_COLUMNS)).toBe('hidden');
  });

  it('is gone for a column that is not in the list at all', () => {
    expect(sortRuleState('due', [builtin('status')])).toBe('gone');
    expect(sortRuleState('erfunden', FACTORY_COLUMNS)).toBe('gone');
  });

  it('keeps the manual order active — it is not a column', () => {
    expect(sortRuleState(MANUAL_SORT_ID, [])).toBe('active');
  });

  it('resolves a custom column both ways', () => {
    expect(sortRuleState('custom:7', [custom(7)])).toBe('active');
    expect(sortRuleState('custom:7', [custom(7, 'Bezahlt', 0)])).toBe('hidden');
    expect(sortRuleState('custom:7', [custom(8)])).toBe('gone');
  });
});

describe('activeSortRules', () => {
  it('drops the two rules nobody can see (the WP-32 case)', () => {
    const shipped = [rule('status'), rule('priority'), rule('due')];
    expect(activeSortRules(shipped, FACTORY_COLUMNS)).toEqual([rule('status')]);
  });

  it('lets a rule wake up again when its column is shown', () => {
    const shown = FACTORY_COLUMNS.map((c) => (c.key === 'priority' ? builtin('priority') : c));
    const shipped = [rule('status'), rule('priority'), rule('due')];
    expect(activeSortRules(shipped, shown)).toEqual([rule('status'), rule('priority')]);
  });

  it('preserves order and direction', () => {
    const rules = [rule('updated', 'desc'), rule('status'), rule('title', 'desc')];
    expect(activeSortRules(rules, FACTORY_COLUMNS)).toEqual(rules);
  });

  it('keeps the manual rule in any position, with no columns at all', () => {
    expect(activeSortRules([rule(MANUAL_SORT_ID), rule('due')], [])).toEqual([
      rule(MANUAL_SORT_ID),
    ]);
  });

  it('drops an imported rule for a custom column that is hidden or absent', () => {
    const rules = [rule('custom:3'), rule('custom:9')];
    expect(activeSortRules(rules, [custom(3), custom(9, 'Weg', 0)])).toEqual([rule('custom:3')]);
    expect(activeSortRules(rules, [])).toEqual([]);
  });

  it('returns an empty list when every rule is inert, and does not mutate its input', () => {
    const rules = [rule('priority'), rule('due')];
    expect(activeSortRules(rules, FACTORY_COLUMNS)).toEqual([]);
    expect(rules).toHaveLength(2);
  });

  it('returns [] for []', () => {
    expect(activeSortRules([], FACTORY_COLUMNS)).toEqual([]);
  });
});

describe('describeSortColumn', () => {
  it('prefers the column row name over the hardcoded label (CCL-18)', () => {
    const renamed = [{ ...builtin('due'), name: 'Deadline' }];
    expect(describeSortColumn('due', renamed)).toEqual({ label: 'Deadline', state: 'active' });
  });

  // A *populated* list that lacks the column is the deletion; `[]` is „not loaded" (below).
  it('falls back to the built-in label when the column is gone', () => {
    expect(describeSortColumn('due', [builtin('status')])).toEqual({
      label: 'Fällig',
      state: 'gone',
    });
  });

  it('names a custom column, and reports it hidden', () => {
    expect(describeSortColumn('custom:4', [custom(4, 'Bezahlt', 0)])).toEqual({
      label: 'Bezahlt',
      state: 'hidden',
    });
  });

  it('names the manual order without a column', () => {
    expect(describeSortColumn(MANUAL_SORT_ID, [])).toEqual({
      label: 'Manuelle Reihenfolge',
      state: 'active',
    });
  });

  it('never shows a raw custom id as a column name', () => {
    expect(describeSortColumn('custom:9', [custom(1)])).toEqual({
      label: 'Gelöschte Spalte',
      state: 'gone',
    });
  });

  // `useGlobalColumns()` returns [] while the query is in flight and permanently if it fails.
  // Reporting 'gone' there told the user their whole hierarchy had been removed.
  it('says nothing when there is nothing to resolve against', () => {
    expect(describeSortColumn('status', [])).toEqual({ label: 'Status', state: 'active' });
    expect(describeSortColumn('priority', [])).toEqual({ label: 'Priorität', state: 'active' });
  });
});
