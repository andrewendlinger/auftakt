import { describe, expect, it } from 'vitest';
import type { Task } from '../api/types';
import { buildTaskRows, groupRows, type TaskRow } from './taskRows';

/**
 * `buildTaskRows` is what the task table renders. It replaced TanStack Table's expanded row
 * model, and the whole point of bringing it in-house was that the flatten is the part of the
 * table that can actually be wrong and the part no gate could reach — the client has no
 * browser-level coverage (issue #7), so a wrong row order or a lost subtask used to be visible
 * only by eye.
 *
 * So the tests care about emission *order* (the `<tbody>` grouping is derived from it), about
 * `canExpand` staying true while a parent is folded (it is what draws the chevron that unfolds
 * it again), and about not hanging on malformed input, which is what the `seen` set is for.
 */

// Only the fields these functions read. The real Task has ~20 more that are irrelevant here, and
// spelling them out would make the fixtures unreadable without testing anything extra.
const task = (id: number): Task => ({ id, title: `t${id}` }) as unknown as Task;

/** `sortedChildren`'s shape: parent id → its already-sorted children. */
const children = (map: Record<number, number[]>): Map<number, Task[]> =>
  new Map(Object.entries(map).map(([pid, kids]) => [Number(pid), kids.map(task)]));

const shape = (rows: TaskRow[]) => rows.map((r) => `${r.original.id}@${r.depth}`);

describe('buildTaskRows', () => {
  it('emits depth-first pre-order: a parent, then its children, then the next sibling', () => {
    const rows = buildTaskRows([task(1), task(5)], children({ 1: [2, 3, 4] }), new Set());
    expect(shape(rows)).toEqual(['1@0', '2@1', '3@1', '4@1', '5@0']);
  });

  it('keeps the order it was given — it never sorts', () => {
    // sortTasks has already run; re-ordering here would silently override a sort rule.
    const rows = buildTaskRows([task(9), task(3), task(7)], children({}), new Set());
    expect(shape(rows)).toEqual(['9@0', '3@0', '7@0']);
  });

  it('emits a collapsed parent but none of its children', () => {
    const rows = buildTaskRows([task(1), task(5)], children({ 1: [2, 3] }), new Set([1]));
    expect(shape(rows)).toEqual(['1@0', '5@0']);
  });

  it('leaves canExpand true while a parent is collapsed, so the chevron survives', () => {
    // Without this the only control that could unfold the row would disappear on the click
    // that folded it.
    const [parent] = buildTaskRows([task(1)], children({ 1: [2] }), new Set([1]));
    expect(parent).toMatchObject({ canExpand: true, isExpanded: false });
  });

  it('marks a childless task as neither expandable nor expanded', () => {
    const [leaf] = buildTaskRows([task(1)], children({}), new Set());
    expect(leaf).toMatchObject({ canExpand: false, isExpanded: false });
  });

  it('expands by default — collapsed is the opt-out, not the opt-in', () => {
    const [parent] = buildTaskRows([task(1)], children({ 1: [2] }), new Set());
    expect(parent).toMatchObject({ canExpand: true, isExpanded: true });
  });

  it('renders a subtask that has subtasks of its own', () => {
    // The API caps the tree at two levels, but an import that has not been through
    // migrateFlattenDeepSubtasks can be deeper, and those rows must not vanish (TTU-37).
    const rows = buildTaskRows([task(1)], children({ 1: [2], 2: [3] }), new Set());
    expect(shape(rows)).toEqual(['1@0', '2@1', '3@2']);
    expect(rows[1]).toMatchObject({ canExpand: true, isExpanded: true });
  });

  it('folds a deep subtask without folding its parent', () => {
    const rows = buildTaskRows([task(1)], children({ 1: [2], 2: [3] }), new Set([2]));
    expect(shape(rows)).toEqual(['1@0', '2@1']);
  });

  it('renders an orphan flat, at depth 0', () => {
    // effectiveParent promotes a subtask whose parent is soft-deleted to top level, so it
    // arrives in `top`. It must render as an ordinary row — never be hidden for having a
    // parent_id that points at a row nobody can see (TTU-14).
    const rows = buildTaskRows([task(12), task(13)], children({}), new Set());
    expect(shape(rows)).toEqual(['12@0', '13@0']);
    expect(rows[0]).toMatchObject({ canExpand: false, depth: 0 });
  });

  it('keys rows by the task id as a string', () => {
    expect(buildTaskRows([task(42)], children({}), new Set())[0]!.id).toBe('42');
  });

  it('terminates on a cycle instead of hanging the render', () => {
    const rows = buildTaskRows([task(1)], children({ 1: [2], 2: [1] }), new Set());
    expect(shape(rows)).toEqual(['1@0', '2@1']);
  });

  it('emits nothing for an empty list', () => {
    expect(buildTaskRows([], children({}), new Set())).toEqual([]);
  });
});

describe('groupRows', () => {
  it('opens a group per depth-0 row and lets deeper rows join it', () => {
    const rows = buildTaskRows([task(1), task(5)], children({ 1: [2, 3] }), new Set());
    expect(groupRows(rows).map(shape)).toEqual([['1@0', '2@1', '3@1'], ['5@0']]);
  });

  it('preserves the emitted order', () => {
    const rows = buildTaskRows([task(9), task(3)], children({}), new Set());
    expect(groupRows(rows).map(shape)).toEqual([['9@0'], ['3@0']]);
  });

  it('gives a leading deeper row a group of its own rather than dropping it', () => {
    const stray: TaskRow = {
      id: '2',
      original: task(2),
      depth: 1,
      canExpand: false,
      isExpanded: false,
    };
    expect(groupRows([stray]).map(shape)).toEqual([['2@1']]);
  });

  it('returns nothing for no rows', () => {
    expect(groupRows([])).toEqual([]);
  });
});
