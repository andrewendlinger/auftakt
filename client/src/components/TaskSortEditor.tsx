import { useEffect, useMemo, useRef, useState } from 'react';
import type { TaskSortRule } from '../api/types';
import { arrayMove } from '../lib/arrays';
import { SORTABLE_TASK_COLUMNS, describeSortColumn, type SortRuleState } from '../lib/taskSort';
import { useGlobalColumns } from '../hooks';
import { XIcon } from './icons';
import { Btn, IconButton, ReorderArrows } from './ui';

/**
 * Why a rule is doing nothing. `describeSortColumn` decides the state and `activeSortRules`
 * enforces it (`lib/taskSort.ts`) — both live there so the label and the behaviour cannot drift,
 * which they did: a rule for a *deleted* column read as perfectly normal here while sorting
 * nothing, and a hidden one was marked „(ausgeblendet)" while still ordering the table (WP-32).
 */
const INERT: Record<SortRuleState, string> = {
  active: '',
  hidden: '(ausgeblendet – sortiert nicht)',
  gone: '(entfernt – sortiert nicht)',
};

/**
 * Editor for the automatic task-ordering hierarchy. The list is applied top-to-bottom as a
 * multi-key sort in every task table; each rule sorts by a column, ascending or descending.
 * For Status, "Aufsteigend" means the status option order (Not Started → In Progress → Done),
 * which the user sets on the Status column's options.
 */
export function TaskSortEditor({
  value,
  onChange,
}: {
  value: TaskSortRule[];
  onChange: (v: TaskSortRule[]) => void;
}) {
  const [toAdd, setToAdd] = useState('');
  const columns = useGlobalColumns();
  // Scopes the `[data-rule-row]` lookup `move` uses to put focus back on the row it moved.
  const listRef = useRef<HTMLOListElement>(null);
  const available = useMemo(
    () =>
      SORTABLE_TASK_COLUMNS.filter((c) => !value.some((r) => r.id === c.id)).map((c) => ({
        id: c.id,
        ...describeSortColumn(c.id, columns),
      })),
    [value, columns],
  );

  /**
   * Move a rule, and take its focus with it (RTE-14) — the duty every ▲▼ list carries, and the
   * one this list was missing. Since WP-43 ↑/↓ on a focused arrow *are* the ordinary way to
   * reorder, and without this the second press undoes the first: focus stays on the row position
   * the rule left, which now holds the rule it swapped with, and ↑ sends *that* one back.
   *
   * The restore runs off `value`, not in a `requestAnimationFrame` after `onChange` the way
   * `OptionsEditor` can. That one owns its array as local state and React flushes it
   * synchronously; here the array belongs to the settings cache a level up, so the frame callback
   * beats the commit and reads the pre-move rows — the same reason `CustomColumnManager` waits
   * for its refetch, and the same shape of fix.
   */
  const restore = useRef<{ id: string; dir: -1 | 1 } | null>(null);
  const move = (i: number, dir: -1 | 1) => {
    const next = arrayMove(value, i, dir);
    if (next === value) return;
    restore.current = { id: value[i]!.id, dir };
    onChange(next);
  };
  useEffect(() => {
    const target = restore.current;
    if (!target) return;
    restore.current = null;
    const i = value.findIndex((r) => r.id === target.id);
    const list = listRef.current;
    if (i < 0 || !list) return;
    // Focus the user moved elsewhere in the meantime is left alone.
    const active = document.activeElement;
    if (active && active !== document.body && !list.contains(active)) return;
    const row = list.querySelectorAll<HTMLElement>('[data-rule-row]')[i];
    const arrow = (d: -1 | 1) => row?.querySelector<HTMLButtonElement>(`[data-arrow="${d === -1 ? 'up' : 'down'}"]`);
    // The arrow pointing the way the user was going, unless the move just disabled it at an end.
    const same = arrow(target.dir);
    (same && !same.disabled ? same : arrow(target.dir === -1 ? 1 : -1))?.focus();
  }, [value]);
  const setDir = (i: number, dir: 'asc' | 'desc') =>
    onChange(value.map((r, idx) => (idx === i ? { ...r, dir } : r)));
  const removeAt = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const add = () => {
    if (!toAdd) return;
    onChange([...value, { id: toAdd, dir: 'asc' }]);
    setToAdd('');
  };

  return (
    <div className="space-y-2">
      {value.length === 0 && (
        <p className="rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-400">
          Keine Regel – Aufgaben behalten die selbst gezogene Reihenfolge (erledigte immer unten).
        </p>
      )}
      <ol className="space-y-1" ref={listRef}>
        {value.map((rule, i) => {
          const { label, state } = describeSortColumn(rule.id, columns);
          return (
            <li
              key={rule.id}
              data-rule-row
              className="flex items-center gap-2 rounded-lg bg-neutral-50 px-2 py-1.5 text-sm"
            >
              <ReorderArrows
                first={i === 0}
                last={i === value.length - 1}
                onUp={() => move(i, -1)}
                onDown={() => move(i, 1)}
              />
              <span className="w-4 shrink-0 text-xs font-semibold text-neutral-400">{i + 1}.</span>
              <span className="min-w-0 flex-1 truncate font-medium text-neutral-800">
                {label}
                {state !== 'active' && (
                  <span className="ml-1.5 text-xs font-normal text-neutral-400">{INERT[state]}</span>
                )}
              </span>
              <div className="inline-flex shrink-0 overflow-hidden rounded-lg border border-neutral-300 text-xs">
                {(['asc', 'desc'] as const).map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    onClick={() => setDir(i, dir)}
                    className={`px-2 py-1 transition ${
                      rule.dir === dir
                        ? 'bg-neutral-800 text-white'
                        : 'text-neutral-500 hover:bg-neutral-100'
                    }`}
                  >
                    {dir === 'asc' ? 'Aufsteigend' : 'Absteigend'}
                  </button>
                ))}
              </div>
              <IconButton variant="danger" size="sm" onClick={() => removeAt(i)} title="Entfernen" aria-label="Entfernen">
                <XIcon className="h-3.5 w-3.5" />
              </IconButton>
            </li>
          );
        })}
      </ol>
      {available.length > 0 && (
        <div className="flex gap-2">
          <select
            value={toAdd}
            onChange={(e) => setToAdd(e.target.value)}
            className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-800 outline-none focus:border-neutral-500"
          >
            <option value="">Spalte wählen…</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.state === 'active' ? c.label : `${c.label} ${INERT[c.state]}`}
              </option>
            ))}
          </select>
          <Btn onClick={add} disabled={!toAdd}>
            + Hinzufügen
          </Btn>
        </div>
      )}
    </div>
  );
}
