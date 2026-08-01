import { useMemo, useState } from 'react';
import { Modal, Label, TextInput, Select } from './fields';
import { Btn, IconButton, ReorderArrows } from './ui';
import { TrashIcon } from './icons';
import { api } from '../api/client';
import type { CustomColumn, CustomColumnOption, CustomColumnType } from '../api/types';
import { parseColumnOptions, parseCustomValues } from '../api/types';
import { arrayMove } from '../lib/arrays';
import { OPTION_PALETTE } from '../lib/selectOptions';
import { OptionsEditor, normalizeOptions, validateOptions } from './OptionsEditor';
import { useInvalidateAll } from '../hooks';

/** A handful of common symbols; users can also type any emoji into the free field. */
const ICON_PRESETS = ['👤', '👥', '📞', '📧', '✅', '⭐', '📅', '🎵', '🎸', '🎤', '💶', '📝', '📌', '🏨', '🚗', '✈️'];

const TYPE_LABEL: Record<string, string> = {
  status: 'Status', title: 'Text', priority: 'Auswahl', due: 'Datum', comment: 'Text',
  text: 'Text', date: 'Datum', checkbox: 'Checkbox', select: 'Auswahl',
  created: 'Zeitstempel', updated: 'Zeitstempel',
};

/** Columns whose options are editable colored categories. */
function hasOptions(col: CustomColumn): boolean {
  return col.type === 'select' || col.type === 'status' || col.type === 'priority';
}

