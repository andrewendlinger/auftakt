import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Label, TextInput, Select, onEnterKey } from './fields';
import { Btn, IconButton, ReorderArrows } from './ui';
import { PencilIcon, TrashIcon } from './icons';
import { api } from '../api/client';
import type {
  CustomColumn,
  CustomColumnOption,
  CustomColumnType,
  CustomColumnUpdate,
  ID,
  OptionUsage,
  ReassignField,
} from '../api/types';
import { parseColumnOptions } from '../api/types';
import { arrayMove } from '../lib/arrays';
import { dayCount } from '../lib/dates';
import { colId, columnVisible } from '../lib/taskColumns';
import { OPTION_PALETTE } from '../lib/selectOptions';
import { rovingItem, useRovingFocus } from '../lib/rovingFocus';
import {
  OptionsEditor,
  countWithNoun,
  normalizeOptions,
  removedOptions,
  validateOptions,
} from './OptionsEditor';
import { OptionRemovalDialog, type OptionRemoval } from './OptionRemovalDialog';
import {
  useArtistNoun,
  useInvalidateAll,
  useOptionUsage,
  useRetention,
  useUndoableDelete,
  resourceUndo,
  type ColumnOwner,
  type EntityColumnsStore,
} from '../hooks';

/**
 * A handful of common symbols; users can also type any emoji into the free field.
 *
 * Named, because the buttons carry nothing but the emoji: a grid of bare glyphs reads as nothing
 * at all to a screen reader, and 🎼 against 🎵 is not self-evident by sight either. The names are
 * what the symbol is *for* here (💶 Honorar, ✈️ Flug), not what the glyph depicts — this is a
 * column header, so „Erledigt" helps where „Häkchen" does not.
 *
 * The instrument run is WP-38: the customer asked for music symbols and reached the picker in the
 * note editor instead, which had a real bug. These were fine, just thin.
 */
const ICON_PRESETS: ReadonlyArray<{ icon: string; name: string }> = [
  { icon: '👤', name: 'Person' },
  { icon: '👥', name: 'Gruppe' },
  { icon: '📞', name: 'Telefon' },
  { icon: '📧', name: 'E-Mail' },
  { icon: '✅', name: 'Erledigt' },
  { icon: '⭐', name: 'Stern' },
  { icon: '📅', name: 'Termin' },
  { icon: '🎵', name: 'Musik' },
  { icon: '🎸', name: 'Gitarre' },
  { icon: '🎤', name: 'Mikrofon' },
  { icon: '🎼', name: 'Noten' },
  { icon: '🎹', name: 'Klavier' },
  { icon: '🥁', name: 'Schlagzeug' },
  { icon: '🎻', name: 'Geige' },
  { icon: '🎺', name: 'Trompete' },
  { icon: '🎫', name: 'Ticket' },
  { icon: '💶', name: 'Honorar' },
  { icon: '📝', name: 'Notiz' },
  { icon: '📌', name: 'Pin' },
  { icon: '🏨', name: 'Hotel' },
  { icon: '🚗', name: 'Auto' },
  { icon: '✈️', name: 'Flug' },
];

/**
 * What picking „Auswahl" puts in the Kategorien editor, so the user has something to rename
 * rather than an empty list. Doubles as the baseline `AddColumnForm`'s `dirty` compares against:
 * these two rows appearing is the app's doing, editing them is the user's.
 */
const SEED_OPTIONS: CustomColumnOption[] = [
  { label: 'offen', value: 'offen', color: OPTION_PALETTE[0]! },
  { label: 'fertig', value: 'fertig', color: OPTION_PALETTE[2]! },
];

const TYPE_LABEL: Record<string, string> = {
  status: 'Status', title: 'Text', priority: 'Auswahl', due: 'Datum', comment: 'Text',
  text: 'Text', date: 'Datum', checkbox: 'Checkbox', select: 'Auswahl',
  created: 'Zeitstempel', updated: 'Zeitstempel',
};

