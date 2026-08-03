import { useMemo, useState } from 'react';
import type { CustomColumn, TaskSortRule } from '../api/types';
import { arrayMove } from '../lib/arrays';
import { MANUAL_SORT_ID, SORTABLE_TASK_COLUMNS } from '../lib/taskSort';
import { useGlobalColumns } from '../hooks';
import { Btn, IconButton, ReorderArrows } from './ui';

/**
 * What to call a sortable column, and whether the user has hidden it.
 *
 * The ids in `SORTABLE_TASK_COLUMNS` are built-in column `key`s, and CLAUDE.md makes the
 * `custom_columns` rows the single source of truth for their names — the ✎ in
 * CustomColumnManager renames a built-in like any other column. Reading the hardcoded labels
 * instead meant the sort editor named a column the task table never did: out of the box the
 * `title` built-in ships as „Aufgabe" while this list said „Titel", and renaming „Fällig" to
 * „Deadline" updated the table header and left the rule reading „Fällig" (CCL-18, TTU-20).
 *
 * A disabled column still sorts — the rule survives hiding the column — but it renders nowhere,
 * so say so rather than leave a rule pointing at something invisible.
 */
function describe(id: string, columns: CustomColumn[]): { label: string; hidden: boolean } {
  const fallback = SORTABLE_TASK_COLUMNS.find((c) => c.id === id)?.label ?? id;
  // „Manuelle Reihenfolge" is not a column; it has no row to be named or hidden by.
  if (id === MANUAL_SORT_ID) return { label: fallback, hidden: false };
  const col = columns.find((c) => c.key === id);
  return { label: col?.name || fallback, hidden: col?.enabled === 0 };
}

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
  const available = useMemo(
    () =>
      SORTABLE_TASK_COLUMNS.filter((c) => !value.some((r) => r.id === c.id)).map((c) => ({
        id: c.id,
        ...describe(c.id, columns),
      })),
    [value, columns],
  );

  const move = (i: number, dir: -1 | 1) => {
    const next = arrayMove(value, i, dir);
    if (next !== value) onChange(next);
  };
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
          Keine Regel – Aufgaben behalten die Standard-Reihenfolge (erledigte immer unten).
        </p>
      )}
      <ol className="space-y-1">
        {value.map((rule, i) => {
          const { label, hidden } = describe(rule.id, columns);
          return (
            <li
              key={rule.id}
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
                {hidden && <span className="ml-1.5 text-xs font-normal text-neutral-400">(ausgeblendet)</span>}
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
              <IconButton variant="danger" size="sm" onClick={() => removeAt(i)} title="Entfernen">
                ✕
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
                {c.hidden ? `${c.label} (ausgeblendet)` : c.label}
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
