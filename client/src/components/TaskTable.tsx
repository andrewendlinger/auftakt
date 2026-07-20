import { Fragment, useCallback, useMemo, useState } from 'react';
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
import { doneValueOf, parseColumnOptions, parseCustomValues } from '../api/types';
import { formatDate } from '../lib/dates';
import { withAlpha } from '../lib/colors';
import { SORTABLE_TASK_COLUMNS } from '../lib/taskSort';
import { Markdown } from './Markdown';
import { MarkdownTextarea } from './MarkdownTextarea';
import { ColorSwatchPicker } from './ColorSwatchPicker';
import { TrashIcon } from './icons';
import { ProjectBadge } from './ProjectBadge';
import { PillSelect } from './PillSelect';
import { EmptyState, Btn, IconButton } from './ui';
import { Modal } from './fields';
import { useInvalidateAll, useSettings, useUndoableDelete, resourceUndo } from '../hooks';

/** Shared modern inline-edit input style (soft border, focus ring). */
const INLINE_INPUT =
  'rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-800 outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-900/5';

export interface TaskTableParent {
  artist_id?: number;
  project_id?: number;
  /** Season-wide "Festival" todos: created with neither artist nor project. */
  general?: boolean;
}

/** Muted chip marking a task's scope when it has no project badge (Allgemein / Festival). */
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

