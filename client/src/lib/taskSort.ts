/**
 * The builtin task columns that can drive automatic ordering. Single source of truth for both
 * the Settings hierarchy editor (uses id + label) and the task table's click-sortable header
 * set (uses id). Custom columns are click-sortable in the table but not offered in the hierarchy.
 */
/**
 * Rule id for the manual drag order. Excluded when deciding whether two rows are of equal rank
 * — including it would make every pair differ, so no row could ever be dropped on another.
 */
export const MANUAL_SORT_ID = 'manual';

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
