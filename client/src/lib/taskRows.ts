import type { Task } from '../api/types';

/**
 * One rendered row of the task table: a task, the depth it renders at, and whether it can be
 * folded. The table renders a *tree flattened into rows*, so a row is not the same thing as a
 * task — a task with a collapsed parent has no row at all.
 *
 * `id` is the task id as a string because it is used as the React key, and keeping it a string
 * keeps the keys byte-identical to the `getRowId: (t) => String(t.id)` this replaces.
 */
export interface TaskRow {
  id: string;
  original: Task;
  /** Nesting depth, 0 for a top-level row. A *render position*, not `parent_id` — see below. */
  depth: number;
  /** The task has children in this list, whether or not they are currently shown. */
  canExpand: boolean;
  isExpanded: boolean;
}

/**
 * Flatten the sorted task tree into the row list the table renders.
 *
 * Depth-first pre-order — a row, then its children, then the next sibling — because
 * `groupRows` chunks the result by depth and `TaskTable` renders one `<tbody>` per chunk. Any
 * other order silently reassigns subtasks to the wrong group.
 *
 * The three inputs are deliberately already-sorted: `top` and each list in `childrenOf` come out
 * of `sortTasks`, so **this function never reorders anything**. Ordering is `taskSort.ts`'s job
 * and stays there, where `activeSortRules` can make a rule for a hidden column inert (WP-32).
 *
 * `collapsed` is the inverse of what it renders: a parent is expanded unless the user has folded
 * it, so a freshly loaded table shows every subtask. That is why the state is a set of folded ids
 * rather than a set of open ones — an unknown parent is open, and no code has to seed it.
 *
 * Recursion is unbounded even though the API caps the tree at two levels: `migrateFlattenDeepSubtasks`
 * repairs imports, but a deeper tree that has not been through it still has to render rather than
 * silently lose rows (TTU-37). `seen` bounds the walk, so a cycle in imported data cannot hang the
 * render — the same guard, for the same reason, as `descendantsOf` in `taskTree.ts`.
 */
export function buildTaskRows(
  top: Task[],
  childrenOf: Map<number, Task[]>,
  collapsed: Set<number>,
): TaskRow[] {
  const rows: TaskRow[] = [];
  const seen = new Set<number>();

  const walk = (tasks: Task[], depth: number): void => {
    for (const task of tasks) {
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      const kids = childrenOf.get(task.id) ?? [];
      const canExpand = kids.length > 0;
      const isExpanded = canExpand && !collapsed.has(task.id);
      rows.push({ id: String(task.id), original: task, depth, canExpand, isExpanded });
      if (isExpanded) walk(kids, depth + 1);
    }
  };

  walk(top, 0);
  return rows;
}

/**
 * Chunk the flat row list into one array per top-level task, so a task and its subtasks can be
 * rendered as a single `<tbody>` and framed as a group. A depth-0 row opens a group; deeper rows
 * join the current one. Order is preserved exactly as `buildTaskRows` emitted it, so sorting and
 * expansion state are untouched.
 *
 * The `groups.length === 0` arm is not defensive tidying: an orphan — a subtask whose parent is
 * soft-deleted or archived — is promoted to depth 0 by `effectiveParent`, but a genuinely
 * malformed list can still open with a deeper row, and that row needs a group to live in.
 */
export function groupRows(rows: TaskRow[]): TaskRow[][] {
  const groups: TaskRow[][] = [];
  for (const row of rows) {
    if (row.depth === 0 || groups.length === 0) groups.push([row]);
    else groups[groups.length - 1]!.push(row);
  }
  return groups;
}
