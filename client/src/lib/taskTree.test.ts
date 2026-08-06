import { describe, expect, it } from 'vitest';
import type { Task } from '../api/types';
import { descendantsOf } from './taskTree';

/**
 * `descendantsOf` decides what "+ N Unteraufgaben löschen" acts on. Undercounting here is not a
 * cosmetic bug: TTU-05 stranded an archived child under a soft-deleted parent — a row that stayed
 * in „Archiv" for ever, that no delete affordance could reach, and that `purgeExpired()` never
 * touched because it was never soft-deleted. So the tests care about completeness and about not
 * hanging on malformed input, which is what the `seen` set is for.
 */

// Only the three fields the function reads. The real Task has ~20 more that are irrelevant here,
// and spelling them out would make the fixtures unreadable without testing anything extra.
const task = (id: number, parent_id: number | null = null): Task =>
  ({ id, parent_id, title: `t${id}` }) as unknown as Task;

describe('descendantsOf', () => {
  it('returns every descendant, not just direct children', () => {
    const tasks = [task(1), task(2, 1), task(3, 2), task(4, 3)];
    expect(descendantsOf(tasks, 1).map((t) => t.id)).toEqual([2, 3, 4]);
  });

  it('walks breadth-first', () => {
    //   1
    //   ├── 2 ── 4
    //   └── 3 ── 5
    const tasks = [task(1), task(2, 1), task(3, 1), task(4, 2), task(5, 3)];
    expect(descendantsOf(tasks, 1).map((t) => t.id)).toEqual([2, 3, 4, 5]);
  });

  it('excludes the root itself', () => {
    const tasks = [task(1), task(2, 1)];
    expect(descendantsOf(tasks, 1).map((t) => t.id)).not.toContain(1);
  });

  it('returns nothing for a leaf', () => {
    expect(descendantsOf([task(1), task(2, 1)], 2)).toEqual([]);
  });

  it('returns nothing for an id that is not in the list', () => {
    expect(descendantsOf([task(1), task(2, 1)], 99)).toEqual([]);
  });

  it('ignores unrelated branches', () => {
    const tasks = [task(1), task(2, 1), task(10), task(11, 10)];
    expect(descendantsOf(tasks, 1).map((t) => t.id)).toEqual([2]);
  });

  it('ignores top-level tasks', () => {
    const tasks = [task(1), task(2), task(3)];
    expect(descendantsOf(tasks, 1)).toEqual([]);
  });

  // The `seen` set exists for imported data, where nothing guarantees the parent chain is acyclic.
  // Without it these hang the render — an infinite queue in a synchronous loop, so the tab locks
  // rather than showing an error.
  it('terminates on a cycle rather than hanging the render', () => {
    const tasks = [task(1, 3), task(2, 1), task(3, 2)];
    expect(descendantsOf(tasks, 1).map((t) => t.id)).toEqual([2, 3]);
  });

  it('terminates on a self-parented task', () => {
    const tasks = [task(1, 1), task(2, 1)];
    expect(descendantsOf(tasks, 1).map((t) => t.id)).toEqual([2]);
  });

  it('visits each node once when a cycle points back at the root', () => {
    const tasks = [task(1), task(2, 1), task(3, 2), task(4, 3)];
    // 4's child is 2, which is already seen — the walk must not restart the 2→3→4 branch.
    tasks.push(task(2, 4));
    const ids = descendantsOf(tasks, 1).map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('handles an empty task list', () => {
    expect(descendantsOf([], 1)).toEqual([]);
  });
});