/** Columns whose options are editable colored categories. */
function hasOptions(col: CustomColumn): boolean {
  return col.type === 'select' || col.type === 'status' || col.type === 'priority';
}

/**
 * Where a column's option values are actually stored on the task rows — the built-ins bind to
 * real `tasks` fields through `key`, custom „Auswahl" columns to the `custom_values` blob. This
 * is what the usage count is read from and what a reassignment rewrites.
 */
function optionStore(col: CustomColumn): { field: ReassignField; columnId?: ID } | null {
  if (col.kind === 'builtin') {
    if (col.key === 'status') return { field: 'task_status' };
    if (col.key === 'priority') return { field: 'task_priority' };
    return null;
  }
  return col.type === 'select' ? { field: 'custom_column', columnId: col.id } : null;
}

function countsFor(
  usage: OptionUsage | undefined,
  store: { field: ReassignField; columnId?: ID } | null,
): Record<string, number> {
  if (!usage || !store) return {};
  if (store.field === 'task_status') return usage.task_status;
  if (store.field === 'task_priority') return usage.task_priority;
  return usage.custom_columns[String(store.columnId)] ?? {};
}

/** Every option-carrying column here lives on tasks, so the count is always Aufgaben. */
const TASK_NOUN = { one: 'Aufgabe', many: 'Aufgaben' };

/** A pending destructive column action, awaiting its dialog. `used` matters for `delete` only. */
interface ColumnConfirm {
  kind: 'hide' | 'delete';
  col: CustomColumn;
  used: number;
}

/**
 * The scope group this dialog manages, and the German word for it. `undefined` is the settings
 * page, which manages the global set; an artist or project page manages its own and shows the
 * globals read-only (WP-51).
 */
function ownerLabel(scope: ColumnOwner['scope'], artistNoun: string): string {
  return scope === 'artist' ? `${artistNoun}-Spalten` : 'Projekt-Spalten';
}

