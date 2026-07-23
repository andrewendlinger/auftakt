import { useState } from 'react';
import type { Season, SeasonCopyOptions } from '../api/types';
import { Modal, Label, TextInput, Select } from './fields';
import { Btn } from './ui';
import { useSeasonTerm } from '../hooks';

/**
 * The whole database changed — reload the app at the dashboard so every view
 * refetches against the newly active season. The server keeps running (no restart).
 */
export function reloadToDashboard(): void {
  window.location.hash = '#/dashboard';
  window.location.reload();
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

export function NewSeasonModal({
  seasons,
  onSubmit,
  onClose,
}: {
  seasons: Season[];
  onSubmit: (label: string, copyFrom: number | undefined, copy: SeasonCopyOptions) => void | Promise<void>;
  onClose: () => void;
}) {
  const term = useSeasonTerm();
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
      title={`${term.singular} anlegen`}
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

