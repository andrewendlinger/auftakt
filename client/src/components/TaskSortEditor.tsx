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
 *
 * `hidden` is worded for what WP-59 made true: this list resolves against the **season default**,
 * and a page that shows the column anyway *is* ordered by the rule. „sortiert nicht" was the whole
 * truth while `enabled` was the only answer; it is a half-truth now, and the honest form is also
 * the one that tells the user where to look. `gone` is unchanged — a deleted column exists nowhere.
 */
const INERT: Record<SortRuleState, string> = {
  active: '',
  hidden: '(ausgeblendet – sortiert nur auf Seiten, die sie zeigen)',
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
   *
   * **It is a chase, not a one-shot** (#139). A one-shot was this gate's loudest flake: it puts
   * focus back once and is spent, and the commit that undoes it can still be on its way. The
   * settings cache settles over however many commits it takes — the write publishes optimistically,
   * the PATCH answers, and a `GET /api/settings` issued by an *earlier* write's invalidate can land
   * after all of that and disturb the rule for one commit. On a slow runner it does. Each time it
   * does, the arrow the rule is sitting on becomes `disabled` at an end (or its row leaves
   * entirely), Chromium clears focus off it, and the keyboard is back at `<body>` with the moved
   * rule on screen — the honest, if unlikely, defect `check:browser`'s case P reported as
   * `{"row":-1,"arrow":""}`.
   *
   * So the restore stays armed and puts focus back on **every** commit that drops it:
   *
   * - The condition is „focus was dropped", not „the rule's index changed". A superseded body can
   *   leave the rule where it is and still disable its arrow — two rules, ▲ pressed on the second,
   *   focus lands on ▼ at row 0; a body from before the *other* rule existed keeps this one at
   *   index 0 and makes it last, so ▼ disables and focus goes. An index test calls that „nothing
   *   moved" and leaves the keyboard stranded.
   * - A commit that does not carry the rule **at all** keeps the restore armed. Einstellungen
   *   writes in quick succession — add, then turn, then move — so a read overtaken by two writes
   *   answers with an array the rule was never in. Standing down there is the same dead end in a
   *   different shape.
   * - **The user's own pointer or key ends it, at the moment it happens.** A commit cannot tell
   *   „focus is on `<body>` because this list dropped it" from „…because the user clicked an
   *   unfocusable patch of the page", and the difference is the whole of what an armed restore
   *   may do: left armed, it would wait for the next `task_sort` change — a second window
   *   reordering the rules — and pull the keyboard into this card, scrolling the page back to it,
   *   for a change the user did not make in this window. Waiting for a commit to notice is too
   *   late; a `pointerdown` or `keydown` outside the `<ol>` stands the restore down when it
   *   happens. **The arrow's own state cannot decide this** — the sibling window's reorder is
   *   exactly what disables the arrow the restore is holding, so „my arrow went away, this must
   *   be my commit" is true of the case it is meant to exclude. `held` is the second guard, not
   *   the first: it catches focus leaving without any input of the user's at all.
   *
   * It stands down on that input, when focus lands on a real element outside this `<ol>` — which
   * includes „Spalte wählen…" and „+ Hinzufügen", so adding a rule ends the move on its own —
   * when the arrow it holds is still there and still enabled, and in `removeAt`, so removing the
   * moved rule cannot leave a dead id armed against a later re-add of the same column.
   *
   * The other half of not pulling focus back unasked is that this effect barely runs:
   * `useSettingsArray` memoises on the raw value's identity and React Query hands back the
   * *equal* array it already held, so a settings write that changes something else re-renders
   * nothing here. This effect runs when `task_sort` really changed — which is also why the
   * PATCH response, deeply equal to what the write already published, produces no commit of its
   * own between the move and the read that overtakes it.
   */
  const restore = useRef<{ id: string; dir: -1 | 1; held: HTMLButtonElement | null } | null>(null);
  const move = (i: number, dir: -1 | 1) => {
    const next = arrayMove(value, i, dir);
    if (next === value) return;
    // `held` starts as the arrow the press is on — the click focused it, and the commit that
    // lands the rule at an end is what disables it. A press that somehow arrives without focus
    // leaves it null, which reads as „owed" rather than as „the user blurred it".
    const el = document.activeElement;
    restore.current = { id: value[i]!.id, dir, held: el instanceof HTMLButtonElement ? el : null };
    onChange(next);
  };
  // Armed is a ref, so there is no render to key this on — and it needs none: a listener that
  // only ever nulls a ref is cheaper than the re-render that arming as state would cost, and it
  // cannot miss the gesture by being attached one commit late. Capture phase, so a handler that
  // stops propagation cannot hide the gesture from it.
  useEffect(() => {
    const standDown = (e: Event) => {
      const t = e.target;
      if (!(t instanceof Node) || !listRef.current?.contains(t)) restore.current = null;
    };
    document.addEventListener('pointerdown', standDown, true);
    document.addEventListener('keydown', standDown, true);
    return () => {
      document.removeEventListener('pointerdown', standDown, true);
      document.removeEventListener('keydown', standDown, true);
    };
  }, []);
  useEffect(() => {
    const target = restore.current;
    const list = listRef.current;
    if (!target || !list) return;
    const active = document.activeElement;
    if (active && active !== document.body) {
      // Focus the user moved out of this list is left alone, and ends the restore. Inside it,
      // there is nothing to repair — the row is keyed by rule id, so the DOM node travels with
      // the rule and focus travels with the node.
      if (!list.contains(active)) restore.current = null;
      return;
    }
    // Focus is nowhere, and no input of the user's has stood the restore down. The second guard:
    // an arrow still standing there, still enabled, means focus left it some other way.
    const held = target.held;
    if (held && held.isConnected && !held.disabled) {
      restore.current = null;
      return;
    }
    const i = value.findIndex((r) => r.id === target.id);
    // Absent for this commit — an overtaken read from before the rule existed. Wait for the one
    // that has it rather than standing down; `held` is off the DOM meanwhile, which is what keeps
    // the wait from being mistaken for a blur.
    if (i < 0) return;
    const row = list.querySelectorAll<HTMLElement>('[data-rule-row]')[i];
    const arrow = (d: -1 | 1) => row?.querySelector<HTMLButtonElement>(`[data-arrow="${d === -1 ? 'up' : 'down'}"]`);
    // The arrow pointing the way the user was going, unless the move just disabled it at an end.
    const same = arrow(target.dir);
    const next = same && !same.disabled ? same : arrow(target.dir === -1 ? 1 : -1);
    target.held = next ?? null;
    next?.focus();
  }, [value]);
  const setDir = (i: number, dir: 'asc' | 'desc') =>
    onChange(value.map((r, idx) => (idx === i ? { ...r, dir } : r)));
  const removeAt = (i: number) => {
    // The rule the restore is chasing may be this one; a dead id left armed would jump focus
    // onto the same column the day it is added back.
    restore.current = null;
    onChange(value.filter((_, idx) => idx !== i));
  };
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
          {/* `min-w-0` is the whole of what keeps this row inside its card in a narrow window.
              A `<select>`'s automatic minimum width is its *longest option* — here „Priorität
              (ausgeblendet – sortiert nur auf Seiten, die sie zeigen)", 465 px — so as a flex
              item with the default `min-width: auto` it refuses to shrink and pushes
              „+ Hinzufügen" out of the card: measured at 617 px in a 610 px window (WP-64c).
              The list only reaches that width once the columns query has filled the options in,
              which is why the overhang appeared to come and go. Shrinking is what a `<select>`
              does gracefully — it clips its own label — so the row stays usable. */}
          <select
            value={toAdd}
            onChange={(e) => setToAdd(e.target.value)}
            className="min-w-0 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-800 outline-none focus:border-neutral-500"
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