export function CustomColumnManager({
  columns,
  owner,
  entityColumns,
  onClose,
}: {
  columns: CustomColumn[];
  owner?: ColumnOwner;
  /**
   * This page's own visibility store (WP-59). Present exactly when `owner` is: the Einstellungen
   * arm manages the season default itself and has no page to depart from.
   */
  entityColumns?: EntityColumnsStore;
  onClose: () => void;
}) {
  const invalidate = useInvalidateAll();
  const del = useUndoableDelete();
  const artistNoun = useArtistNoun();
  const { usage } = useOptionUsage();
  const { purgeAfterDays } = useRetention();
  const [editing, setEditing] = useState<CustomColumn | null>(null);
  const [confirming, setConfirming] = useState<ColumnConfirm | null>(null);
  // Everything else in this dialog persists on click; the only unsaved input that Escape or a
  // backdrop click can throw away is what has been typed into the „Neue Spalte" form below.
  const [formDirty, setFormDirty] = useState(false);
  // Scopes the `[data-column-row]` lookup the effect below uses to put focus back on a moved row,
  // and the row it is waiting for.
  const listRef = useRef<HTMLUListElement>(null);
  const restoreFocus = useRef<{ id: ID; dir: -1 | 1 } | null>(null);

  // On an entity page only that page's own columns are *configured* here — renamed, reordered,
  // deleted. The globals below are shown too, and since WP-59 they can be shown or hidden for
  // this page; everything else about them still belongs to Einstellungen.
  const managed = useMemo(
    () =>
      [...columns]
        .filter((c) => c.scope === (owner?.scope ?? 'global'))
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
    [columns, owner],
  );
  const globals = useMemo(
    () => (owner ? [...columns].filter((c) => c.scope === 'global').sort((a, b) => a.sort_order - b.sort_order) : []),
    [columns, owner],
  );
  const overrides = entityColumns?.overrides ?? {};

  // One transactional renumber rather than two sequential swaps: if the second PATCH failed,
  // both rows kept the same sort_order and the `a.id` tiebreak above silently froze the ▲/▼
  // buttons for that column. `managed` is a single scope group, so renumbering it from 0 leaves
  // it sharing ordinals with the other group — every consumer orders through `compareColumns`,
  // which sorts by scope first, so that overlap can't interleave them (TTU-21).
  //
  // Focus then follows the row, as in `OptionsEditor.move` (RTE-14). Rows are keyed by `c.id`, so
  // React moves the DOM node and focus normally travels with it — but the press that lands a
  // column at an end disables the very arrow it was pressed on, the browser blurs it, and focus
  // falls to <body>. Keyboard reordering dead-ended one press before it finished, which the
  // dialog opening on that arrow (WP-42) made the ordinary way to use it.
  const move = async (col: CustomColumn, dir: -1 | 1) => {
    const next = arrayMove(managed, managed.findIndex((c) => c.id === col.id), dir);
    if (next === managed) return;
    await api.customColumns.reorder(next.map((c) => c.id));
    restoreFocus.current = { id: col.id, dir };
    await invalidate();
  };

  /**
   * Put focus back on the row `move` just moved, once the new order is actually in the DOM.
   *
   * `OptionsEditor` can do this in a `requestAnimationFrame` right after its `onChange`, because
   * that is a discrete event and React flushes it synchronously. Here the order comes back from
   * the server, so the re-render happens in an async continuation that a frame callback can beat:
   * the rAF then read the *old* row — arrow not disabled yet — focused it, and the commit that
   * followed disabled it and dropped focus to <body>, which is the exact failure this repairs.
   * Running off `managed` instead waits for the commit by construction.
   *
   * Focus the user moved elsewhere while the PATCH was in flight is left alone, the same rule
   * `Modal`'s close-restore follows.
   *
   * **Still a one-shot, deliberately** — its twin in `TaskSortEditor` is not. That one chases the
   * rule across every commit since #139, because a `GET /api/settings` overtaken by a newer write
   * put the rule back for one commit and spent the restore. The column list is the same shape and
   * the same exposure, and it has never once been seen doing it; changing a second reorder surface
   * on that reasoning alone is not what the freeze is for. If it ever flakes, the fix is written
   * out over there.
   */
  useEffect(() => {
    const target = restoreFocus.current;
    if (!target) return;
    restoreFocus.current = null;
    const i = managed.findIndex((c) => c.id === target.id);
    const list = listRef.current;
    if (i < 0 || !list) return;
    const active = document.activeElement;
    if (active && active !== document.body && !list.contains(active)) return;
    const row = list.querySelectorAll<HTMLElement>('[data-column-row]')[i];
    const arrow = (d: -1 | 1) => row?.querySelector<HTMLButtonElement>(`[data-arrow="${d === -1 ? 'up' : 'down'}"]`);
    // The arrow pointing the way the user was going, unless the move just disabled it at an end.
    const same = arrow(target.dir);
    (same && !same.disabled ? same : arrow(target.dir === -1 ? 1 : -1))?.focus();
  }, [managed]);

  const setEnabled = async (col: CustomColumn, enabled: 0 | 1) => {
    setConfirming(null);
    await api.customColumns.update(col.id, { enabled });
    await invalidate();
  };

  const toggleEnabled = (col: CustomColumn) => {
    // Showing a column again is harmless; hiding one asks first.
    if (!col.enabled) return setEnabled(col, 1);
    setConfirming({ kind: 'hide', col, used: 0 });
  };

  /**
   * The same toggle for a global column **on this page** (WP-59) — one entry in this entity's
   * `task_columns` map rather than a write to the column itself.
   *
   * No confirmation, unlike `toggleEnabled` above, and the difference is what is at stake: that
   * one hides a column everywhere in the season, this one changes what one page shows and is
   * undone by clicking it again. A dialog in front of a view toggle would be noise.
   */
  const toggleHere = (col: CustomColumn) => {
    void entityColumns?.setVisible(col, !columnVisible(col, overrides));
  };

  const remove = (col: CustomColumn) => {
    // Counted across ALL tasks with no project filter, because that is exactly the set the
    // delete destroys. The old count filtered a project column's tasks by `project_id`, but
    // MoveTaskDialog deliberately keeps those values on a task moved elsewhere („bleiben
    // gespeichert, sind am neuen Ort aber nicht sichtbar"), so it reported 0 uses and showed
    // the harmless prompt while the retained values became permanently unreachable (TTU-10).
    const used = Object.values(usage?.custom_columns[String(col.id)] ?? {}).reduce((a, b) => a + b, 0);
    setConfirming({ kind: 'delete', col, used });
  };

  const confirmDelete = async (col: CustomColumn) => {
    setConfirming(null);
    // On the undo path like every other delete in the app: an undo toast now, and the row in
    // the Archiv trash for 30 days after that. Previously a mis-click here removed a column
    // used across the whole season with no recovery short of restoring a backup (TTU-25).
    await del({ label: `Spalte „${col.name}“`, ...resourceUndo(api.customColumns, col.id) });
  };

  return (
    <Modal title="Spalten verwalten" onClose={onClose} wide dirty={formDirty}>
      <div className="space-y-5">
        {globals.length > 0 && (
          <div>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Globale Spalten
              </div>
              {/* The way back to „diese Seite folgt der Saison-Vorgabe" in one click — the whole
                  map, not one entry, so it reads as the state it restores rather than as an undo.
                  Offered only while there is something to reset (`task_columns` is not NULL). */}
              {entityColumns?.hasOwn && (
                <button
                  className="rounded-lg px-2 py-0.5 text-xs text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700"
                  onClick={() => void entityColumns.reset()}
                >
                  Auf Saison-Vorgabe zurücksetzen
                </button>
              )}
            </div>
            <p className="mb-3 text-xs text-neutral-400">
              Hier nur ein- und ausblenden — für diese Seite. Umbenennen, sortieren und die
              Vorgabe für alle Seiten bleiben in Einstellungen.
            </p>
            <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl ring-1 ring-neutral-100">
              {globals.map((c) => (
                <ColumnRow
                  key={c.id}
                  col={c}
                  visible={columnVisible(c, overrides)}
                  // „abweichend" rather than a second button: the toggle is already the way back,
                  // and this is the one thing the row cannot show by itself — that what is on
                  // screen is this page's decision and not the season's.
                  overridden={overrides[colId(c)] !== undefined}
                  onToggle={() => toggleHere(c)}
                />
              ))}
            </ul>
          </div>
        )}

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            {owner ? ownerLabel(owner.scope, artistNoun) : 'Spalten'}
          </div>
          <p className="mb-3 text-xs text-neutral-400">
            {owner
              ? 'Diese Spalten gibt es nur auf dieser Seite. Reihenfolge mit ↑ ↓ ändern; aus- und einblenden, umbenennen und löschen ebenfalls hier.'
              : 'Reihenfolge mit ↑ ↓ ändern. „Status“ und „Aufgabe“ sind fest; andere Spalten lassen sich aus- und einblenden, umbenennen und (eigene) löschen. Einzelne Seiten können davon abweichen.'}
          </p>
          {managed.length === 0 ? (
            <div className="text-sm text-neutral-400">Noch keine Spalten.</div>
          ) : (
            <ul ref={listRef} className="divide-y divide-neutral-100 overflow-hidden rounded-xl ring-1 ring-neutral-100">
              {managed.map((c, i) => (
                <ColumnRow
                  key={c.id}
                  col={c}
                  visible={columnVisible(c, overrides)}
                  first={i === 0}
                  last={i === managed.length - 1}
                  onUp={() => move(c, -1)}
                  onDown={() => move(c, 1)}
                  onToggle={() => toggleEnabled(c)}
                  onEdit={() => setEditing(c)}
                  onRemove={() => remove(c)}
                />
              ))}
            </ul>
          )}
        </div>

        <AddColumnForm
          owner={owner}
          nextSort={Math.max(-1, ...managed.map((c) => c.sort_order)) + 1}
          onAdded={invalidate}
          onDirtyChange={setFormDirty}
        />
      </div>

      {editing && <ColumnEditModal col={editing} onClose={() => setEditing(null)} onSaved={invalidate} />}
      {/* The app's own Modal, not window.confirm: in Electron that renders OS chrome with
          English „OK/Cancel" buttons and blocks the renderer thread, and TaskTable already
          confirms its *less* destructive task delete through a styled German dialog. A real
          dialog can also offer „Nur ausblenden", which a confirm string never could (TTU-28). */}
      {confirming?.kind === 'hide' && (
        <Modal
          title={`Spalte „${confirming.col.name}“ ausblenden`}
          onClose={() => setConfirming(null)}
          footer={
            <>
              <Btn onClick={() => setConfirming(null)}>Abbrechen</Btn>
              <Btn variant="primary" onClick={() => void setEnabled(confirming.col, 0)}>
                Ausblenden
              </Btn>
            </>
          }
        >
          <p className="text-sm text-neutral-600">
            Die vorhandenen Werte bleiben erhalten und die Spalte kann jederzeit wieder
            eingeblendet werden.
          </p>
        </Modal>
      )}
      {confirming?.kind === 'delete' && (
        <Modal
          title={`Spalte „${confirming.col.name}“ löschen`}
          onClose={() => setConfirming(null)}
          footer={
            <>
              <Btn onClick={() => setConfirming(null)}>Abbrechen</Btn>
              {confirming.col.enabled ? (
                <Btn onClick={() => void setEnabled(confirming.col, 0)}>Nur ausblenden</Btn>
              ) : null}
              <Btn variant="danger" onClick={() => void confirmDelete(confirming.col)}>
                Löschen
              </Btn>
            </>
          }
        >
          <p className="text-sm text-neutral-600">
            {confirming.used > 0
              ? `Die Spalte enthält Werte in ${countWithNoun(confirming.used, TASK_NOUN)}. Beim Löschen gehen diese Werte verloren.`
              : 'Die Spalte enthält noch keine Werte.'}
          </p>
          <p className="mt-2 text-sm text-neutral-500">
            Gelöschte Spalten liegen {dayCount(purgeAfterDays)} im Papierkorb und lassen sich im
            Archiv wiederherstellen.
          </p>
        </Modal>
      )}
    </Modal>
  );
}

