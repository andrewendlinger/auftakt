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

/** What a save of an option list has to satisfy before it may be persisted. */
export interface OptionRules {
  /** Status column: one option must carry `done`, or done-ness silently moves to another. */
  requireDone?: boolean;
  /** Built-in option columns (Status, Priorität): an empty list can't be undone from the UI. */
  requireNonEmpty?: boolean;
}

/**
 * The single save guard for both `OptionsEditor` call sites — the task-column manager and the
 * Kategorien settings tab. It lives beside `normalizeOptions` rather than in either caller
 * because the invariants are properties of the *option list*, not of the screen editing it:
 * bolted onto one call site, the other one silently corrupts data (TTU-01, RTE-06).
 *
 * Returns a German message naming what is wrong, or null when the draft may be saved.
 */
export function validateOptions(draft: CustomColumnOption[], rules: OptionRules = {}): string | null {
  // Checked against the *draft*, because normalizeOptions ends in `.filter(o => o.label)` — an
  // unnamed row is silently discarded rather than saved. Someone who adds a category, picks its
  // colour and then hits Speichern before typing the name sees the row vanish and assumes the
  // save failed; clearing an existing option's label to retype it deletes it outright (RTE-12).
  const blank = draft.findIndex((o) => !o.label.trim());
  if (blank >= 0) {
    return `Kategorie ${blank + 1} hat keine Bezeichnung — benenne sie oder entferne die Zeile.`;
  }
  const cleaned = normalizeOptions(draft);
  // Emptying a built-in's categories is a one-way door: every pill falls back to the „—"
  // placeholder with an empty dropdown, so no task's status can be changed from any table
  // again — and the editor only takes a *label*, so the original machine values ('active',
  // 'Fertig', …) can never be re-typed. Mirrored server-side (TTU-02).
  if (rules.requireNonEmpty && cleaned.length === 0) {
    return 'Mindestens eine Kategorie ist erforderlich.';
  }
  // `value` is the identity key every consumer resolves an option by, and it is *derived* from
  // the label — so two rows sharing a label collapse onto one stored value. Nothing downstream
  // tolerates that: PillSelect renders `options.find(o => o.value === value)` (first wins) and
  // keys its menu buttons by value (duplicate React keys), rankMap keeps the last, and on the
  // Status column doneValueOf can resolve done-ness to the wrong one of the pair — so tasks in
  // the *other*, still-open category are treated as completed (TTU-09, RTE-07).
  const seen = new Set<string>();
  for (const o of cleaned) {
    if (seen.has(o.value)) {
      return `Die Bezeichnung „${o.label}“ ist doppelt vergeben — jede Kategorie braucht eine eigene.`;
    }
    seen.add(o.value);
  }
  // Never infer the done flag. Promoting whatever option happens to be last made deleting the
  // „Erledigt" category silently mark e.g. „Blockiert" as done: every blocked task struck
  // through, sunk to the bottom, stamped erledigt_am and archived 30 days later (TTU-01).
  if (rules.requireDone && !cleaned.some((o) => o.done)) {
    return 'Markiere eine Kategorie als „erledigt“ — sie steuert Durchstreichen, Sortierung und Archiv.';
  }
  return null;
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
