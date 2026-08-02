import { useCallback, useMemo, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
  type ColumnDef,
  type ExpandedState,
} from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { CustomColumn, CustomColumnOption, Task, TaskSortRule } from '../api/types';
import { compareColumns, customValueOf, doneValueOf, parseColumnOptions, parseCustomValues } from '../api/types';
import { formatDate } from '../lib/dates';
import { withAlpha } from '../lib/colors';
import { MANUAL_SORT_ID, SORTABLE_TASK_COLUMNS } from '../lib/taskSort';
import { arrayMoveTo } from '../lib/arrays';
import { useDragReorder } from '../lib/dragReorder';
import { Markdown } from './Markdown';
import { RichTextEditor } from './RichTextEditor';
import { ColorSwatchPicker } from './ColorSwatchPicker';
import { CHILD_BAND, TREE, TreeGutterCell, groupRows, spineColorFor } from './TaskTreeGutter';
import { MoveIcon, TrashIcon } from './icons';
import { MoveTaskDialog } from './MoveTaskDialog';
import { ProjectBadge } from './ProjectBadge';
import { PillSelect } from './PillSelect';
import { EmptyState, Btn, DragHandle, IconButton } from './ui';
import { Modal } from './fields';
import {
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

/** Muted chip marking a task's scope when it has no project badge („Allgemein“ / the season name).
 *  `tone="festival"` names the violet colour token, not the text. */
function ScopeChip({ label, tone }: { label: string; tone: 'neutral' | 'festival' }) {
  const cls =
    tone === 'festival' ? 'bg-violet-100 text-violet-700' : 'bg-neutral-100 text-neutral-500';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

/** null = follow the configured automatic hierarchy; a rule = a temporary header-click override. */
type SortState = TaskSortRule | null;

/** Stable column id: built-ins use their key, custom columns use `c<id>`. */
function colId(col: CustomColumn): string {
  return col.kind === 'builtin' && col.key ? col.key : `c${col.id}`;
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
 * Status/priority ranks and the column lookup are precomputed here so the comparator does only
 * O(1) map reads instead of re-parsing options and re-scanning columns on every comparison.
 */
function makeSortValue(
  cols: CustomColumn[],
  statusOptions: CustomColumnOption[],
  priorityOptions: CustomColumnOption[],
): (task: Task, id: string) => string | number {
  const statusRank = rankMap(statusOptions);
  const priorityRank = rankMap(priorityOptions);
  const colById = new Map(cols.map((c) => [c.id, c]));
  return (task, id) => {
    if (id === 'manual') return task.sort_order;
    if (id === 'title') return task.title.toLowerCase();
    if (id === 'status') return statusRank.get(task.status) ?? statusRank.size;
    if (id === 'priority') return priorityRank.get(task.priority) ?? priorityRank.size;
    if (id === 'due') return task.due_date ?? '￿';
    if (id === 'created') return task.created_at ?? '￿';
    if (id === 'updated') return task.updated_at ?? '￿';
    if (id.startsWith('c')) {
      const cid = Number(id.slice(1));
      const raw = customValueOf(task, cid);
      if (colById.get(cid)?.type === 'checkbox') return raw === 'true' ? 0 : 1;
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
 * instead preserve the *server's* order, which ranks priority and due date above sort_order.
 * An empty rule list leaves the server order (priority → due, done last) untouched.
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
  showAssignment = false,
  showProject = false,
}: {
  tasks: Task[];
  /** The full, ordered set of columns (built-in + custom). Disabled ones are hidden. */
  customColumns: CustomColumn[];
  parent?: TaskTableParent;
  /** Show artist name + project badge (global dashboard table). */
  showAssignment?: boolean;
  /** Show only the project badge (artist page, tasks span projects). */
  showProject?: boolean;
}) {
  const invalidate = useInvalidateAll();
  const del = useUndoableDelete();
  const undoablePatch = useUndoablePatch();
  const sortRules = useTaskSortRules();
  const saison = useSaison();
  const [sort, setSort] = useState<SortState>(null);
  // Effective ordering: a header click (`sort`) is a temporary single-key override; otherwise
  // follow the configured automatic hierarchy from Settings (empty → leave server order).
  const activeRules = useMemo(() => (sort ? [sort] : sortRules), [sort, sortRules]);
  // Subtask UI state: collapsed parents, the parent currently getting a new subtask,
  // and the parent awaiting a delete-with-children confirmation.
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [addingChildFor, setAddingChildFor] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ task: Task; children: Task[] } | null>(null);
  // The task whose move dialog is open. Depth-0 only — subtasks travel with their parent.
  const [moveTask, setMoveTask] = useState<Task | null>(null);

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
    async (
      task: Task,
      patch: Partial<Task> | { custom_values: Record<string, unknown> },
      label: string,
    ) => {
      await undoablePatch({ res: api.tasks, row: task, patch: patch as Partial<Task>, label });
    },
    [undoablePatch],
  );

  const commitCustom = useCallback(
    async (task: Task, colId: number, value: unknown) => {
      const cv = parseCustomValues(task.custom_values);
      cv[String(colId)] = value;
      await commit(task, { custom_values: cv }, 'Änderung');
    },
    [commit],
  );

  // --- subtask grouping (one level) ---
  const idSet = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks]);
  const childrenByParent = useMemo(() => {
    const m = new Map<number, Task[]>();
    for (const t of tasks) {
      if (t.parent_id != null && idSet.has(t.parent_id)) {
        const arr = m.get(t.parent_id);
        if (arr) arr.push(t);
        else m.set(t.parent_id, [t]);
      }
    }
    return m;
  }, [tasks, idSet]);
  // Top level = no parent, or an orphan whose parent isn't in this list (archived/deleted):
  // never hide a task just because its parent is gone.
  const topLevel = useMemo(
    () => tasks.filter((t) => t.parent_id == null || !idSet.has(t.parent_id)),
    [tasks, idSet],
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
  // parent's children) and indistinguishable under the active rules. `manual` is stripped from
  // the rank test — as the tiebreaker it differs for every pair, which would forbid every drop.
  const rankRules = useMemo(
    () => activeRules.filter((r) => r.id !== MANUAL_SORT_ID),
    [activeRules],
  );
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const siblingsOf = useCallback(
    (task: Task) =>
      task.parent_id != null && idSet.has(task.parent_id)
        ? sortedChildren.get(task.parent_id) ?? []
        : sortedTop,
    [idSet, sortedChildren, sortedTop],
  );
  const drag = useDragReorder<number>({
    mode: 'armed',
    // `sort_order` may only ever be renumbered against an ordering the user actually configured.
    // A header click is a temporary *view*: dragging under it renumbered every top-level task to
    // match the peeked-at order, so clicking „Titel" to eyeball the list alphabetically and then
    // nudging one row permanently replaced a hand-curated order with the alphabetical one — no
    // undo entry, unrecoverable (TTU-04). The third header click (TTU-18) is the way back.
    enabled: sort === null,
    canDrop: (fromId, toId) => {
      const from = byId.get(fromId);
      const to = byId.get(toId);
      if (!from || !to) return false;
      if ((from.parent_id ?? null) !== (to.parent_id ?? null)) return false;
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

  // Which parents are expanded, as a TanStack ExpandedState keyed by task id (via getRowId).
  const expanded = useMemo<ExpandedState>(() => {
    const rec: Record<string, boolean> = {};
    for (const pid of childrenByParent.keys()) if (!collapsed.has(pid)) rec[String(pid)] = true;
    return rec;
  }, [childrenByParent, collapsed]);
  const toggleExpand = useCallback((id: number) => {
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const requestDelete = useCallback(
    (task: Task) => {
      const kids = childrenByParent.get(task.id) ?? [];
      if (kids.length === 0) {
        void del({ label: `Aufgabe „${task.title}“`, ...resourceUndo(api.tasks, task.id) });
      } else {
        setConfirmDelete({ task, children: kids });
      }
    },
    [childrenByParent, del],
  );

  const visibleCols = useMemo(
    () => [...customColumns].filter((c) => c.enabled !== 0).sort(compareColumns),
    [customColumns],
  );

  const columns = useMemo<ColumnDef<Task>[]>(() => {
    const cols: ColumnDef<Task>[] = [];
    const assignCol: ColumnDef<Task> = {
      id: 'assign',
      header: 'Zuordnung',
      cell: ({ row }) => {
        if (row.depth > 0) return null; // subtask shares the parent's project — no redundant badge
        const t = row.original;
        const seasonWide = !t.project_id && !t.resolved_artist_id;
        return (
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            {showAssignment && t.resolved_artist_id && (
              <Link
                to={`/artist/${t.resolved_artist_id}`}
                className="text-sm text-neutral-600 hover:underline"
                style={{ color: t.artist_color ?? undefined }}
              >
                {t.artist_name}
              </Link>
            )}
            {/* Imported projects can have no K-code; fall back to the name so the chip still shows. */}
            {t.project_id && (t.project_code || t.project_name) && (
              <ProjectBadge
                code={t.project_code || t.project_name!}
                projectId={t.project_id}
                artistColor={t.artist_color}
                projectColor={t.project_color}
                to={`/project/${t.project_id}`}
              />
            )}
            {/* Artist page: an artist-level todo (no project) is "Allgemein". */}
            {showProject && !t.project_id && <ScopeChip label="Allgemein" tone="neutral" />}
            {/* Dashboard: a todo with no artist and no project is season-wide — tag it with the
                season's own name, not the generic word. `tone="festival"` is the violet token. */}
            {showAssignment && seasonWide && <ScopeChip label={saison} tone="festival" />}
          </div>
        );
      },
    };

    for (const col of visibleCols) {
      const isTitle = col.kind === 'builtin' && col.key === 'title';
      cols.push({
        id: colId(col),
        header: col.icon ? `${col.icon} ${col.name}` : col.name,
        cell: ({ row }) => {
          const inner = (
            <ColumnCell
              task={row.original}
              col={col}
              isChild={row.depth > 0}
              doneValue={doneValue}
              statusOptions={statusOptions}
              priorityOptions={priorityOptions}
              commit={commit}
              commitCustom={commitCustom}
            />
          );
          if (!isTitle) return inner;
          // The hierarchy chrome lives in the leading gutter column, so all that belongs here
          // is the subtask counter — a property of the task itself, and the one cue that stays
          // meaningful wherever the user has ordered the Titel column.
          const kids = childrenByParent.get(row.original.id) ?? [];
          if (kids.length === 0) return inner;
          const doneKids = kids.filter((k) => k.status === doneValue).length;
          const isExpanded = row.getIsExpanded();
          const pct = Math.round((doneKids / kids.length) * 100);
          return (
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">{inner}</div>
              {/* A second, larger disclosure target for anyone who never notices the chevron. */}
              <button
                type="button"
                onClick={() => toggleExpand(row.original.id)}
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
        },
      });
      // Keep the artist/project link next to the task identity.
      if (col.kind === 'builtin' && col.key === 'title' && (showAssignment || showProject)) {
        cols.push(assignCol);
      }
    }

    cols.push({
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-0.5">
          {/* Subtasks are one level deep, so only top-level rows can get one. Kept
              persistently visible (like the trash icon) so the feature is discoverable. */}
          {row.depth === 0 && (
            <>
              <IconButton
                size="sm"
                className="text-base"
                title="Unteraufgabe hinzufügen"
                onClick={() => {
                  setCollapsed((s) => {
                    const n = new Set(s);
                    n.delete(row.original.id);
                    return n;
                  });
                  setAddingChildFor(row.original.id);
                }}
              >
                ＋
              </IconButton>
              <IconButton size="sm" title="Verschieben" onClick={() => setMoveTask(row.original)}>
                <MoveIcon className="h-4 w-4" />
              </IconButton>
            </>
          )}
          <ColorSwatchPicker
            value={row.original.color}
            onChange={(color) => commit(row.original, { color }, 'Farbänderung')}
          />
          <IconButton variant="danger" size="sm" title="Löschen" onClick={() => requestDelete(row.original)}>
            <TrashIcon className="h-4 w-4" />
          </IconButton>
        </div>
      ),
    });
    return cols;
  }, [visibleCols, showAssignment, showProject, saison, doneValue, statusOptions, priorityOptions, commit, commitCustom, childrenByParent, toggleExpand, requestDelete]);

  const table = useReactTable({
    data: sortedTop,
    columns,
    state: { expanded },
    getRowId: (t) => String(t.id),
    getSubRows: (t) => sortedChildren.get(t.id),
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  const sortableIds = new Set([
    ...SORTABLE_TASK_COLUMNS.map((c) => c.id),
    ...visibleCols.filter((c) => c.kind === 'custom').map((c) => `c${c.id}`),
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
  // bottom of the priority key with no indication why (TTU-11). No `done` notion here, so the
  // first option is the right default.
  const defaultPriority = priorityOptions[0]?.value ?? 'mittel';

  return (
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
            {table.getHeaderGroups()[0]?.headers.map((h) => {
              const id = h.column.id;
              const active = sort?.id === id;
              return (
                <th
                  key={h.id}
                  className={`px-3 py-2 font-semibold ${sortableIds.has(id) ? 'cursor-pointer select-none hover:text-neutral-600' : ''}`}
                  title={sortableIds.has(id) ? 'Sortieren: aufsteigend → absteigend → Standard' : undefined}
                  onClick={() => toggleSort(id)}
                >
                  <span className="inline-flex items-center gap-1">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {active && <span>{sort?.dir === 'asc' ? '▲' : '▼'}</span>}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        {/* One <tbody> per top-level task, so a task and its subtasks form one framed group. */}
        {groupRows(table.getRowModel().rows).map((group) => {
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
                      kind={child ? 'child' : row.getCanExpand() ? 'parent' : 'leaf'}
                      expanded={row.getIsExpanded()}
                      continues={i < lastIdx || composerOpen}
                      spineColor={spineColor}
                      accentColor={colored ? color : null}
                      onToggle={() => toggleExpand(row.original.id)}
                      dragHandle={
                        sort ? (
                          <DragHandle
                            disabled
                            title="Spaltensortierung aktiv — zum Verschieben die Sortierung zurücksetzen (Spaltenkopf erneut klicken)"
                          />
                        ) : (
                          <DragHandle {...drag.handleProps(row.original.id)} />
                        )
                      }
                    />
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {composerOpen && (
                <SubtaskAddRow
                  parentTask={head.original}
                  /* Data columns only — the composer supplies its own gutter cell. */
                  colSpan={head.getVisibleCells().length}
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
                  const ids = [task.id, ...children.map((c) => c.id)];
                  const n = children.length;
                  void del({
                    label: `Aufgabe „${task.title}“ + ${n} Unteraufgabe${n === 1 ? '' : 'n'}`,
                    remove: () => Promise.all(ids.map((id) => api.tasks.remove(id))),
                    restore: () => Promise.all(ids.map((id) => api.tasks.restore(id))),
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
  commit: (task: Task, patch: Partial<Task>, label: string) => void;
  commitCustom: (task: Task, colId: number, value: unknown) => void;
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
  onCommit: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(task.title);
  if (editing) {
    return (
      <input
        autoFocus
        className={`w-full min-w-48 ${INLINE_INPUT}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (value.trim() && value !== task.title) onCommit(value.trim());
          else setValue(task.title);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setValue(task.title);
            setEditing(false);
          }
        }}
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

function DueCell({ task, onCommit }: { task: Task; onCommit: (v: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        type="date"
        autoFocus
        defaultValue={task.due_date ?? ''}
        className={INLINE_INPUT}
        onBlur={(e) => {
          setEditing(false);
          const v = e.target.value || null;
          if (v !== task.due_date) onCommit(v);
        }}
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
          const v = value.trim() === '' ? null : value;
          if (v !== (task.comment ?? null)) onCommit(v);
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
  onCommit: (v: unknown) => void;
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

function EditableTextCell({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  if (editing) {
    return (
      <input
        autoFocus
        className={`w-40 ${INLINE_INPUT}`}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (v !== value) onCommit(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setV(value);
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <button
      className="min-w-20 text-left text-sm text-neutral-700 hover:text-neutral-900"
      onClick={() => {
        setV(value);
        setEditing(true);
      }}
    >
      {value || <span className="text-neutral-300">—</span>}
    </button>
  );
}

function EditableDateCell({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        type="date"
        autoFocus
        defaultValue={value}
        className={INLINE_INPUT}
        onBlur={(e) => {
          setEditing(false);
          if (e.target.value !== value) onCommit(e.target.value);
        }}
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
  return (
    <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2">
      <span className="text-neutral-300">＋</span>
      <input
        className="flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-neutral-300"
        placeholder={parent.general ? `Neue allgemeine Aufgabe (${saison}) … (Enter)` : 'Neue Aufgabe … (Enter)'}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
      />
    </div>
  );
}

/** Controlled title input that creates a task and clears on success — shared by the
 *  top add-row and the indented subtask composer. `create` receives the trimmed title. */
function useTaskComposer(create: (title: string) => Promise<unknown>, onAdded: () => Promise<void>) {
  const [title, setTitle] = useState('');
  const submit = async () => {
    const t = title.trim();
    if (!t) return;
    await create(t);
    setTitle('');
    await onAdded();
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
              if (e.key === 'Enter') void submit();
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
