import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from 'react';
import { api } from '../api/client';
import type { CustomColumn, CustomColumnOption, Task, TaskSortRule, TaskUpdate } from '../api/types';
import { compareColumns, customValueOf, doneValueOf, parseColumnOptions } from '../api/types';
import { formatDate } from '../lib/dates';
import { withAlpha } from '../lib/colors';
import {
  MANUAL_SORT_ID,
  SORTABLE_TASK_COLUMNS,
  activeSortRules,
  colId,
  sortRuleState,
  customColId,
} from '../lib/taskSort';
import { arrayMoveTo } from '../lib/arrays';
import { useDragReorder } from '../lib/dragReorder';
import { descendantsOf } from '../lib/taskTree';
import { buildTaskRows, groupRows, type TaskRow } from '../lib/taskRows';
import { Markdown } from './Markdown';
import { RichTextEditor } from './RichTextEditor';
import { ColorSwatchPicker } from './ColorSwatchPicker';
import { CHILD_BAND, TREE, TreeGutterCell, spineColorFor } from './TaskTreeGutter';
import { MoveIcon, TrashIcon } from './icons';
import { MoveTaskDialog } from './MoveTaskDialog';
import { PillSelect } from './PillSelect';
import { InlineInput } from './InlineInput';
import { EmptyState, Btn, DragHandle, IconButton } from './ui';
import { Modal, onEnterKey } from './fields';
import {
  useAllTasks,
  useCommitOnUnmount,
  useGuardedAction,
  useInvalidateAll,
  useSaison,
  useTaskSortRules,
  useUndoableDelete,
  useUndoablePatch,
  resourceUndo,
} from '../hooks';

/** Shared modern inline-edit input style (soft border, focus ring). */
const INLINE_INPUT =
  'rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-800 outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-900/5';

export interface TaskTableParent {
  artist_id?: number;
  project_id?: number;
  /** Season-wide todos: created with neither artist nor project, chipped with the season name. */
  general?: boolean;
}

/** null = follow the configured automatic hierarchy; a rule = a temporary header-click override. */
type SortState = TaskSortRule | null;

/** What every cell component is handed. The column arrives as its id; the rest comes from context. */
interface TaskCellProps {
  row: TaskRow;
  columnId: string;
}

/**
 * One rendered column. `header` is a plain string and `cell` a component *type*, which is the
 * whole column model this table needs — no accessors, because a cell derives its own value from
 * `row.original` and the `CustomColumn` it resolves by id.
 */
interface TaskColumn {
  id: string;
  header: string;
  cell: ComponentType<TaskCellProps>;
}

/**
 * Everything a cell needs from its table, handed down as context rather than captured in the
 * `columns` memo.
 *
 * The memo is the whole point. Each column's `cell` is rendered as a component in its own right
 * (`<Cell … />`), so if `cell` is an inline arrow, every rebuild of `columns` hands React a *new
 * component type* and React answers by unmounting and remounting every cell subtree in the
 * table. With the per-render values (callbacks, option lists, the children map) in the dep list,
 * that rebuild happened on every single render: measured on the demo season, one
 * „＋ Unteraufgabe" click — which changes no data — remounted all 60 data cells, and a
 * background refetch tore down an open Titel editor together with the text being typed into it,
 * since removing a focused node fires no blur and nothing commits it (TTU-12, TTU-38).
 *
 * So the cells are stable module-level components and read the moving parts from here. The value
 * is deliberately *not* memoised: a re-render of a mounted cell is cheap and correct, a remount
 * is neither.
 */
interface TaskTableApi {
  /** `colId(col)` → the column, so a stable cell component can resolve its own column. */
  colById: Map<string, CustomColumn>;
  doneValue: string;
  statusOptions: CustomColumnOption[];
  priorityOptions: CustomColumnOption[];
  childrenByParent: Map<number, Task[]>;
  /** Returns its promise so an `InlineInput` cell can report a rejected write (RTE-01). */
  commit: (task: Task, patch: Partial<Task>, label: string) => Promise<void>;
  commitCustom: (task: Task, colId: number, value: unknown) => Promise<void>;
  requestDelete: (task: Task) => void;
  toggleExpand: (id: number) => void;
  /** Expand the row and open its inline subtask composer. */
  startSubtask: (id: number) => void;
  startMove: (task: Task) => void;
}

const TaskTableCtx = createContext<TaskTableApi | null>(null);

function useTaskTableApi(): TaskTableApi {
  const api = useContext(TaskTableCtx);
  if (!api) throw new Error('TaskTable cell rendered outside TaskTableCtx');
  return api;
}

function findBuiltin(cols: CustomColumn[], key: string): CustomColumn | undefined {
  return cols.find((c) => c.kind === 'builtin' && c.key === key);
}

/** Map each option value to its position (rank) in the ordered options array. */
function rankMap(options: CustomColumnOption[]): Map<string, number> {
  return new Map(options.map((o, i) => [o.value, i]));
}

/**
 * Build the per-column value accessor used for sorting, once per (columns, options) change.
 * Every option rank (status, priority, each custom Auswahl column) and the column lookup are
 * precomputed here so the comparator does only O(1) map reads instead of re-parsing options and
 * re-scanning columns on every comparison.
 */