/**
 * One row of either list. The four callbacks are optional and their absence *is* the read-only
 * arm: on an entity page a global column may be shown or hidden for that page and nothing else,
 * so it arrives with `onToggle` alone and renders no arrows, no ✎ and no 🗑 (WP-59).
 *
 * `visible` is the effective state — the season default or this page's departure from it — and is
 * therefore passed rather than read off `col.enabled`, which is only half the answer now.
 */
function ColumnRow({
  col,
  visible,
  overridden,
  first,
  last,
  onUp,
  onDown,
  onToggle,
  onEdit,
  onRemove,
}: {
  col: CustomColumn;
  visible: boolean;
  /** This page departs from the season default for this column — shown as a badge. */
  overridden?: boolean;
  first?: boolean;
  last?: boolean;
  onUp?: () => void;
  onDown?: () => void;
  onToggle: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  const isBuiltin = col.kind === 'builtin';
  const locked = isBuiltin && col.deletable === 0; // Status & Aufgabe
  const options = hasOptions(col) ? parseColumnOptions(col.options) : [];
  return (
    <li
      data-column-row
      className={`flex items-center gap-2 px-2 py-1.5 text-sm transition ${
        isBuiltin ? 'bg-sky-50/70 hover:bg-sky-100/60' : 'hover:bg-neutral-50'
      } ${visible ? '' : 'opacity-50'}`}
    >
      {onUp && onDown && (
        <ReorderArrows first={first ?? false} last={last ?? false} onUp={onUp} onDown={onDown} />
      )}
      <div className="min-w-0 flex-1">
        <span className="font-medium text-neutral-800">
          {col.icon && <span className="mr-1">{col.icon}</span>}
          {col.name}
        </span>
        <span className="ml-2 text-xs text-neutral-400">
          {TYPE_LABEL[col.type] ?? col.type}
          {options.length > 0 && ` · ${options.length}`}
        </span>
        {options.length > 0 && (
          <span className="ml-2 inline-flex gap-1 align-middle">
            {options.slice(0, 6).map((o) => (
              <span key={o.value} className="h-2.5 w-2.5 rounded-full" style={{ background: o.color }} title={o.label} />
            ))}
          </span>
        )}
        {isBuiltin && (
          <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-sky-700">
            System
          </span>
        )}
        {locked && (
          <span className="ml-1 align-middle text-xs text-neutral-400" title="Feste Spalte – kann nicht entfernt werden">
            🔒
          </span>
        )}
        {overridden && (
          <span
            className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-neutral-500"
            title="Weicht auf dieser Seite von der Saison-Vorgabe ab"
          >
            abweichend
          </span>
        )}
      </div>
      {!locked && (
        <button
          className="rounded-lg px-2 py-1 text-xs text-neutral-500 transition hover:bg-neutral-200"
          onClick={onToggle}
          title={visible ? 'Ausblenden' : 'Einblenden'}
        >
          {visible ? '👁 sichtbar' : '🚫 aus'}
        </button>
      )}
      {onEdit && (
        <IconButton size="sm" onClick={onEdit} title="Bearbeiten">
          <PencilIcon className="h-3.5 w-3.5" />
        </IconButton>
      )}
      {onRemove && col.kind === 'custom' ? (
        <IconButton variant="danger" size="sm" onClick={onRemove} title="Löschen">
          <TrashIcon className="h-4 w-4" />
        </IconButton>
      ) : onEdit ? (
        <span className="w-7" />
      ) : null}
    </li>
  );
}

/* ---------- edit an existing column (name + colored options) ---------- */

function ColumnEditModal({
  col,
  onClose,
  onSaved,
}: {
  col: CustomColumn;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(col.name);
  const [icon, setIcon] = useState(col.icon ?? '');
  const [options, setOptions] = useState<CustomColumnOption[]>(parseColumnOptions(col.options));
  const [busy, setBusy] = useState(false);
  // A ref, not `busy`: „Enter saves" reaches `save` directly, and a repeat-key burst inside one
  // tick reads the same stale `false` (TTU-24). This is the double-fire guard; `busy` only
  // disables buttons for the length of the request, and both clear in the same `finally`.
  const inFlight = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, setPending] = useState<OptionRemoval[] | null>(null);
  const { usage, ready } = useOptionUsage();
  const editableOptions = hasOptions(col);
  const allowDone = col.type === 'status';
  const before = useMemo(() => parseColumnOptions(col.options), [col.options]);
  const store = optionStore(col);
  const counts = countsFor(usage, store);

  // Validated live rather than on click, so the disabled „Speichern" always comes with the
  // reason next to the rows causing it — including when the column was already in a bad state
  // (a legacy Status column whose options predate the `done` flag).
  // A user-added „Auswahl" column may legitimately still be empty; a built-in one may not.
  const problem = editableOptions
    ? validateOptions(options, { requireDone: allowDone, requireNonEmpty: col.kind === 'builtin' })
    : null;

  /**
   * Save, then move the rows of every deleted category over. Reassigning *after* the PATCH is
   * deliberate: the server derives `erledigt_am` from whichever Status option carries `done`,
   * so a category that is only becoming „erledigt" with this very save has to be on disk first.
   */
  const persist = async (mapping: Array<{ from: string; to: string }>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const patch: CustomColumnUpdate = { name: name.trim(), icon: icon.trim() || null };
      if (editableOptions) patch.options = normalizeOptions(options);
      await api.customColumns.update(col.id, patch);
      for (const m of mapping) {
        if (store) await api.reassignOption({ ...store, ...m });
      }
      await onSaved();
      onClose();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const save = async () => {
    if (busy || !name.trim() || problem || !ready) return;
    setSaveError(null);
    if (!editableOptions || !store) return persist([]);
    const cleaned = normalizeOptions(options);
    // Deleting a category leaves every task still holding it pointing at a value nothing
    // resolves — a grey „—" pill, no place in the status sort, and for Status no recognition by
    // doneValueOf, so the task un-archives. Count them and ask where they go (TTU-34, RTE-06).
    const removals = removedOptions(before, cleaned)
      .map((option) => ({ option, count: counts[option.value] ?? 0 }))
      .filter((r) => r.count > 0);
    if (removals.length === 0) return persist([]);
    if (cleaned.length === 0) {
      setSaveError('Es muss eine Kategorie übrig bleiben, in die die Aufgaben verschoben werden können.');
      return;
    }
    setPending(removals);
  };

  const message = problem ?? saveError;
  // Compared against what the dialog opened with (`before` exists for the removal check and is
  // exactly that snapshot), so reverting an edit by hand also clears the question (TTU-17).
  const dirty =
    name !== col.name ||
    icon !== (col.icon ?? '') ||
    (editableOptions && JSON.stringify(options) !== JSON.stringify(before));
  return (
    <Modal
      title={`„${col.name}“ bearbeiten`}
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
          <Btn onClick={onClose}>Abbrechen</Btn>
          {/* Gated on `ready`: an empty usage map would read as „nichts benutzt diese Kategorie". */}
          <Btn variant="primary" onClick={save} disabled={busy || !!problem || !ready}>Speichern</Btn>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label>Name</Label>
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onEnterKey(() => void save())}
          />
        </div>
        <div>
          <Label>Symbol (optional)</Label>
          <IconPicker value={icon} onChange={setIcon} onEnter={() => void save()} />
        </div>
        {editableOptions && (
          <div>
            <Label>Kategorien</Label>
            <OptionsEditor value={options} onChange={setOptions} allowDone={allowDone} />
            {message && <p className="mt-2 text-sm text-amber-700">{message}</p>}
          </div>
        )}
      </div>
      {pending && (
        <OptionRemovalDialog
          removals={pending}
          targets={normalizeOptions(options)}
          noun={TASK_NOUN}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={(mapping) => void persist(mapping)}
        />
      )}
    </Modal>
  );
}

/** Emoji/symbol picker: a preset grid plus a free field for any other emoji. */
function IconPicker({
  value,
  onChange,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  /** „Enter saves" for the free field — same contract as `ColorField`'s `onEnter`. */
  onEnter?: () => void;
}) {
  const roving = useRovingFocus();
  // The grid is one tab stop; a custom emoji from the field below matches no preset, so „kein
  // Symbol" holds it then. The ref goes on the grid and not on the wrapper: inside the free-text
  // field ←/→ belong to the caret.
  const stop = ICON_PRESETS.some((p) => p.icon === value) ? value : '';
  return (
    <div>
      <div ref={roving.ref} onKeyDown={roving.onKeyDown} className="flex flex-wrap gap-1">
        <button
          type="button"
          {...rovingItem(stop === '')}
          onClick={() => onChange('')}
          className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs ring-1 transition ${
            value === '' ? 'bg-sky-50 ring-sky-400' : 'text-neutral-400 ring-neutral-200 hover:bg-neutral-100'
          }`}
          title="Kein Symbol"
        >
          –
        </button>
        {ICON_PRESETS.map(({ icon, name }) => (
          <button
            key={icon}
            type="button"
            {...rovingItem(icon === stop)}
            onClick={() => onChange(icon)}
            title={name}
            className={`flex h-8 w-8 items-center justify-center rounded-lg text-base ring-1 transition ${
              value === icon ? 'bg-sky-50 ring-sky-400' : 'ring-neutral-200 hover:bg-neutral-100'
            }`}
          >
            {icon}
          </button>
        ))}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onEnter && onEnterKey(onEnter)}
        maxLength={8}
        placeholder="oder eigenes Emoji eintippen"
        className="mt-1.5 w-52 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm outline-none focus:border-neutral-500"
      />
    </div>
  );
}

/* ---------- add a new custom column ---------- */

function AddColumnForm({
  owner,
  nextSort,
  onAdded,
  onDirtyChange,
}: {
  owner?: ColumnOwner;
  nextSort: number;
  onAdded: () => Promise<void>;
  /**
   * Reports whether the form holds the user's own input, so the surrounding Modal can ask before
   * an accidental exit throws it away (TTU-17). The Kategorien seed rows appear on their own when
   * „Auswahl" is picked, so their mere *presence* is not the user's work — but renaming, colouring
   * or adding to them is, and that is a lot of typing to lose to one Escape. Hence the comparison
   * against `SEED_OPTIONS` rather than a plain `options.length > 0`.
   */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<CustomColumnType>('text');
  const [icon, setIcon] = useState('');
  const [options, setOptions] = useState<CustomColumnOption[]>([]);
  const [busy, setBusy] = useState(false);
  // Same TTU-24 shape as `useTaskComposer`: Enter reaches `add` directly, so a repeat-key burst
  // needs a ref — the `busy` state only disables the button.
  const busyRef = useRef(false);

  // Compared against the seed, not against `[]`: switching the type back to Text leaves `options`
  // populated (the seeding below only fires into an empty list), and untouched seeds are not the
  // user's work whichever type is selected. Picking a type is itself left out — it is one click to
  // redo, and the question is about text that took typing.
  const dirty =
    name.trim() !== '' ||
    icon.trim() !== '' ||
    (options.length > 0 && JSON.stringify(options) !== JSON.stringify(SEED_OPTIONS));
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const add = async () => {
    if (!name.trim() || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await api.customColumns.create({
        name: name.trim(),
        type,
        // The scope and its parent id travel together, because the server rejects one without
        // the other — in the route and again in the schema CHECK (WP-51).
        scope: owner?.scope ?? 'global',
        artist_id: owner?.scope === 'artist' ? owner.id : null,
        project_id: owner?.scope === 'project' ? owner.id : null,
        icon: icon.trim() || null,
        options: type === 'select' ? normalizeOptions(options) : null,
        sort_order: nextSort,
      });
      setName('');
      setOptions([]);
      setType('text');
      setIcon('');
      await onAdded();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-neutral-200 p-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">Neue Spalte</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Name</Label>
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onEnterKey(() => void add())}
            placeholder="z. B. Verantwortlich"
          />
        </div>
        <div>
          <Label>Typ</Label>
          <Select
            value={type}
            onChange={(e) => {
              const t = e.target.value as CustomColumnType;
              setType(t);
              if (t === 'select' && options.length === 0) setOptions(SEED_OPTIONS);
            }}
          >
            <option value="text">Text</option>
            <option value="date">Datum</option>
            <option value="checkbox">Checkbox</option>
            <option value="select">Auswahl (farbig)</option>
          </Select>
        </div>
        <div className="col-span-2">
          <Label>Symbol (optional)</Label>
          <IconPicker value={icon} onChange={setIcon} onEnter={() => void add()} />
        </div>
        {type === 'select' && (
          <div className="col-span-2">
            <Label>Kategorien</Label>
            <OptionsEditor value={options} onChange={setOptions} />
          </div>
        )}
      </div>
      <div className="mt-3 flex justify-end">
        <Btn variant="primary" onClick={add} disabled={busy}>+ Spalte hinzufügen</Btn>
      </div>
    </div>
  );
}
