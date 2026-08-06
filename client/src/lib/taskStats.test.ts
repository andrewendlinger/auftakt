import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../api/types';
import { attentionTasks, computeStats, duePhrase, isDueSoon, isOverdue } from './taskStats';

/**
 * These numbers are what a user reads on the dashboard tiles and the project cards, so a wrong
 * one is not a rendering glitch — it is the app lying about how much work is left.
 *
 * Everything here pins the clock. `daysUntil` and `todayUtcMs` read the real one, so without a
 * fixed date these tests would pass today and fail on a date boundary for reasons unrelated to
 * the code. That is the same trap `docs/DECISIONS.md` records for the e2e suite against the demo
 * fixtures; it applies here too.
 */

const TODAY = '2026-08-06';
const DONE = 'Erledigt';

const task = (due: string | null, status = 'Offen'): Task =>
  ({ id: Math.random(), title: 'x', status, due_date: due }) as unknown as Task;

/** Local noon, so the pinned instant is the same calendar day in every timezone the CI runs in. */
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 6, 12, 0, 0));
});
afterEach(() => vi.useRealTimers());

describe('isOverdue / isDueSoon', () => {
  it('treats a done task as neither, whatever its due date', () => {
    const longPast = task('2020-01-01', DONE);
    expect(isOverdue(longPast, DONE)).toBe(false);
    expect(isDueSoon(longPast, DONE, 7)).toBe(false);
  });

  it('treats a task with no due date as neither', () => {
    expect(isOverdue(task(null), DONE)).toBe(false);
    expect(isDueSoon(task(null), DONE, 7)).toBe(false);
  });

  it('counts yesterday as overdue and today as not', () => {
    expect(isOverdue(task('2026-08-05'), DONE)).toBe(true);
    expect(isOverdue(task(TODAY), DONE)).toBe(false);
  });

  // The window is inclusive at both ends; off-by-one here moves a task between two tiles.
  it('includes today and the last day of the window, excludes the day after', () => {
    expect(isDueSoon(task(TODAY), DONE, 7)).toBe(true);
    expect(isDueSoon(task('2026-08-13'), DONE, 7)).toBe(true);
    expect(isDueSoon(task('2026-08-14'), DONE, 7)).toBe(false);
  });

  it('does not count an overdue task as due-soon', () => {
    expect(isDueSoon(task('2026-08-05'), DONE, 7)).toBe(false);
  });
});

describe('computeStats', () => {
  it('splits overdue and due-soon into distinct buckets', () => {
    const s = computeStats(
      [task('2026-08-01'), task('2026-08-07'), task('2026-12-01'), task(TODAY, DONE)],
      DONE,
      7,
    );
    expect(s).toMatchObject({ offen: 3, ueberfaellig: 1, baldfaellig: 1, done: 1, total: 4 });
  });

  it('counts an overdue task once — as overdue, never also as due-soon', () => {
    const s = computeStats([task('2026-07-01')], DONE, 7);
    expect(s.ueberfaellig).toBe(1);
    expect(s.baldfaellig).toBe(0);
  });

  it('reports 0 % rather than NaN for an empty list', () => {
    expect(computeStats([], DONE, 7)).toMatchObject({ pct: 0, total: 0 });
  });

  it('reports 100 % when every task is done', () => {
    expect(computeStats([task(null, DONE), task(null, DONE)], DONE, 7).pct).toBe(100);
  });

  it('rounds the percentage', () => {
    expect(computeStats([task(null, DONE), task(null), task(null)], DONE, 7).pct).toBe(33);
  });

  // „Done" is the editable Status option flagged `done`, never a hardcoded string — renaming it in
  // Settings must not reset every project card to 0 %.
  it('takes the done value as a parameter rather than assuming one', () => {
    const s = computeStats([task(null, 'Fertig'), task(null, 'Offen')], 'Fertig', 7);
    expect(s).toMatchObject({ done: 1, offen: 1, pct: 50 });
  });

  it('counts a status that matches nothing as open', () => {
    expect(computeStats([task(null, 'Wartet')], DONE, 7)).toMatchObject({ offen: 1, done: 0 });
  });
});

describe('attentionTasks', () => {
  it('keeps overdue and due-soon, sorted most-overdue first then soonest', () => {
    const soon = task('2026-08-08');
    const veryLate = task('2026-07-01');
    const late = task('2026-08-04');
    const far = task('2027-01-01');
    expect(attentionTasks([soon, far, veryLate, late], DONE, 7)).toEqual([veryLate, late, soon]);
  });

  it('drops done tasks even when overdue', () => {
    expect(attentionTasks([task('2020-01-01', DONE)], DONE, 7)).toEqual([]);
  });

  it('drops tasks with no due date', () => {
    expect(attentionTasks([task(null)], DONE, 7)).toEqual([]);
  });

  it('drops tasks beyond the window', () => {
    expect(attentionTasks([task('2026-08-14')], DONE, 7)).toEqual([]);
  });

  // CCL-31. The comparator used to call `daysUntil` per comparison, each building its own „today".
  // A midnight rollover mid-sort made it inconsistent and the sort no longer a total order. One
  // clock for the whole pass fixes it; equal-dated tasks must at least stay stable and complete.
  it('is a total order — equal due dates neither drop nor duplicate rows (CCL-31)', () => {
    const rows = [task('2026-08-07'), task('2026-08-07'), task('2026-08-07')];
    const out = attentionTasks(rows, DONE, 7);
    expect(out).toHaveLength(3);
    expect(new Set(out).size).toBe(3);
  });

  it('is indifferent to scope — an archived done task is excluded either way', () => {
    const live = [task('2026-08-07'), task('2026-08-01')];
    const all = [...live, task('2020-01-01', DONE)];
    expect(attentionTasks(all, DONE, 7)).toEqual(attentionTasks(live, DONE, 7));
  });
});

describe('duePhrase', () => {
  it('names the German cases around today', () => {
    expect(duePhrase('2026-08-05')).toBe('überfällig 1 Tag');
    expect(duePhrase('2026-08-04')).toBe('überfällig 2 Tage');
    expect(duePhrase(TODAY)).toBe('heute fällig');
    expect(duePhrase('2026-08-07')).toBe('fällig morgen');
    expect(duePhrase('2026-08-09')).toBe('fällig in 3 Tagen');
  });

  it('returns empty for a missing or unparseable date', () => {
    expect(duePhrase(null)).toBe('');
    expect(duePhrase(undefined)).toBe('');
    expect(duePhrase('irgendwann')).toBe('');
  });
});