function makeSortValue(
  cols: CustomColumn[],
  statusOptions: CustomColumnOption[],
  priorityOptions: CustomColumnOption[],
): (task: Task, id: string) => string | number {
  const statusRank = rankMap(statusOptions);
  const priorityRank = rankMap(priorityOptions);
  const colById = new Map(cols.map((c) => [c.id, c]));
  // …and the same for every custom Auswahl column, from its own options array.
  const selectRanks = new Map(
    cols
      .filter((c) => c.type === 'select')
      .map((c) => [c.id, rankMap(parseColumnOptions(c.options))]),
  );
  return (task, id) => {
    if (id === 'manual') return task.sort_order;
    if (id === 'title') return task.title.toLowerCase();
    if (id === 'status') return statusRank.get(task.status) ?? statusRank.size;
    if (id === 'priority') return priorityRank.get(task.priority) ?? priorityRank.size;
    if (id === 'due') return task.due_date ?? '￿';
    if (id === 'created') return task.created_at ?? '￿';
    if (id === 'updated') return task.updated_at ?? '￿';
    const cid = customColId(id);
    if (cid !== null) {
      const raw = customValueOf(task, cid);
      if (colById.get(cid)?.type === 'checkbox') return raw === 'true' ? 0 : 1;
      // An Auswahl column ranks by its *configured* category order, exactly as status and
      // priority do above — the same OptionsEditor whose ↑ ↓ the user just used to put
      // offen → in Arbeit → fertig in workflow order. Falling through to a string compare
      // returned that column alphabetically, i.e. the reverse of what was configured, with no
      // way to get the intended order out of the column at all (TTU-19). Numbers throughout
      // this branch: compareByRules uses < / >, and a number-vs-string mix reads as "equal".
      const ranks = selectRanks.get(cid);
      if (ranks) {
        if (!raw) return ranks.size + 1; // empty sorts last, past a value no longer in the list
        return ranks.get(raw) ?? ranks.size;
      }
      return raw.toLowerCase() || '￿';
    }
    return 0;
  };
}

/**
 * Compare two tasks under a rule hierarchy, returning 0 when they are of *equal rank*. Done
 * tasks always sink first, regardless of the rules, so the "done at the bottom + crossed out"
 * baseline survives any configuration.
 *
 * Split out from `sortTasks` because equal rank is also what decides whether one row may be
 * dragged onto another: manual order is only ever a tiebreaker, so a drop that would cross a
 * rank boundary has to be refused rather than silently rewrite the task's fields.
 */
function compareByRules(
  a: Task,
  b: Task,
  rules: TaskSortRule[],
  getValue: (task: Task, id: string) => string | number,
  doneValue: string,
): number {
  const da = a.status === doneValue ? 1 : 0;
  const db = b.status === doneValue ? 1 : 0;
  if (da !== db) return da - db;
  for (const rule of rules) {
    const dir = rule.dir === 'asc' ? 1 : -1;
    const va = getValue(a, rule.id);
    const vb = getValue(b, rule.id);
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
  }
  return 0;
}

/**
 * Order tasks by a multi-key hierarchy (Settings → Automatische Sortierung, or a single
 * header-click override), reading each key via a precomputed `getValue` accessor. Ties fall
 * through to the manual drag order (`sort_order`) — relying on the sort being stable would
 * instead preserve the *server's* order. An empty rule list leaves that order (manual, done
 * last) untouched, which since WP-32 is the same thing by a shorter route.
 */
function sortTasks(
  tasks: Task[],
  rules: TaskSortRule[],
  getValue: (task: Task, id: string) => string | number,
  doneValue: string,
): Task[] {
  if (rules.length === 0) return tasks;
  return [...tasks].sort(
    (a, b) =>
      compareByRules(a, b, rules, getValue, doneValue) ||
      a.sort_order - b.sort_order ||
      a.id - b.id,
  );
}