export function CustomColumnManager({
  columns,
  projectId,
  onClose,
}: {
  columns: CustomColumn[];
  projectId?: number;
  onClose: () => void;
}) {
  const invalidate = useInvalidateAll();
  const [editing, setEditing] = useState<CustomColumn | null>(null);

  // On a project page, global columns are shown read-only; only project columns are managed here.
  const managed = useMemo(
    () =>
      [...columns]
        .filter((c) => (projectId ? c.scope === 'project' : c.scope === 'global'))
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
    [columns, projectId],
  );
  const readOnly = useMemo(
    () => (projectId ? [...columns].filter((c) => c.scope === 'global').sort((a, b) => a.sort_order - b.sort_order) : []),
    [columns, projectId],
  );

  // One transactional renumber rather than two sequential swaps: if the second PATCH failed,
  // both rows kept the same sort_order and the `a.id` tiebreak above silently froze the ▲/▼
  // buttons for that column. `managed` is a single scope group, and `visibleCols` orders by
  // scope before sort_order, so renumbering it from 0 can't interleave the other group.
  const move = async (col: CustomColumn, dir: -1 | 1) => {
    const next = arrayMove(managed, managed.findIndex((c) => c.id === col.id), dir);
    if (next === managed) return;
    await api.customColumns.reorder(next.map((c) => c.id));
    await invalidate();
  };

  const toggleEnabled = async (col: CustomColumn) => {
    if (col.enabled) {
      const ok = window.confirm(
        `Spalte „${col.name}“ ausblenden? Die vorhandenen Werte bleiben erhalten und die Spalte kann jederzeit wieder eingeblendet werden.`,
      );
      if (!ok) return;
    }
    await api.customColumns.update(col.id, { enabled: col.enabled ? 0 : 1 });
    await invalidate();
  };

  const remove = async (col: CustomColumn) => {
    const params = col.scope === 'project' && col.project_id ? { project_id: col.project_id, scope: 'all' } : { scope: 'all' };
    const tasks = await api.tasks.list(params);
    const used = tasks.filter((t) => {
      const v = parseCustomValues(t.custom_values)[String(col.id)];
      return v !== undefined && v !== null && v !== '' && v !== false;
    }).length;
    const msg = used
      ? `Die Spalte „${col.name}“ enthält Werte in ${used} Aufgabe(n). Wirklich löschen? Die Werte gehen verloren.`
      : `Spalte „${col.name}“ löschen?`;
    if (!window.confirm(msg)) return;
    await api.customColumns.remove(col.id);
    await invalidate();
  };

  return (
    <Modal title="Spalten verwalten" onClose={onClose} wide>
      <div className="space-y-5">
        {readOnly.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Globale Spalten (in Einstellungen verwalten)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {readOnly.map((c) => (
                <span
                  key={c.id}
                  className={`rounded-full bg-neutral-100 px-2.5 py-1 text-xs ${c.enabled ? 'text-neutral-600' : 'text-neutral-300 line-through'}`}
                >
                  {c.name}
                </span>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            {projectId ? 'Projekt-Spalten' : 'Spalten'}
          </div>
          <p className="mb-3 text-xs text-neutral-400">
            Reihenfolge mit ↑ ↓ ändern. „Status“ und „Aufgabe“ sind fest; andere Spalten lassen sich
            aus- und einblenden, umbenennen und (eigene) löschen.
          </p>
          {managed.length === 0 ? (
            <div className="text-sm text-neutral-400">Noch keine Spalten.</div>
          ) : (
            <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl ring-1 ring-neutral-100">
              {managed.map((c, i) => (
                <ColumnRow
                  key={c.id}
                  col={c}
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

        <AddColumnForm projectId={projectId} nextSort={Math.max(-1, ...managed.map((c) => c.sort_order)) + 1} onAdded={invalidate} />
      </div>

      {editing && <ColumnEditModal col={editing} onClose={() => setEditing(null)} onSaved={invalidate} />}
    </Modal>
  );
}

function ColumnRow({
  col,
  first,
  last,
  onUp,
  onDown,
  onToggle,
  onEdit,
  onRemove,
}: {
  col: CustomColumn;
  first: boolean;
  last: boolean;
  onUp: () => void;
  onDown: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const isBuiltin = col.kind === 'builtin';
  const locked = isBuiltin && col.deletable === 0; // Status & Aufgabe
  const options = hasOptions(col) ? parseColumnOptions(col.options) : [];
  return (
    <li
      className={`flex items-center gap-2 px-2 py-1.5 text-sm transition ${
        isBuiltin ? 'bg-sky-50/70 hover:bg-sky-100/60' : 'hover:bg-neutral-50'
      } ${col.enabled ? '' : 'opacity-50'}`}
    >
      <ReorderArrows first={first} last={last} onUp={onUp} onDown={onDown} />
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
      </div>
      {!locked && (
        <button
          className="rounded-lg px-2 py-1 text-xs text-neutral-500 transition hover:bg-neutral-200"
          onClick={onToggle}
          title={col.enabled ? 'Ausblenden' : 'Einblenden'}
        >
          {col.enabled ? '👁 sichtbar' : '🚫 aus'}
        </button>
      )}
      <IconButton size="sm" onClick={onEdit} title="Bearbeiten">✎</IconButton>
      {col.kind === 'custom' ? (
        <IconButton variant="danger" size="sm" onClick={onRemove} title="Löschen">
          <TrashIcon className="h-4 w-4" />
        </IconButton>
      ) : (
        <span className="w-7" />
      )}
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
  const editableOptions = hasOptions(col);
  const allowDone = col.type === 'status';

  // Validated live rather than on click, so the disabled „Speichern" always comes with the
  // reason next to the rows causing it — including when the column was already in a bad state
  // (a legacy Status column whose options predate the `done` flag).
  // A user-added „Auswahl" column may legitimately still be empty; a built-in one may not.
  const problem = editableOptions
    ? validateOptions(options, { requireDone: allowDone, requireNonEmpty: col.kind === 'builtin' })
    : null;

  const save = async () => {
    if (!name.trim() || problem) return;
    setBusy(true);
    try {
      const patch: Record<string, unknown> = { name: name.trim(), icon: icon.trim() || null };
      if (editableOptions) patch.options = normalizeOptions(options);
      await api.customColumns.update(col.id, patch as Partial<CustomColumn>);
      await onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`„${col.name}“ bearbeiten`}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Abbrechen</Btn>
          <Btn variant="primary" onClick={save} disabled={busy || !!problem}>Speichern</Btn>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label>Name</Label>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label>Symbol (optional)</Label>
          <IconPicker value={icon} onChange={setIcon} />
        </div>
        {editableOptions && (
          <div>
            <Label>Kategorien</Label>
            <OptionsEditor value={options} onChange={setOptions} allowDone={allowDone} />
            {problem && <p className="mt-2 text-sm text-amber-700">{problem}</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Emoji/symbol picker: a preset grid plus a free field for any other emoji. */
function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => onChange('')}
          className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs ring-1 transition ${
            value === '' ? 'bg-sky-50 ring-sky-400' : 'text-neutral-400 ring-neutral-200 hover:bg-neutral-100'
          }`}
          title="Kein Symbol"
        >
          –
        </button>
        {ICON_PRESETS.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => onChange(e)}
            className={`flex h-8 w-8 items-center justify-center rounded-lg text-base ring-1 transition ${
              value === e ? 'bg-sky-50 ring-sky-400' : 'ring-neutral-200 hover:bg-neutral-100'
            }`}
          >
            {e}
          </button>
        ))}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={8}
        placeholder="oder eigenes Emoji eintippen"
        className="mt-1.5 w-52 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm outline-none focus:border-neutral-500"
      />
    </div>
  );
}

/* ---------- add a new custom column ---------- */

function AddColumnForm({
  projectId,
  nextSort,
  onAdded,
}: {
  projectId?: number;
  nextSort: number;
  onAdded: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<CustomColumnType>('text');
  const [icon, setIcon] = useState('');
  const [options, setOptions] = useState<CustomColumnOption[]>([]);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.customColumns.create({
        name: name.trim(),
        type,
        scope: projectId ? 'project' : 'global',
        project_id: projectId ?? null,
        icon: icon.trim() || null,
        options: type === 'select' ? (normalizeOptions(options) as unknown as string) : null,
        sort_order: nextSort,
      });
      setName('');
      setOptions([]);
      setType('text');
      setIcon('');
      await onAdded();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-neutral-200 p-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">Neue Spalte</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Name</Label>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Verantwortlich" />
        </div>
        <div>
          <Label>Typ</Label>
          <Select
            value={type}
            onChange={(e) => {
              const t = e.target.value as CustomColumnType;
              setType(t);
              if (t === 'select' && options.length === 0) {
                setOptions([
                  { label: 'offen', value: 'offen', color: OPTION_PALETTE[0]! },
                  { label: 'fertig', value: 'fertig', color: OPTION_PALETTE[2]! },
                ]);
              }
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
          <IconPicker value={icon} onChange={setIcon} />
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
