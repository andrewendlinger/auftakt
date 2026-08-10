import type { CustomColumn, TaskSortRule } from '../api/types';

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

/**
 * Stable column id: built-ins use their `key`, custom columns `custom:<id>`.
 *
 * The delimiter is the point. With customs encoded as `c<id>` the two namespaces overlapped —
 * `BUILTIN_COLUMNS` holds `comment` and `created` — so the built-in Kommentar key decoded as
 * "custom column number `omment`": `Number('omment')` is NaN, `customValueOf` returns '', and
 * that level of the sort hierarchy silently compared every task equal. Only `comment`'s absence
 * from SORTABLE_TASK_COLUMNS kept it unreachable, and a hand-edited or imported `task_sort` does
 * not respect that list (TTU-31). `:` cannot appear in a built-in key.
 */
const CUSTOM_PREFIX = 'custom:';

export function colId(col: CustomColumn): string {
  return col.kind === 'builtin' && col.key ? col.key : `${CUSTOM_PREFIX}${col.id}`;
}

/** The inverse of `colId` — the custom column's id, or null for a built-in key. */
export function customColId(id: string): number | null {
  if (!id.startsWith(CUSTOM_PREFIX)) return null;
  const n = Number(id.slice(CUSTOM_PREFIX.length));
  return Number.isInteger(n) ? n : null;
}

/** Whether a rule is in effect, and if not, why the user cannot see it working. */
export type SortRuleState = 'active' | 'hidden' | 'gone';

/**
 * **A column you cannot see does not order the table.** A rule is in effect only while its column
 * is visible; hiding the column (`enabled: 0`) or removing it makes the rule inert.
 *
 * Ab Werk ist genau das der Fall: `DEFAULT_TASK_SORT` nennt Priorität und Fällig, beide Spalten
 * sind `enabled: 0` — die Reihenfolge folgte also zwei Spalten, die nirgends stehen (WP-32).
 *
 * The rule is filtered, never rewritten: un-hiding the column wakes it up again, which is why
 * this replaces the migration that would have rewritten `task_sort` (see docs/DECISIONS.md).
 *
 * `manual` is exempt — it is the hand-dragged `sort_order`, not a column, so it has no row to be
 * hidden by. The **caller's column list defines the scope**: Settings resolves against the global
 * columns, a project table against global + project-scoped ones, so a project-scoped custom rule
 * reads as `'gone'` in Settings and `'active'` on that project's page. That is intended — each
 * asks about the table it is looking at.
 */
export function sortRuleState(id: string, columns: CustomColumn[]): SortRuleState {
  if (id === MANUAL_SORT_ID) return 'active';
  // One lookup for both halves: `colId` yields the built-in key or `custom:<id>`, so an unknown
  // id — a deleted built-in, an imported rule for a column that never arrived — finds nothing.
  const col = columns.find((c) => colId(c) === id);
  if (!col) return 'gone';
  return col.enabled === 0 ? 'hidden' : 'active';
}

/** The rules that actually order the table, in their configured order. Never mutates its input. */
export function activeSortRules(rules: TaskSortRule[], columns: CustomColumn[]): TaskSortRule[] {
  return rules.filter((r) => sortRuleState(r.id, columns) === 'active');
}

/**
 * What to call a sortable column, and whether its rule is doing anything.
 *
 * The `custom_columns` row is the single source of truth for the name (docs/ARCHITECTURE.md): the
 * ✎ in CustomColumnManager renames a built-in like any other column. Reading the hardcoded labels
 * instead meant the sort editor named a column the task table never did — out of the box the
 * `title` built-in ships as „Aufgabe" while this list says „Titel", and renaming „Fällig" to
 * „Deadline" updated the table header and left the rule reading „Fällig" (CCL-18, TTU-20).
 */
export function describeSortColumn(
  id: string,
  columns: CustomColumn[],
): { label: string; state: SortRuleState } {
  const fallback = SORTABLE_TASK_COLUMNS.find((c) => c.id === id)?.label ?? id;
  const col = columns.find((c) => colId(c) === id);
  return { label: col?.name || fallback, state: sortRuleState(id, columns) };
}
