import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { ID, Season, SeasonCopyOptions } from '../api/types';
import { Modal, Label, TextInput, Select } from './fields';
import { Btn, IconButton } from './ui';
import { TrashIcon } from './icons';

/**
 * Season picker in the header. Each season is its own SQLite file; switching
 * re-opens that file server-side (no restart) and drops the client cache so the
 * whole app refetches against the newly active season.
 */
export function SeasonSwitcher() {
  const { data } = useQuery({ queryKey: ['seasons'], queryFn: api.seasons });
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Season | null>(null);

  const active = data?.seasons.find((s) => s.id === data.activeId);

  // The whole database changed — reload the app at the dashboard so every view
  // refetches against the newly active season. The server keeps running (no restart).
  const reload = () => {
    window.location.hash = '#/';
    window.location.reload();
  };

  const switchTo = async (id: ID) => {
    setOpen(false);
    if (!data || id === data.activeId) return;
    await api.activateSeason(id);
    reload();
  };

  const create = async (label: string, copyFrom: number | undefined, copy: SeasonCopyOptions) => {
    const season = await api.createSeason(label, { copyFrom, ...copy });
    // A toast would not survive the reload below, so say it in something that blocks.
    if (season.copyError) {
      alert(`Die Saison wurde angelegt, aber das Übernehmen ist fehlgeschlagen:\n\n${season.copyError}`);
    }
    await api.activateSeason(season.id);
    reload();
  };

  const rename = async (id: ID, label: string) => {
    await api.renameSeason(id, label);
    setRenaming(null);
    await qc.invalidateQueries();
  };

  const remove = async (s: Season) => {
    if (!window.confirm(`Saison „${s.label}“ und ihre Datenbank endgültig löschen? Das kann nicht rückgängig gemacht werden.`)) return;
    await api.deleteSeason(s.id);
    await qc.invalidateQueries();
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-0.5 text-sm text-white/80 transition hover:bg-white/20"
        title="Saison wechseln"
      >
        {active?.label ?? 'Saison'}
        <span className="text-[9px] opacity-70">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-40 mt-2 w-64 rounded-xl bg-white p-1 text-neutral-800 shadow-xl ring-1 ring-black/10">
            <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Saison</div>
            {data?.seasons.map((s) => (
              <div key={s.id} className="group flex items-center gap-1 rounded-lg px-1 hover:bg-neutral-100">
                <button className="flex flex-1 items-center gap-2 px-1 py-1.5 text-left text-sm" onClick={() => switchTo(s.id)}>
                  <span className="w-4 text-neutral-500">{s.id === data.activeId ? '✓' : ''}</span>
                  <span className={s.id === data.activeId ? 'font-semibold' : ''}>{s.label}</span>
                </button>
                <IconButton
                  size="sm"
                  className="opacity-0 group-hover:opacity-100"
                  title="Umbenennen"
                  onClick={() => { setRenaming(s); setOpen(false); }}
                >
                  ✎
                </IconButton>
                {s.id !== data.activeId && (
                  <IconButton
                    variant="danger"
                    size="sm"
                    className="opacity-0 group-hover:opacity-100"
                    title="Löschen"
                    onClick={() => remove(s)}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </IconButton>
                )}
              </div>
            ))}
            <div className="my-1 border-t border-neutral-100" />
            <button
              className="w-full rounded-lg px-3 py-1.5 text-left text-sm text-neutral-600 hover:bg-neutral-100"
              onClick={() => { setCreating(true); setOpen(false); }}
            >
              ＋ Neue Saison…
            </button>
          </div>
        </>
      )}
      {creating && (
        <NewSeasonModal seasons={data?.seasons ?? []} onSubmit={create} onClose={() => setCreating(false)} />
      )}
      {renaming && (
        <SeasonNameModal
          title="Saison umbenennen"
          initial={renaming.label}
          onSubmit={(l) => rename(renaming.id, l)}
          onClose={() => setRenaming(null)}
        />
      )}
    </div>
  );
}