export function TaskTable({
  tasks,
  customColumns,
  parent,
}: {
  tasks: Task[];
  /** The full, ordered set of columns (built-in + custom). Disabled ones are hidden. */
  customColumns: CustomColumn[];
  parent?: TaskTableParent;
}) {
  const invalidate = useInvalidateAll();
  const del = useUndoableDelete();
  const undoablePatch = useUndoablePatch();
  const sortRules = useTaskSortRules();
  const [sort, setSort] = useState<SortState>(null);
  // Effective ordering: a header click (`sort`) is a temporary single-key override; otherwise
  // follow the configured automatic hierarchy from Settings (empty → leave server order).
  //
  // Filtered through `activeSortRules`, because a rule whose column is hidden or gone must not
  // order the table (WP-32) — for a season written before it, two of the three stored rules.
  //
  // The override is *resolved first* rather than filtered alongside the hierarchy. A header only
  // exists for a visible column, but the column can be hidden while this table stays mounted (the
  // „Spalten verwalten" modal sits on the same page), and `sort` outlives it. Filtering it later
  // left a table that had silently snapped back to the default order while `drag.enabled` still
  // read `sort !== null` and refused every drop — with the header whose third click clears the
  // override (TTU-18) no longer rendered, leaving no way out but a navigation. So an override
  // whose column went away *is* no override, for the ordering and for dragging alike.
  const override = sort && sortRuleState(sort.id, customColumns) === 'active' ? sort : null;
  const activeRules = useMemo(
    () => (override ? [override] : activeSortRules(sortRules, customColumns)),
    [override, sortRules, customColumns],
  );
  // Subtask UI state: collapsed parents, the parent currently getting a new subtask,
  // and the parent awaiting a delete-with-children confirmation.
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [addingChildFor, setAddingChildFor] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ task: Task; children: Task[] } | null>(null);
  // The task whose move dialog is open. Depth-0 only — subtasks travel with their parent.
  const [moveTask, setMoveTask] = useState<Task | null>(null);

  // Live + archived, shared with MoveTaskDialog — the only list that shows the whole subtree.
  const { tasks: allTasks, loaded: treeLoaded } = useAllTasks();

  const doneValue = useMemo(() => doneValueOf(customColumns), [customColumns]);
  const statusOptions = useMemo(
    () => parseColumnOptions(findBuiltin(customColumns, 'status')?.options),
    [customColumns],
  );
  const priorityOptions = useMemo(
    () => parseColumnOptions(findBuiltin(customColumns, 'priority')?.options),
    [customColumns],
  );
  const getSortValue = useMemo(
    () => makeSortValue(customColumns, statusOptions, priorityOptions),
    [customColumns, statusOptions, priorityOptions],
  );

  const commit = useCallback(
    async (task: Task, patch: TaskUpdate, label: string) => {
      await undoablePatch({ res: api.tasks, row: task, patch, label });
    },
    [undoablePatch],
  );

  /**
   * Write one custom column's value. Only the changed key travels — the server merges it into
   * the row's own blob (`tasks` transform in server/src/routes/entities.ts).
   *
   * Sending the whole blob is what made two quick edits lose one of them: the object was rebuilt
   * from the `task` captured at render time, so ticking „Vertrag" and then „Bezahlt" before the
   * first refetch had landed sent a pre-„Vertrag" snapshot and silently un-ticked it, with no
   * error and no undo affordance for the value that vanished (TTU-23).
   */
  const commitCustom = useCallback(
    async (task: Task, colId: number, value: unknown) => {
      await commit(task, { custom_values: { [String(colId)]: value } }, 'Änderung');
    },
    [commit],
  );

  // --- subtask grouping (one level) ---
  const idSet = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks]);
  /**
   * The parent a task is actually *rendered* under: its own, unless that parent isn't in this
   * list (soft-deleted — including via the delete dialog's „Nur diese Aufgabe" — or archived), in
   * which case the task is promoted to top level rather than hidden. Never hide a task just
   * because its parent is gone.
   *
   * The single definition of that promotion, because every consumer has to agree on it: the row
   * grouping, `siblingsOf` and `canDrop` each spelled it out separately — and `canDrop` did not.
   */
  const effectiveParent = useCallback(
    (t: Task): number | null => (t.parent_id != null && idSet.has(t.parent_id) ? t.parent_id : null),
    [idSet],
  );
  const childrenByParent = useMemo(() => {
    const m = new Map<number, Task[]>();
    for (const t of tasks) {
      const pid = effectiveParent(t);
      if (pid === null) continue;
      const arr = m.get(pid);
      if (arr) arr.push(t);
      else m.set(pid, [t]);
    }
    return m;
  }, [tasks, effectiveParent]);
  const topLevel = useMemo(
    () => tasks.filter((t) => effectiveParent(t) === null),
    [tasks, effectiveParent],
  );
  const sortedTop = useMemo(
    () => sortTasks(topLevel, activeRules, getSortValue, doneValue),
    [topLevel, activeRules, getSortValue, doneValue],
  );
  const sortedChildren = useMemo(() => {
    const m = new Map<number, Task[]>();
    for (const [pid, arr] of childrenByParent) {
      m.set(pid, sortTasks(arr, activeRules, getSortValue, doneValue));
    }
    return m;
  }, [childrenByParent, activeRules, getSortValue, doneValue]);

  // --- manual reordering ---
  // A row may only be dropped on a sibling of equal rank: same list (both top-level, or the same
  // parent's children) and indistinguishable under the active rules.
  //
  // The rules are *truncated* at `manual`, not filtered of it. `manual` is near-unique, so once
  // it decides an ordering nothing after it can ever fire — with [Manuelle Reihenfolge, Status]
  // the table is fully hand-ordered, yet filtering left rankRules = [Status] and refused every
  // drop between two visibly adjacent rows of different status: the user dragged a row one slot
  // onto its neighbour and the drop landed on the floor with no highlight and no explanation
  // (TTU-33). Truncating also drops `manual` itself, which as the tiebreaker differs for every
  // pair and would forbid every drop.
  //
  // With no rules *in effect* — none configured, or every one of them pointing at a hidden column
  // — what remains is the server's own order, and since WP-32 that is `sort_order` itself
  // (`TASK_ORDER`, server/src/lib/queries.ts). An empty rank list is exactly right for it: every
  // pair of the same doneness is a tie, so every drop is allowed and the renumber really does put
  // the row where it was dropped. This used to need a SERVER_DEFAULT_RULES mirror of the server's
  // priority→due ordering, and getting that mirror wrong is TTU-07: drops accepted against an
  // ordering the server did not have, `reorder` renumbering the whole sibling list, and the
  // refetch snapping the row back as if the drag had done nothing — while every sibling's
  // sort_order had in fact been rewritten. The two orderings are still kept in step by comment
  // only; there is simply nothing left to restate.
  const rankRules = useMemo(() => {
    const manualAt = activeRules.findIndex((r) => r.id === MANUAL_SORT_ID);
    return manualAt === -1 ? activeRules : activeRules.slice(0, manualAt);
  }, [activeRules]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const siblingsOf = useCallback(
    (task: Task) => {
      const pid = effectiveParent(task);
      return pid === null ? sortedTop : sortedChildren.get(pid) ?? [];
    },
    [effectiveParent, sortedChildren, sortedTop],
  );
  const drag = useDragReorder<number>({
    mode: 'armed',
    // `sort_order` may only ever be renumbered against an ordering the user actually configured.
    // A header click is a temporary *view*: dragging under it renumbered every top-level task to
    // match the peeked-at order, so clicking „Titel" to eyeball the list alphabetically and then
    // nudging one row permanently replaced a hand-curated order with the alphabetical one — no
    // undo entry, unrecoverable (TTU-04). The third header click (TTU-18) is the way back.
    enabled: override === null,
    canDrop: (fromId, toId) => {
      const from = byId.get(fromId);
      const to = byId.get(toId);
      if (!from || !to) return false;
      // *Effective* parents, the same promotion the rows are grouped by. Comparing raw parent_id
      // made an orphan a sibling of nobody: it renders among the top-level rows and `siblingsOf`
      // counts it as one, but no drop target ever highlighted, so it snapped back at opacity-40
      // and stayed stuck wherever sort_order had left it, with no explanation (TTU-14).
      if (effectiveParent(from) !== effectiveParent(to)) return false;
      return compareByRules(from, to, rankRules, getSortValue, doneValue) === 0;
    },
    onReorder: async (fromId, toId) => {
      const from = byId.get(fromId);
      if (!from) return;
      const siblings = siblingsOf(from);
      const next = arrayMoveTo(
        siblings,
        siblings.findIndex((t) => t.id === fromId),
        siblings.findIndex((t) => t.id === toId),
      );
      if (next === siblings) return;
      // Renumber the whole sibling list by displayed position, so sort_order always mirrors
      // what the user is looking at and stays meaningful once the rules re-sort it.
      await api.tasks.reorder(next.map((t) => t.id));
      await invalidate();
    },
  });

  const toggleExpand = useCallback((id: number) => {
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  /**
   * The delete dialog has to count the *whole* subtree, which is not what this table renders.
   *
   * `childrenByParent` is built from the page list — `scope: 'live'`, so a done child past
   * ARCHIVE_AFTER_DAYS is missing — and it is one level deep. Counting from it undercounted the
   * „+ N Unteraufgaben löschen" button, deleted only what it had counted, and left the archived
   * child behind under a soft-deleted parent: a row listed for ever in „Archiv" that no delete
   * affordance could reach, and that `purgeExpired()` never touched because it was never
   * soft-deleted. When *every* child was archived it was worse — `kids.length === 0`, so the
   * parent went with no dialog at all and the user was never told subtasks existed (TTU-05).
   *
   * The scope-all list is the same query MoveTaskDialog uses, so opening either dialog warms it
   * for the other. Until it lands, the live map is the fallback: it can undercount, but the
   * server recomputes the closure for the actual delete, so it can never half-delete.
   */
  const requestDelete = useCallback(
    (task: Task) => {
      const kids = treeLoaded
        ? descendantsOf(allTasks, task.id)
        : childrenByParent.get(task.id) ?? [];
      if (kids.length === 0) {
        void del({ label: `Aufgabe „${task.title}“`, ...resourceUndo(api.tasks, task.id) });
      } else {
        setConfirmDelete({ task, children: kids });
      }
    },
    [allTasks, treeLoaded, childrenByParent, del],
  );

  const visibleCols = useMemo(
    () => [...customColumns].filter((c) => c.enabled !== 0).sort(compareColumns),
    [customColumns],
  );

  const colById = useMemo(
    () => new Map(visibleCols.map((c) => [colId(c), c])),
    [visibleCols],
  );
  const startSubtask = useCallback((id: number) => {
    setCollapsed((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    setAddingChildFor(id);
  }, []);

  /**
   * Which columns exist, and nothing else — every `cell` is a stable module-level component that
   * reads the moving parts from `TaskTableCtx`. See the interface's docstring for why the dep
   * list must stay this short (TTU-12).
   */
  const columns = useMemo<TaskColumn[]>(() => {
    const cols: TaskColumn[] = [];
    for (const col of visibleCols) {
      cols.push({
        id: colId(col),
        header: col.icon ? `${col.icon} ${col.name}` : col.name,
        cell: DataCell,
      });
    }
    cols.push({ id: 'actions', header: '', cell: ActionsCell });
    return cols;
  }, [visibleCols]);

  const cellApi: TaskTableApi = {
    colById,
    doneValue,
    statusOptions,
    priorityOptions,
    childrenByParent,
    commit,
    commitCustom,
    requestDelete,
    toggleExpand,
    startSubtask,
    startMove: setMoveTask,
  };

  // The rendered rows: the sorted tree flattened depth-first, minus whatever is folded away.
  // Both lists arrive already sorted, so this only decides depth and visibility.
  const rows = useMemo(
    () => buildTaskRows(sortedTop, sortedChildren, collapsed),
    [sortedTop, sortedChildren, collapsed],
  );

  const sortableIds = new Set([
    ...SORTABLE_TASK_COLUMNS.map((c) => c.id),
    ...visibleCols.filter((c) => c.kind === 'custom').map(colId),
  ]);
  /**
   * asc → desc → off. Without the third state a single header click made the configured
   * automatic hierarchy unreachable for the rest of the table's life — nothing else ever set
   * `sort` back to null, so the only way out was to navigate away and come back (TTU-18).
   */
  const toggleSort = (id: string) => {
    if (!sortableIds.has(id)) return;
    setSort((s) => {
      if (s?.id !== id) return { id, dir: 'asc' };
      return s.dir === 'asc' ? { id, dir: 'desc' } : null;
    });
  };

  // Display order and default status are separate concerns. OptionsEditor's ↑ ↓ exist so users
  // can order the pill dropdown (and with it `status asc` sorting), so taking whatever sits
  // first meant that moving „Erledigt" to the top made every new task be born done: greyed out
  // and struck through, stamped erledigt_am by the server transform, sunk to the bottom of the
  // table and on its way to the archive in 30 days (TTU-36).
  const defaultStatus = (statusOptions.find((o) => !o.done) ?? statusOptions[0])?.value ?? 'new';
  // Derived the same way, because the Priorität column's options are just as user-editable:
  // a hardcoded 'mittel' stopped matching any option the moment that category was deleted or
  // renamed (replacing hoch/mittel/niedrig with A/B/C is enough, since normalizeOptions derives
  // the value from the label). PillSelect then rendered the grey placeholder instead of a pill
  // and makeSortValue ranked the task at priorityRank.size, sorting every new task to the
  // bottom of the priority key with no indication why (TTU-11).
  //
  // The *middle* option, not the first: taking the first meant every new task claimed the top
  // rank — „hoch" ab Werk — which nobody had said and which the user only discovers the day the
  // Priorität column is shown (WP-32). Rounding down never picks the top once there is a choice
  // (3 options → the middle, 2 → the lower, 1 → the only one), and it stays a configured value,
  // which is the half of TTU-11 that still matters.
  const defaultPriority =
    priorityOptions[Math.floor(priorityOptions.length / 2)]?.value ?? 'mittel';

  return (
    <TaskTableCtx.Provider value={cellApi}>
    <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
      {/* Add row at the top so new tasks don't require scrolling past the done items. */}
      {parent && (
        <AddTaskRow
          parent={parent}
          defaultStatus={defaultStatus}
          defaultPriority={defaultPriority}
          onAdded={invalidate}
        />
      )}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-400">
            {/* Gutter header. Rendered outside the map so it carries no sort handler. */}
            <th className="p-0" style={{ width: TREE.width, minWidth: TREE.width }} aria-hidden />
            {columns.map(({ id, header }) => {
              const active = sort?.id === id;
              return (
                <th
                  key={id}
                  className={`px-3 py-2 font-semibold ${sortableIds.has(id) ? 'cursor-pointer select-none hover:text-neutral-600' : ''}`}
                  title={sortableIds.has(id) ? 'Sortieren: aufsteigend → absteigend → Standard' : undefined}
                  onClick={() => toggleSort(id)}
                >
                  <span className="inline-flex items-center gap-1">
                    {header}
                    {active && <span>{sort?.dir === 'asc' ? '▲' : '▼'}</span>}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        {/* One <tbody> per top-level task, so a task and its subtasks form one framed group. */}
        {groupRows(rows).map((group) => {
          const head = group[0]!;
          const spineColor = spineColorFor(head.original.color);
          const composerOpen = addingChildFor === head.original.id;
          const lastIdx = group.length - 1;
          return (
            <tbody key={head.id} data-group-id={head.original.id}>
              {group.map((row, i) => {
                const done = row.original.status === doneValue;
                const color = row.original.color;
                const colored = !done && !!color;
                const child = row.depth > 0;
                const closesGroup = i === lastIdx && !composerOpen;
                // Three cues, three channels that cannot overwrite one another: `done` owns
                // background-color, the colour tint and the nesting band composite as
                // background-image layers, and the colour accent moves to the gutter cell.
                const layers: string[] = [];
                if (colored) {
                  const tint = withAlpha(color, 0.16);
                  layers.push(`linear-gradient(${tint}, ${tint})`);
                }
                if (child) layers.push(CHILD_BAND);
                return (
                  <tr
                    key={row.id}
                    data-task-id={row.original.id}
                    data-depth={row.depth}
                    className={`group border-b align-top ${
                      closesGroup ? 'border-neutral-200/60' : 'border-neutral-100/70'
                    } ${
                      done
                        ? 'bg-neutral-50/60 text-neutral-400'
                        : child
                          ? 'hover:bg-neutral-50/70'
                          : 'hover:bg-neutral-50/40'
                    } ${
                      drag.isDropTarget(row.original.id)
                        ? 'outline outline-2 -outline-offset-2 outline-neutral-500'
                        : ''
                    } ${drag.isDragging(row.original.id) ? 'opacity-40' : ''}`}
                    style={layers.length ? { backgroundImage: layers.join(', ') } : undefined}
                    {...drag.itemProps(row.original.id)}
                  >
                    <TreeGutterCell
                      // A subtask that has subtasks of its own gets the connector *and* a
                      // chevron. The UI only builds two levels, but an import can produce more,
                      // and without the third kind those rows rendered exactly like their own
                      // children and could not be folded (TTU-37).
                      kind={
                        child
                          ? row.canExpand
                            ? 'branch'
                            : 'child'
                          : row.canExpand
                            ? 'parent'
                            : 'leaf'
                      }
                      expanded={row.isExpanded}
                      continues={i < lastIdx || composerOpen}
                      spineColor={spineColor}
                      accentColor={colored ? color : null}
                      onToggle={() => toggleExpand(row.original.id)}
                      dragHandle={
                        // `override`, not `sort`: an override whose column has been hidden no
                        // longer orders anything, so a handle explaining itself with „Spalten-
                        // sortierung aktiv" would point at a header that is not on screen to
                        // click a third time.
                        override ? (
                          <DragHandle
                            disabled
                            title="Spaltensortierung aktiv — zum Verschieben die Sortierung zurücksetzen (Spaltenkopf erneut klicken)"
                          />
                        ) : (
                          <DragHandle {...drag.handleProps(row.original.id)} />
                        )
                      }
                    />
                    {columns.map(({ id, cell: Cell }) => (
                      <td key={id} className="px-3 py-2">
                        <Cell row={row} columnId={id} />
                      </td>
                    ))}
                  </tr>
                );
              })}
              {composerOpen && (
                <SubtaskAddRow
                  parentTask={head.original}
                  /* Data columns only — the composer supplies its own gutter cell. */
                  colSpan={columns.length}
                  spineColor={spineColor}
                  defaultStatus={defaultStatus}
                  defaultPriority={defaultPriority}
                  onAdded={invalidate}
                  onClose={() => setAddingChildFor(null)}
                />
              )}
            </tbody>
          );
        })}
      </table>

      {tasks.length === 0 && <div className="p-3"><EmptyState>Keine Aufgaben.</EmptyState></div>}

      {moveTask && <MoveTaskDialog task={moveTask} onClose={() => setMoveTask(null)} />}

      {confirmDelete && (
        <Modal
          title="Aufgabe löschen"
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <Btn onClick={() => setConfirmDelete(null)}>Abbrechen</Btn>
              <Btn
                onClick={() => {
                  const { task } = confirmDelete;
                  void del({ label: `Aufgabe „${task.title}“`, ...resourceUndo(api.tasks, task.id) });
                  setConfirmDelete(null);
                }}
              >
                Nur diese Aufgabe
              </Btn>
              <Btn
                variant="danger"
                onClick={() => {
                  const { task, children } = confirmDelete;
                  const n = children.length;
                  // One transactional request, not a `Promise.all` of per-row DELETEs: a request
                  // that failed part-way used to leave the tree half-deleted, and because
                  // `Promise.all` rejects at the first failure, `useUndoableDelete` never reached
                  // its invalidate or its toast — no error, no „Rückgängig", and the only way
                  // back was the archive's trash (TTU-35).
                  //
                  // The undo restores exactly what the delete took, so a subtask that was already
                  // in the Papierkorb is not resurrected with it. The ids are only known once the
                  // request answers, hence the closure variable; a redo re-runs `remove` and
                  // recomputes them.
                  let removed: number[] = [];
                  void del({
                    label: `Aufgabe „${task.title}“ + ${n} Unteraufgabe${n === 1 ? '' : 'n'}`,
                    remove: async () => {
                      const res = await api.tasks.removeTree(task.id);
                      removed = res.ids;
                      return res;
                    },
                    restore: () => api.tasks.restoreTree(task.id, removed),
                  });
                  setConfirmDelete(null);
                }}
              >
                + {confirmDelete.children.length} Unteraufgabe{confirmDelete.children.length === 1 ? '' : 'n'} löschen
              </Btn>
            </>
          }
        >
          <p className="text-sm text-neutral-600">
            „{confirmDelete.task.title}“ hat {confirmDelete.children.length} Unteraufgabe
            {confirmDelete.children.length === 1 ? '' : 'n'}. Sollen die Unteraufgaben auch gelöscht werden?
          </p>
        </Modal>
      )}
    </div>
    </TaskTableCtx.Provider>
  );
}

/* ---------- cell components ---------- */
/* Module-level and therefore stable component *types* — see TaskTableApi's docstring (TTU-12). */

/**
 * Any data column. Resolves its own `CustomColumn` from the column id, and adds the subtask
 * counter to the Titel column: the hierarchy chrome lives in the leading gutter, so all that
 * belongs in a data cell is the counter — a property of the task itself, and the one cue that
 * stays meaningful wherever the user has ordered the Titel column.
 */
function DataCell({ row, columnId }: TaskCellProps) {
  const api = useTaskTableApi();
  const col = api.colById.get(columnId);
  if (!col) return null;
  const inner = (
    <ColumnCell
      task={row.original}
      col={col}
      isChild={row.depth > 0}
      doneValue={api.doneValue}
      statusOptions={api.statusOptions}
      priorityOptions={api.priorityOptions}
      commit={api.commit}
      commitCustom={api.commitCustom}
    />
  );
  if (!(col.kind === 'builtin' && col.key === 'title')) return inner;
  const kids = api.childrenByParent.get(row.original.id) ?? [];
  if (kids.length === 0) return inner;
  const doneKids = kids.filter((k) => k.status === api.doneValue).length;
  const isExpanded = row.isExpanded;
  const pct = Math.round((doneKids / kids.length) * 100);
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">{inner}</div>
      {/* A second, larger disclosure target for anyone who never notices the chevron. */}
      <button
        type="button"
        onClick={() => api.toggleExpand(row.original.id)}
        title={`${doneKids} von ${kids.length} Unteraufgaben erledigt — ${isExpanded ? 'einklappen' : 'ausklappen'}`}
        className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums transition ${
          isExpanded
            ? 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600'
            : 'text-neutral-600 ring-1 ring-neutral-200 ring-inset hover:ring-neutral-300'
        }`}
        // Expanded the children speak for themselves, so the pill recedes. Collapsed it
        // carries the progress it is standing in for, as its own fill.
        style={
          isExpanded
            ? undefined
            : {
                backgroundImage: `linear-gradient(to right, rgb(229 229 229) ${pct}%, rgb(245 245 245) ${pct}%)`,
              }
        }
      >
        {doneKids}/{kids.length}
      </button>
    </div>
  );
}

/** Trailing row actions: add subtask, move, colour, delete. */
function ActionsCell({ row }: TaskCellProps) {
  const api = useTaskTableApi();
  const task = row.original;
  return (
    <div className="flex items-center justify-end gap-0.5">
      {/* Subtasks are one level deep, so only a task that is not itself a subtask can get one.
          The test is `parent_id`, not `row.depth === 0`: depth is a *render position*, and
          `topLevel` promotes orphans — subtasks whose parent is soft-deleted or archived — to
          depth 0, so the depth test offered this button on exactly the rows that must not become
          parents. Restore the parent from „Archiv" afterwards and the list holds a three-level
          tree the table was never built to render (TTU-15).
          Kept persistently visible (like the trash icon) so the feature is discoverable. */}
      {task.parent_id == null && (
        <IconButton
          size="sm"
          className="text-base"
          title="Unteraufgabe hinzufügen"
          onClick={() => api.startSubtask(task.id)}
        >
          ＋
        </IconButton>
      )}
      {/* Depth, not `parent_id`: subtasks travel with their parent, but an orphan renders at
          depth 0 and moving it is how the user repairs it (TTU-30). */}
      {row.depth === 0 && (
        <IconButton size="sm" title="Verschieben" onClick={() => api.startMove(task)}>
          <MoveIcon className="h-4 w-4" />
        </IconButton>
      )}
      <ColorSwatchPicker
        value={task.color}
        onChange={(color) => api.commit(task, { color }, 'Farbänderung')}
      />
      <IconButton variant="danger" size="sm" title="Löschen" onClick={() => api.requestDelete(task)}>
        <TrashIcon className="h-4 w-4" />
      </IconButton>
    </div>
  );
}

/* ---------- cell dispatch ---------- */

function ColumnCell({
  task,
  col,
  isChild,
  doneValue,
  statusOptions,
  priorityOptions,
  commit,
  commitCustom,
}: {
  task: Task;
  col: CustomColumn;
  /** Subtask row — the one nesting cue that survives any column ordering. */
  isChild: boolean;
  doneValue: string;
  statusOptions: CustomColumnOption[];
  priorityOptions: CustomColumnOption[];
  commit: (task: Task, patch: Partial<Task>, label: string) => Promise<void>;
  commitCustom: (task: Task, colId: number, value: unknown) => Promise<void>;
}) {
  if (col.kind === 'builtin') {
    switch (col.key) {
      case 'status':
        return (
          <PillSelect
            value={task.status}
            options={statusOptions}
            onChange={(v) => commit(task, { status: v }, 'Statusänderung')}
          />
        );
      case 'title':
        return (
          <TitleCell
            task={task}
            isChild={isChild}
            doneValue={doneValue}
            onCommit={(v) => commit(task, { title: v }, 'Titeländerung')}
          />
        );
      case 'priority':
        return (
          <PillSelect
            value={task.priority}
            options={priorityOptions}
            placeholder="Priorität"
            onChange={(v) => commit(task, { priority: v }, 'Prioritätsänderung')}
          />
        );
      case 'due':
        return <DueCell task={task} onCommit={(v) => commit(task, { due_date: v }, 'Datumsänderung')} />;
      case 'comment':
        return <CommentCell task={task} onCommit={(v) => commit(task, { comment: v }, 'Kommentaränderung')} />;
      case 'created':
        return <TimestampCell value={task.created_at} />;
      case 'updated':
        return <TimestampCell value={task.updated_at} />;
    }
  }
  return <CustomCell task={task} column={col} onCommit={(v) => commitCustom(task, col.id, v)} />;
}

/* ---------- editable cells ---------- */

function TitleCell({
  task,
  isChild,
  doneValue,
  onCommit,
}: {
  task: Task;
  isChild: boolean;
  doneValue: string;
  onCommit: (v: string) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    // `empty: 'ignore'` — a task may not lose its title, which is what this cell hand-rolled
    // before it shared the input (WP-43): same trim-and-commit-if-changed, plus the Escape
    // `stopPropagation`, the rejected-write toast and the unmount commit it did not have.
    return (
      <InlineInput
        value={task.title}
        onCommit={onCommit}
        onDone={() => setEditing(false)}
        errorMessage="Der Titel konnte nicht gespeichert werden."
        className={`w-full min-w-48 ${INLINE_INPUT}`}
      />
    );
  }
  return (
    <button
      className={`min-w-48 max-w-md text-left ${
        task.status === doneValue
          ? 'line-through'
          : isChild
            ? 'text-neutral-600'
            : 'font-medium text-neutral-800'
      }`}
      onClick={() => setEditing(true)}
    >
      {task.title}
    </button>
  );
}

/** Read-only cell for the built-in "Erstellt am" / "Zuletzt bearbeitet" timestamp columns. */
function TimestampCell({ value }: { value: string | null }) {
  return (
    <span className="whitespace-nowrap text-sm text-neutral-500">
      {value ? formatDate(value) : <span className="text-neutral-300">—</span>}
    </span>
  );
}

function DueCell({ task, onCommit }: { task: Task; onCommit: (v: string | null) => void | Promise<void> }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    // `empty: 'clear'` — an emptied Fällig field is „kein Datum", not a no-op. Enter and Escape
    // come with the shared input; a half-typed date commits nothing (see `InlineInput`).
    return (
      <InlineInput
        type="date"
        empty="clear"
        value={task.due_date ?? ''}
        onCommit={onCommit}
        onDone={() => setEditing(false)}
        errorMessage="Das Datum konnte nicht gespeichert werden."
        className={INLINE_INPUT}
      />
    );
  }
  return (
    <button className="whitespace-nowrap text-sm" onClick={() => setEditing(true)}>
      {task.due_date ? formatDate(task.due_date) : <span className="text-neutral-300">—</span>}
    </button>
  );
}

function CommentCell({ task, onCommit }: { task: Task; onCommit: (v: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [value, setValue] = useState(task.comment ?? '');
  const next = () => (value.trim() === '' ? null : value);
  useCommitOnUnmount(editing, () => {
    if (next() !== (task.comment ?? null)) onCommit(next());
  });

  if (editing) {
    return (
      <RichTextEditor
        autoFocus
        compact
        value={value}
        onChange={setValue}
        className={`min-h-24 w-full min-w-64 ${INLINE_INPUT}`}
        onBlur={() => {
          setEditing(false);
          if (next() !== (task.comment ?? null)) onCommit(next());
        }}
        // Enter is a paragraph here, so saving takes ⌘↵ and cancelling takes Escape — the same
        // two keys `InlineNotes` binds, and the reason `RichTextEditor` runs a caller's handler
        // ahead of its own keymap. Escape resets the draft first, which also disarms the
        // unmount commit above (it reads the current render's `value`).
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            setValue(task.comment ?? '');
            setEditing(false);
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            (e.target as HTMLElement).blur();
          }
        }}
      />
    );
  }
  if (!task.comment) {
    return (
      <button className="text-xs text-neutral-300 hover:text-neutral-500" onClick={() => setEditing(true)}>
        + Kommentar
      </button>
    );
  }
  const long = task.comment.length > 140;
  return (
    <div className="max-w-md min-w-64">
      <div
        className={`cursor-text text-sm text-neutral-600 ${!expanded && long ? 'max-h-12 overflow-hidden' : ''}`}
        onDoubleClick={() => setEditing(true)}
      >
        <Markdown>{task.comment}</Markdown>
      </div>
      <div className="mt-0.5 flex gap-2 text-[11px] text-neutral-400">
        {long && (
          <button className="hover:text-neutral-600" onClick={() => setExpanded((x) => !x)}>
            {expanded ? 'weniger' : 'mehr'}
          </button>
        )}
        <button className="hover:text-neutral-600" onClick={() => setEditing(true)}>
          bearbeiten
        </button>
      </div>
    </div>
  );
}

function CustomCell({
  task,
  column,
  onCommit,
}: {
  task: Task;
  column: CustomColumn;
  /** Returns its promise so `InlineInput` can report a rejected write instead of dropping it. */
  onCommit: (v: unknown) => void | Promise<void>;
}) {
  const raw = customValueOf(task, column.id);
  if (column.type === 'checkbox') {
    return (
      <input
        type="checkbox"
        className="h-4 w-4 cursor-pointer"
        checked={raw === 'true'}
        onChange={(e) => onCommit(e.target.checked)}
      />
    );
  }
  if (column.type === 'select') {
    return (
      <PillSelect
        value={raw}
        options={parseColumnOptions(column.options)}
        allowEmpty
        onChange={(v) => onCommit(v)}
      />
    );
  }
  if (column.type === 'date') {
    return <EditableDateCell value={raw} onCommit={(v) => onCommit(v)} />;
  }
  return <EditableTextCell value={raw} onCommit={(v) => onCommit(v)} />;
}

function EditableTextCell({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      // `empty: 'raw'` — clearing a custom text column stores the empty value, it is not a no-op.
      <InlineInput
        empty="raw"
        value={value}
        onCommit={onCommit}
        onDone={() => setEditing(false)}
        errorMessage="Die Änderung konnte nicht gespeichert werden."
        className={`w-40 ${INLINE_INPUT}`}
      />
    );
  }
  return (
    <button
      className="min-w-20 text-left text-sm text-neutral-700 hover:text-neutral-900"
      onClick={() => setEditing(true)}
    >
      {value || <span className="text-neutral-300">—</span>}
    </button>
  );
}

function EditableDateCell({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    // `empty: 'raw'` — like the text cell beside it, a cleared custom column stores the empty
    // value rather than `null`; the blob keeps the key.
    return (
      <InlineInput
        type="date"
        empty="raw"
        value={value}
        onCommit={onCommit}
        onDone={() => setEditing(false)}
        errorMessage="Das Datum konnte nicht gespeichert werden."
        className={INLINE_INPUT}
      />
    );
  }
  return (
    <button className="whitespace-nowrap text-sm" onClick={() => setEditing(true)}>
      {value ? formatDate(value) : <span className="text-neutral-300">—</span>}
    </button>
  );
}

function AddTaskRow({
  parent,
  defaultStatus,
  defaultPriority,
  onAdded,
}: {
  parent: TaskTableParent;
  defaultStatus: string;
  defaultPriority: string;
  onAdded: () => Promise<void>;
}) {
  const saison = useSaison();
  const { title, setTitle, submit } = useTaskComposer(
    (title) =>
      api.tasks.create({
        title,
        artist_id: parent.artist_id ?? null,
        project_id: parent.project_id ?? null,
        priority: defaultPriority,
        status: defaultStatus,
      }),
    onAdded,
  );
  const onEnter = onEnterKey(() => void submit());
  return (
    <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2">
      <span className="text-neutral-300">＋</span>
      {/* No `autoFocus`, deliberately (WP-43): this row is permanently visible, so focusing it on
          mount would take the caret on every artist and project page the user opened to read —
          and scroll it into view besides. Escape therefore clears the draft rather than closing
          anything; there is nothing here to close. */}
      <input
        className="flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-neutral-300"
        placeholder={
          parent.general
            ? `Neue allgemeine Aufgabe${saison ? ` (${saison})` : ''} … (Enter)`
            : 'Neue Aufgabe … (Enter)'
        }
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          onEnter(e);
          if (e.key === 'Escape') setTitle('');
        }}
      />
    </div>
  );
}

/**
 * Controlled title input that creates a task — shared by the top add-row and the indented
 * subtask composer. `create` receives the trimmed title.
 *
 * Two things it has to get right, both of which it used to get wrong (TTU-24):
 *
 * - **One task per Enter.** The old order was read `title` → `await create` → *then* clear, and
 *   `title` is controlled state, so every keydown before the POST resolved saw the same non-empty
 *   string. Holding Enter for a second created ~15 identical tasks. The title is cleared before
 *   the await now, and `busy` is a ref rather than state so a burst inside one tick cannot slip
 *   past it — the sibling forms in this codebase (`AddColumnForm.add`, `ColumnEditModal.save`,
 *   `RecordFormModal.submit`) all gate the same way.
 * - **A failure is visible.** Both call sites `void submit()`, so a rejected POST — the 400 from
 *   the `parent_id` guard, a server restarting mid-season-switch — surfaced as nothing at all:
 *   the row simply never appeared. It goes through `useGuardedAction` now, and the typed title is
 *   put back so the user can retry rather than retype.
 */
function useTaskComposer(create: (title: string) => Promise<unknown>, onAdded: () => Promise<void>) {
  const [title, setTitle] = useState('');
  const busy = useRef(false);
  const guard = useGuardedAction();
  const submit = async () => {
    const t = title.trim();
    if (!t || busy.current) return;
    busy.current = true;
    setTitle('');
    try {
      if (await guard('Die Aufgabe konnte nicht angelegt werden.', () => create(t))) await onAdded();
      else setTitle(t);
    } finally {
      busy.current = false;
    }
  };
  return { title, setTitle, submit };
}

/** Inline composer for a subtask, rendered as the last row of its parent's group so that it
 *  extends the group rather than splitting it. `colSpan` covers the data columns only. */
function SubtaskAddRow({
  parentTask,
  colSpan,
  spineColor,
  defaultStatus,
  defaultPriority,
  onAdded,
  onClose,
}: {
  parentTask: Task;
  colSpan: number;
  spineColor: string;
  defaultStatus: string;
  defaultPriority: string;
  onAdded: () => Promise<void>;
  onClose: () => void;
}) {
  // A subtask inherits its parent's project/artist so it lands in the same list.
  const { title, setTitle, submit } = useTaskComposer(
    (title) =>
      api.tasks.create({
        title,
        parent_id: parentTask.id,
        artist_id: parentTask.artist_id ?? null,
        project_id: parentTask.project_id ?? null,
        priority: defaultPriority,
        status: defaultStatus,
      }),
    onAdded,
  );
  const onEnter = onEnterKey(() => void submit());
  return (
    <tr className="border-b border-neutral-200/60" style={{ backgroundImage: CHILD_BAND }}>
      <TreeGutterCell kind="composer" spineColor={spineColor} />
      <td colSpan={colSpan} className="px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-neutral-300">＋</span>
          <input
            autoFocus
            className="flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-neutral-300"
            placeholder="Neue Unteraufgabe … (Enter)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              onEnter(e);
              if (e.key === 'Escape') onClose();
            }}
            onBlur={() => {
              if (!title.trim()) onClose();
            }}
          />
        </div>
      </td>
    </tr>
  );
}