function customValueOf(task: Task, colId: number): string {
  const v = parseCustomValues(task.custom_values)[String(colId)];
  return v == null ? '' : String(v);
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
 * Order tasks by a multi-key hierarchy (Settings → Automatische Sortierung, or a single
 * header-click override), reading each key via a precomputed `getValue` accessor. Done tasks
 * always sink to the bottom first, regardless of the rules, so the "done at the bottom +
 * crossed out" baseline survives any configuration. An empty rule list leaves the server
 * order (priority → due, done last) untouched.
 */
function sortTasks(
  tasks: Task[],
  rules: TaskSortRule[],
  getValue: (task: Task, id: string) => string | number,
  doneValue: string,
): Task[] {
  if (rules.length === 0) return tasks;
  return [...tasks].sort((a, b) => {
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
  });
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
  const { data: settings } = useSettings();
  const [sort, setSort] = useState<SortState>(null);
  // Effective ordering: a header click (`sort`) is a temporary single-key override; otherwise
  // follow the configured automatic hierarchy from Settings (empty → leave server order).
  const activeRules = useMemo(
    () => (sort ? [sort] : settings?.task_sort ?? []),
    [sort, settings?.task_sort],
  );
  // Subtask UI state: collapsed parents, the parent currently getting a new subtask,
  // and the parent awaiting a delete-with-children confirmation.
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [addingChildFor, setAddingChildFor] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ task: Task; children: Task[] } | null>(null);

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
    async (id: number, patch: Partial<Task> | { custom_values: Record<string, unknown> }) => {
      await api.tasks.update(id, patch as Partial<Task>);
      await invalidate();
    },
    [invalidate],
  );

  const commitCustom = useCallback(
    async (task: Task, colId: number, value: unknown) => {
      const cv = parseCustomValues(task.custom_values);
      cv[String(colId)] = value;
      await commit(task.id, { custom_values: cv });
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
    () =>
      [...customColumns]
        .filter((c) => c.enabled !== 0)
        // Global columns (incl. built-ins) first, then project columns; each by sort_order.
        .sort(
          (a, b) =>
            (a.scope === 'global' ? 0 : 1) - (b.scope === 'global' ? 0 : 1) ||
            a.sort_order - b.sort_order ||
            a.id - b.id,
        ),
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
            {t.project_id && t.project_code && (
              <ProjectBadge
                code={t.project_code}
                projectId={t.project_id}
                artistColor={t.artist_color}
                projectColor={t.project_color}
                to={`/project/${t.project_id}`}
              />
            )}
            {/* Artist page: an artist-level todo (no project) is "Allgemein". */}
            {showProject && !t.project_id && <ScopeChip label="Allgemein" tone="neutral" />}
            {/* Dashboard: a todo with no artist and no project is season-wide "Festival". */}
            {showAssignment && seasonWide && <ScopeChip label="Festival" tone="festival" />}
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
              doneValue={doneValue}
              statusOptions={statusOptions}
              priorityOptions={priorityOptions}
              commit={commit}
              commitCustom={commitCustom}
            />
          );
          if (!isTitle) return inner;
          // Title cell for the subtask hierarchy: disclosure toggle + indent + a done/total badge.
          const kids = childrenByParent.get(row.original.id) ?? [];
          const doneKids = kids.filter((k) => k.status === doneValue).length;
          return (
            <div className="flex items-start gap-1" style={{ paddingLeft: row.depth * 22 }}>
              {row.getCanExpand() ? (
                <IconButton
                  size="sm"
                  title={row.getIsExpanded() ? 'Einklappen' : 'Ausklappen'}
                  onClick={() => toggleExpand(row.original.id)}
                >
                  {row.getIsExpanded() ? '▾' : '▸'}
                </IconButton>
              ) : (
                <span className="mt-1 w-7 shrink-0 text-center leading-none text-neutral-300">
                  {row.depth > 0 ? '└' : ''}
                </span>
              )}
              <div className="min-w-0 flex-1">{inner}</div>
              {kids.length > 0 && (
                <span
                  className="mt-0.5 shrink-0 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-500"
                  title={`${doneKids} von ${kids.length} Unteraufgaben erledigt`}
                >
                  {doneKids}/{kids.length}
                </span>
              )}
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
          )}
          <ColorSwatchPicker
            value={row.original.color}
            onChange={(color) => commit(row.original.id, { color })}
          />
          <IconButton variant="danger" size="sm" title="Löschen" onClick={() => requestDelete(row.original)}>
            <TrashIcon className="h-4 w-4" />
          </IconButton>
        </div>
      ),
    });
    return cols;
  }, [visibleCols, showAssignment, showProject, doneValue, statusOptions, priorityOptions, commit, commitCustom, childrenByParent, toggleExpand, requestDelete]);

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
  const toggleSort = (id: string) => {
    if (!sortableIds.has(id)) return;
    setSort((s) => (s?.id === id ? { id, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { id, dir: 'asc' }));
  };

  const defaultStatus = statusOptions[0]?.value ?? 'new';

  return (
    <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
      {/* Add row at the top so new tasks don't require scrolling past the done items. */}
      {parent && <AddTaskRow parent={parent} defaultStatus={defaultStatus} onAdded={invalidate} />}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-400">
            {table.getHeaderGroups()[0]?.headers.map((h) => {
              const id = h.column.id;
              const active = sort?.id === id;
              return (
                <th
                  key={h.id}
                  className={`px-3 py-2 font-semibold ${sortableIds.has(id) ? 'cursor-pointer select-none hover:text-neutral-600' : ''}`}
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
        <tbody>
          {table.getRowModel().rows.map((row) => {
            const done = row.original.status === doneValue;
            const color = row.original.color;
            const colored = !done && !!color;
            const child = row.depth > 0;
            const tint = done
              ? 'bg-neutral-50/60 text-neutral-400'
              : colored
                ? ''
                : child
                  ? 'bg-neutral-50/40 hover:bg-neutral-50/70'
                  : 'hover:bg-neutral-50/40';
            return (
              <Fragment key={row.id}>
                <tr
                  data-task-id={row.original.id}
                  data-depth={row.depth}
                  className={`group border-b border-neutral-50 align-top ${tint}`}
                  style={colored ? { background: withAlpha(color, 0.16), boxShadow: `inset 3px 0 0 0 ${color}` } : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
                {row.depth === 0 && addingChildFor === row.original.id && (
                  <SubtaskAddRow
                    parentTask={row.original}
                    colSpan={row.getVisibleCells().length}
                    defaultStatus={defaultStatus}
                    onAdded={invalidate}
                    onClose={() => setAddingChildFor(null)}
                  />
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {tasks.length === 0 && <div className="p-3"><EmptyState>Keine Aufgaben.</EmptyState></div>}

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
  doneValue,
  statusOptions,
  priorityOptions,
  commit,
  commitCustom,
}: {
  task: Task;
  col: CustomColumn;
  doneValue: string;
  statusOptions: CustomColumnOption[];
  priorityOptions: CustomColumnOption[];
  commit: (id: number, patch: Partial<Task>) => void;
  commitCustom: (task: Task, colId: number, value: unknown) => void;
}) {
  if (col.kind === 'builtin') {
    switch (col.key) {
      case 'status':
        return (
          <PillSelect value={task.status} options={statusOptions} onChange={(v) => commit(task.id, { status: v })} />
        );
      case 'title':
        return <TitleCell task={task} doneValue={doneValue} onCommit={(v) => commit(task.id, { title: v })} />;
      case 'priority':
        return (
          <PillSelect
            value={task.priority}
            options={priorityOptions}
            placeholder="Priorität"
            onChange={(v) => commit(task.id, { priority: v })}
          />
        );
      case 'due':
        return <DueCell task={task} onCommit={(v) => commit(task.id, { due_date: v })} />;
      case 'comment':
        return <CommentCell task={task} onCommit={(v) => commit(task.id, { comment: v })} />;
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
  doneValue,
  onCommit,
}: {
  task: Task;
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
      className={`min-w-48 max-w-md text-left ${task.status === doneValue ? 'line-through' : 'font-medium text-neutral-800'}`}
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
      <MarkdownTextarea
        autoFocus
        value={value}
        onChange={setValue}
        className={`min-h-24 w-full min-w-64 resize-y ${INLINE_INPUT}`}
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
  onAdded,
}: {
  parent: TaskTableParent;
  defaultStatus: string;
  onAdded: () => Promise<void>;
}) {
  const { title, setTitle, submit } = useTaskComposer(
    (title) =>
      api.tasks.create({
        title,
        artist_id: parent.artist_id ?? null,
        project_id: parent.project_id ?? null,
        priority: 'mittel',
        status: defaultStatus,
      }),
    onAdded,
  );
  return (
    <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2">
      <span className="text-neutral-300">＋</span>
      <input
        className="flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-neutral-300"
        placeholder={parent.general ? 'Neue allgemeine Aufgabe (Festival) … (Enter)' : 'Neue Aufgabe … (Enter)'}
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

/** Indented inline composer for a subtask, injected under its parent row while adding. */
function SubtaskAddRow({
  parentTask,
  colSpan,
  defaultStatus,
  onAdded,
  onClose,
}: {
  parentTask: Task;
  colSpan: number;
  defaultStatus: string;
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
        priority: 'mittel',
        status: defaultStatus,
      }),
    onAdded,
  );
  return (
    <tr className="border-b border-neutral-50 bg-neutral-50/40">
      <td colSpan={colSpan} className="px-3 py-1.5">
        <div className="flex items-center gap-2" style={{ paddingLeft: 22 }}>
          <span className="w-4 shrink-0 text-neutral-300">└</span>
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
