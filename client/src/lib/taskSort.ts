/**
 * The builtin task columns that can drive automatic ordering. Single source of truth for both
 * the Settings hierarchy editor (uses id + label) and the task table's click-sortable header
 * set (uses id). Custom columns are click-sortable in the table but not offered in the hierarchy.
 */
export const SORTABLE_TASK_COLUMNS: { id: string; label: string }[] = [
  { id: 'status', label: 'Status' },
  { id: 'priority', label: 'Priorität' },
  { id: 'due', label: 'Fällig' },
  { id: 'title', label: 'Titel' },
  { id: 'created', label: 'Erstellt am' },
  { id: 'updated', label: 'Zuletzt bearbeitet' },
];
