/**
 * Task insight metrics — the counts that drive the artist-page project cards, the dashboard
 * KPI tiles and the „Braucht Aufmerksamkeit" list. All derived client-side from task arrays the
 * pages already fetch (no dedicated endpoint), so the numbers stay consistent with the „X offen"
 * badge by construction. „Done" is always the editable Status option flagged `done`
 * (`doneValueOf`), never a hardcoded string.
 */
import type { Task } from '../api/types';
import { daysUntil, todayUtcMs } from './dates';

export type TaskMetric = 'offen' | 'ueberfaellig' | 'baldfaellig' | 'fortschritt';

/** Registry backing both the Settings checkboxes and every render site. */
export const ALL_METRICS: { key: TaskMetric; label: string }[] = [
  { key: 'offen', label: 'Offen' },
  { key: 'ueberfaellig', label: 'Überfällig' },
  { key: 'baldfaellig', label: 'Bald fällig' },
  { key: 'fortschritt', label: 'Fortschritt' },
];

export const DEFAULT_METRICS: TaskMetric[] = ['offen', 'ueberfaellig', 'fortschritt'];
export const DEFAULT_ATTENTION_DAYS = 7;

export function isOpen(t: Task, doneValue: string): boolean {
  return t.status !== doneValue;
}

/** Open, has a due date, and that date is in the past. */
export function isOverdue(t: Task, doneValue: string): boolean {
  if (!isOpen(t, doneValue) || !t.due_date) return false;
  const d = daysUntil(t.due_date);
  return d != null && d < 0;
}

/** Open, has a due date, and it falls within the next `windowDays` (today included). */
export function isDueSoon(t: Task, doneValue: string, windowDays: number): boolean {
  if (!isOpen(t, doneValue) || !t.due_date) return false;
  const d = daysUntil(t.due_date);
  return d != null && d >= 0 && d <= windowDays;
}

export interface TaskStats {
  offen: number;
  ueberfaellig: number;
  /** Due within the window and not already overdue — a distinct bucket from `ueberfaellig`. */
  baldfaellig: number;
  done: number;
  total: number;
  /** done / total as a whole percentage (0 when there are no tasks). */
  pct: number;
}

export function computeStats(tasks: Task[], doneValue: string, windowDays: number): TaskStats {
  let offen = 0;
  let ueberfaellig = 0;
  let baldfaellig = 0;
  let done = 0;
  for (const t of tasks) {
    if (t.status === doneValue) {
      done++;
      continue;
    }
    offen++;
    if (isOverdue(t, doneValue)) ueberfaellig++;
    else if (isDueSoon(t, doneValue, windowDays)) baldfaellig++;
  }
  const total = tasks.length;
  return { offen, ueberfaellig, baldfaellig, done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

/**
 * Overdue ∪ due-soon, sorted most-overdue first then soonest due (both always have a due date).
 *
 * Decorate-sort-undecorate rather than the obvious filter+sort, because `daysUntil` is a regex
 * parse plus a `Date` allocation and the comparator ran it twice per comparison on top of two per
 * task in the filter — several thousand of both for one render of a 300-task list, repeated on
 * every parent re-render. Worse, each comparator call built its own „today", so a midnight
 * rollover mid-sort left the comparator inconsistent and the sort no longer a total order
 * (CCL-31). One `todayUtcMs()` for the whole pass fixes both.
 *
 * It does not go through `isOverdue`/`isDueSoon` for the same reason — they take no „today" and
 * would put the per-call clock back. Their union is simply `d <= windowDays`.
 */
export function attentionTasks(tasks: Task[], doneValue: string, windowDays: number): Task[] {
  const today = todayUtcMs();
  const rows: Array<{ task: Task; days: number }> = [];
  for (const t of tasks) {
    if (!isOpen(t, doneValue) || !t.due_date) continue;
    const days = daysUntil(t.due_date, today);
    if (days == null || days > windowDays) continue;
    rows.push({ task: t, days });
  }
  rows.sort((a, b) => a.days - b.days);
  return rows.map((r) => r.task);
}

/** German due phrase for a task row: „überfällig 2 Tage" / „heute fällig" / „fällig morgen" / „fällig in 3 Tagen". */
export function duePhrase(iso: string | null | undefined): string {
  const d = daysUntil(iso);
  if (d == null) return '';
  if (d < 0) return `überfällig ${-d} ${-d === 1 ? 'Tag' : 'Tage'}`;
  if (d === 0) return 'heute fällig';
  if (d === 1) return 'fällig morgen';
  return `fällig in ${d} Tagen`;
}
