import { IconButton, ReorderArrows } from './ui';
import type { CustomColumnOption } from '../api/types';
import { arrayMove } from '../lib/arrays';
import { OPTION_PALETTE } from '../lib/selectOptions';

/**
 * Editable list of coloured options with a native colour picker; one "done" for status.
 * Shared by the task-column manager (`CustomColumnManager`) and the event-type / project-status
 * settings (WP-I). Controlled: it holds no state; every change calls `onChange` with a fresh array.
 */
export function OptionsEditor({
  value,
  onChange,
  allowDone,
  addLabel = '+ Kategorie',
}: {
  value: CustomColumnOption[];
  onChange: (v: CustomColumnOption[]) => void;
  allowDone?: boolean;
  addLabel?: string;
}) {
  const update = (i: number, patch: Partial<CustomColumnOption>) => {
    const setDone = patch.done === true;
    onChange(value.map((o, idx) => (idx === i ? { ...o, ...patch } : setDone ? { ...o, done: false } : o)));
  };
  const removeAt = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  // Reorder: the option order here is the order values appear in the pill dropdown
  // and drives status sorting, so ↑ ↓ lets the user set e.g. new → active → done.
  const move = (i: number, dir: -1 | 1) => {
    const next = arrayMove(value, i, dir);
    if (next !== value) onChange(next);
  };
  const addOption = () =>
    onChange([
      ...value,
      { label: '', value: '', color: OPTION_PALETTE[value.length % OPTION_PALETTE.length]! },
    ]);

  return (
    <div className="space-y-2">
      {value.map((o, i) => (
        <div key={i} className="flex items-center gap-2">
          <ReorderArrows
            first={i === 0}
            last={i === value.length - 1}
            onUp={() => move(i, -1)}
            onDown={() => move(i, 1)}
          />
          <input
            type="color"
            value={o.color}
            onChange={(e) => update(i, { color: e.target.value })}
            className="h-8 w-9 shrink-0 cursor-pointer rounded border border-neutral-300"
            title="Farbe"
          />
          <input
            value={o.label}
            onChange={(e) => update(i, { label: e.target.value })}
            placeholder="Bezeichnung"
            className="flex-1 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm outline-none focus:border-neutral-500"
          />
          {allowDone && (
            <label className="flex shrink-0 items-center gap-1 text-xs text-neutral-500" title="Diese Kategorie gilt als erledigt (rutscht nach unten, wandert ins Archiv).">
              <input type="radio" checked={!!o.done} onChange={() => update(i, { done: true })} />
              erledigt
            </label>
          )}
          <IconButton variant="danger" size="sm" onClick={() => removeAt(i)} title="Entfernen">✕</IconButton>
        </div>
      ))}
      <button type="button" className="text-sm text-neutral-500 hover:text-neutral-800" onClick={addOption}>{addLabel}</button>
    </div>
  );
}

/**
 * The German word for the rows an option list is used by, in both counts — „wird von 1 Termin"
 * vs „wird von 3 Terminen". Dative, because every message that interpolates it is („von …").
 * Same `one`/`many` shape as ArchivePage's `TYPE_LABELS`, and for the same reason.
 */
export interface UsageNoun {
  one: string;
  many: string;
}

/** „3 Terminen" / „1 Termin" — the count with its correctly-inflected noun. */
export function countWithNoun(n: number, noun: UsageNoun): string {
  return `${n} ${n === 1 ? noun.one : noun.many}`;
}

/** value defaults to the (trimmed) label; keep existing values stable so linked data stays linked. */
export function normalizeOptions(options: CustomColumnOption[]): CustomColumnOption[] {
  return options
    .map((o) => {
      const label = o.label.trim();
      const value = (o.value && o.value.trim()) || label;
      return { label, value, color: o.color, ...(o.done ? { done: true } : {}) };
    })
    .filter((o) => o.label);
}
