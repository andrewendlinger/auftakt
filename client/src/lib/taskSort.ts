import type { ColumnOverrides, CustomColumn, TaskSortRule } from '../api/types';
import { colId, columnVisible, customColId } from './taskColumns';

/**
 * Rule id for the manual drag order. Excluded when deciding whether two rows are of equal rank
 * — including it would make every pair differ, so no row could ever be dropped on another.
 */
export const MANUAL_SORT_ID = 'manual';

/**
 * The builtin task columns that can drive automatic ordering. Single source of truth for both
 * the Settings hierarchy editor (uses id + label) and the task table's click-sortable header
 * set (uses id). Custom columns are click-sortable in the table but not offered in the hierarchy.
 *
 * The ids are the built-in column `key`s; `label` is only a fallback, because the name the user
 * sees comes from the `custom_columns` row (`describe` in TaskSortEditor — CCL-18).
 */
export const SORTABLE_TASK_COLUMNS: { id: string; label: string }[] = [
  { id: 'status', label: 'Status' },
  { id: 'priority', label: 'Priorität' },
  { id: 'due', label: 'Fällig' },
  { id: 'title', label: 'Titel' },
  { id: 'created', label: 'Erstellt am' },
  { id: 'updated', label: 'Zuletzt bearbeitet' },
  // Not a column — the hand-dragged row order (`tasks.sort_order`). It is the implicit last
  // tiebreaker even when absent from the hierarchy; listing it lets a user promote it, and at
  // position 1 the table becomes fully hand-ordered. Has no header, so it is never click-sorted.
  { id: MANUAL_SORT_ID, label: 'Manuelle Reihenfolge' },
];

/** Whether a rule is in effect, and if not, why the user cannot see it working. */
export type SortRuleState = 'active' | 'hidden' | 'gone';

/**
 * **A column you cannot see does not order the table.** A rule is in effect only while its column
 * is visible — hidden (by the season default `enabled: 0` or by this page's own override, WP-59)
 * or removed makes the rule inert.
 *
 * Every season written before WP-32 stores `[status, priority, due]` while both of those columns
 * are `enabled: 0` — the order followed two columns that render nowhere, which is the defect this
 * exists for. A fresh season ships `[status]` (`DEFAULT_TASK_SORT`) and needs no filtering at all;
 * the filter is what makes the two behave alike without rewriting anyone's setting.
 *
 * The rule is filtered, never rewritten: un-hiding the column wakes it up again, which is why
 * this replaces the migration that would have rewritten `task_sort` (see docs/DECISIONS.md).
 *
 * `manual` is exempt — it is the hand-dragged `sort_order`, not a column, so it has no row to be
 * hidden by. The **caller's column list defines the scope**: Settings resolves against the global
 * columns, a project table against global + project-scoped ones, so a project-scoped custom rule
 * reads as `'gone'` in Settings and `'active'` on that project's page. That is intended — each
 * asks about the table it is looking at.
 *
 * Since WP-59 the caller's `overrides` are the second half of that scope: „visible" is a property
 * of the *pair* (column, page), so the same rule can be active on one project and inert on the
 * next. Nothing about the rule changes — it is still filtered and never rewritten, so showing the
 * column on a page wakes it up there — but the question is now per page rather than per season,
 * which is why the caller passes what it renders (`columnVisible` is the single decider).
 */
export function sortRuleState(
  id: string,
  columns: CustomColumn[],
  overrides: ColumnOverrides = {},
): SortRuleState {
  if (id === MANUAL_SORT_ID) return 'active';
  // One lookup for both halves: `colId` yields the built-in key or `custom:<id>`, so an unknown
  // id — a deleted built-in, an imported rule for a column that never arrived — finds nothing.
  const col = columns.find((c) => colId(c) === id);
  if (!col) return 'gone';
  return columnVisible(col, overrides) ? 'active' : 'hidden';
}

/** The rules that actually order the table, in their configured order. Never mutates its input. */
export function activeSortRules(
  rules: TaskSortRule[],
  columns: CustomColumn[],
  overrides: ColumnOverrides = {},
): TaskSortRule[] {
  return rules.filter((r) => sortRuleState(r.id, columns, overrides) === 'active');
}

/**
 * What to call a sortable column, and whether its rule is doing anything.
 *
 * The `custom_columns` row is the single source of truth for the name (docs/ARCHITECTURE.md): the
 * ✎ in CustomColumnManager renames a built-in like any other column. Reading the hardcoded labels
 * instead meant the sort editor named a column the task table never did — out of the box the
 * `title` built-in ships as „Aufgabe" while this list says „Titel", and renaming „Fällig" to
 * „Deadline" updated the table header and left the rule reading „Fällig" (CCL-18, TTU-20).
 *
 * **An empty `columns` means „not loaded", not „all deleted".** `useGlobalColumns()` returns `[]`
 * while the query is in flight and permanently if it fails, and reporting `'gone'` for every rule
 * told the user their whole hierarchy had been removed — a claim that was false, alarming and
 * unactionable. With nothing to resolve against, say nothing.
 *
 * Its one caller is `TaskSortEditor`, which sits in Einstellungen and passes no overrides on
 * purpose: a `task_sort` rule is season-wide, so the state it reports is the state under the
 * **season default**. Since WP-59 a page may show a column the default hides, which is why
 * `'hidden'` is worded as „sorts only where the column is shown" rather than „sorts nothing".
 */
export function describeSortColumn(
  id: string,
  columns: CustomColumn[],
): { label: string; state: SortRuleState } {
  // A custom column's id is a wire format („custom:9"), never a name to show a user.
  const fallback =
    SORTABLE_TASK_COLUMNS.find((c) => c.id === id)?.label ??
    (customColId(id) !== null ? 'Gelöschte Spalte' : id);
  if (columns.length === 0) return { label: fallback, state: 'active' };
  const col = columns.find((c) => colId(c) === id);
  return { label: col?.name || fallback, state: sortRuleState(id, columns) };
}