/** Configuration is carried by default — losing it is the thing this dialog fixes. */
const DEFAULT_COPY: SeasonCopyOptions = {
  artists: false,
  contacts: false,
  events: false,
  projects: false,
  tasks: false,
  columns: true,
  settings: true,
};

interface CopyGroup {
  key: keyof SeasonCopyOptions;
  label: string;
  hint?: string;
}

const DATA_GROUPS: CopyGroup[] = [
  { key: 'artists', label: 'Künstler' },
  { key: 'contacts', label: 'Kontakte' },
  { key: 'events', label: 'Termine' },
  { key: 'projects', label: 'Projekte' },
  { key: 'tasks', label: 'Aufgaben' },
];

const CONFIG_GROUPS: CopyGroup[] = [
  { key: 'columns', label: 'Spalten & Ansicht der Aufgabentabelle' },
  {
    key: 'settings',
    label: 'Einstellungen',
    hint: 'Termin-Typen, Projekt-Status, Sortierung, Seitenaufbau',
  },
];

function CopyCheck({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm text-neutral-700">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        {hint && <span className="block text-xs text-neutral-500">{hint}</span>}
      </span>
    </label>
  );
}

function NewSeasonModal({
  seasons,
  onSubmit,
  onClose,
}: {
  seasons: Season[];
  onSubmit: (label: string, copyFrom: number | undefined, copy: SeasonCopyOptions) => void | Promise<void>;
  onClose: () => void;
}) {
  const [label, setLabel] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const [copy, setCopy] = useState<SeasonCopyOptions>(DEFAULT_COPY);
  const [busy, setBusy] = useState(false);

  // Mirrors the closure the server applies, so the boxes always show what will
  // actually happen: nothing can come over without the parent it hangs off.
  const toggle = (key: keyof SeasonCopyOptions, on: boolean) => {
    setCopy((prev) => {
      const next = { ...prev, [key]: on };
      if (on) {
        if (key === 'projects' || key === 'contacts' || key === 'events') next.artists = true;
        if (key === 'tasks') next.columns = true;
      } else {
        if (key === 'artists') next.projects = next.contacts = next.events = false;
        if (key === 'columns') next.tasks = false;
      }
      return next;
    });
  };

  const submit = async () => {
    if (!label.trim()) return;
    setBusy(true);
    try {
      await onSubmit(label.trim(), copyFrom ? Number(copyFrom) : undefined, copy);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Neue Saison"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Abbrechen</Btn>
          <Btn variant="primary" onClick={submit} disabled={busy}>Anlegen &amp; wechseln</Btn>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label>Bezeichnung</Label>
          <TextInput
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="z. B. Festival 2027"
          />
        </div>
        <div>
          <Label>Übernehmen aus</Label>
          <Select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            <option value="">— leer starten —</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        {copyFrom && (
          <div className="space-y-4 rounded-lg bg-neutral-50 p-3">
            {[
              { title: 'Daten', groups: DATA_GROUPS },
              { title: 'Konfiguration', groups: CONFIG_GROUPS },
            ].map(({ title, groups }) => (
              <div key={title}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  {title}
                </p>
                <div className="space-y-2">
                  {groups.map((g) => (
                    <CopyCheck
                      key={g.key}
                      label={g.label}
                      hint={g.hint}
                      checked={copy[g.key]}
                      onChange={(on) => toggle(g.key, on)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function SeasonNameModal({
  title,
  initial = '',
  submitLabel = 'Speichern',
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: string;
  submitLabel?: string;
  onSubmit: (label: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(initial);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!label.trim()) return;
    setBusy(true);
    try {
      await onSubmit(label.trim());
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Abbrechen</Btn>
          <Btn variant="primary" onClick={submit} disabled={busy}>{submitLabel}</Btn>
        </>
      }
    >
      <Label>Bezeichnung</Label>
      <TextInput
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="z. B. Festival 2027"
      />
      <p className="mt-2 text-xs text-neutral-400">
        Jede Saison ist eine eigene Datenbank. Eine neue Saison startet leer.
      </p>
    </Modal>
  );
}
