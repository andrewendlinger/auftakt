import { useRef, useState } from 'react';
import type { Season, SeasonCopyOptions } from '../api/types';
import { Modal, Label, TextInput, Select, onEnterKey } from './fields';
import { Btn } from './ui';
import { useArtistNoun, useSeasonTerm } from '../hooks';

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

type CopyKey = keyof SeasonCopyOptions;

/**
 * What a group needs in order to arrive at all — the server's dependency closure *and* its
 * per-row filter, stated in one place. copySeasonData keeps a contact/event/task only when
 * the artist or project it hangs off was copied too (`kept()`), so ticking „Aufgaben" alone
 * used to copy nothing but the handful of saisonweite Todos, silently. Season-wide todos
 * (no parent at all) still come with „Aufgaben"; everything attached needs its parent.
 */
const REQUIRES: Partial<Record<CopyKey, CopyKey[]>> = {
  projects: ['artists'],
  contacts: ['artists', 'projects'],
  events: ['artists', 'projects'],
  // custom_values is keyed by column id, and `status` has to name an option the target's
  // Status column offers. Settings need the columns for the option order task_sort uses.
  tasks: ['artists', 'projects', 'columns'],
  settings: ['columns'],
};

interface CopyGroup {
  key: CopyKey;
  label: string;
  hint?: string;
}

/**
 * Built from the artist noun rather than spelled out, so a festival that renamed „Künstler" reads
 * its own word here too.
 *
 * The hints say „gehören zu: X" and not „hängen an X" because the dative would have to inflect the
 * user's noun — „hängen an Musiker" is wrong where „hängen an Künstlern" was right, and German case
 * endings cannot be derived from a word the app has never seen. A colon followed by the plain
 * nominative is grammatical whatever they typed.
 *
 * A function, not a constant: this renders on the landing page, where `useLabel` resolves the
 * *active* season's labels while the copy may be from another one — the same asymmetry
 * `lib/labels.ts` already records for the landing sections, and still better than a fixed word.
 */
function dataGroups(artistNoun: string): CopyGroup[] {
  return [
    { key: 'artists', label: artistNoun },
    { key: 'contacts', label: 'Kontakte', hint: `gehören zu: ${artistNoun} & Projekte` },
    { key: 'events', label: 'Termine', hint: `gehören zu: ${artistNoun} & Projekte` },
    { key: 'projects', label: 'Projekte', hint: `gehören zu: ${artistNoun}` },
    { key: 'tasks', label: 'Aufgaben', hint: `gehören zu: ${artistNoun} & Projekte` },
  ];
}

const CONFIG_GROUPS: CopyGroup[] = [
  { key: 'columns', label: 'Spalten & Ansicht der Aufgabentabelle' },
  {
    key: 'settings',
    label: 'Einstellungen',
    hint: 'Termin-Typen, Projekt-Status, Sortierung, Seitenaufbau — braucht die Spalten',
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
  const artistNoun = useArtistNoun();
  const [label, setLabel] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const [copy, setCopy] = useState<SeasonCopyOptions>(DEFAULT_COPY);
  const [busy, setBusy] = useState(false);

  const toggle = (key: CopyKey, on: boolean) => {
    setCopy((prev) => {
      const next = { ...prev, [key]: on };
      // Restore the invariant "a ticked group has every group it requires ticked too",
      // without ever undoing the click itself: ticking pulls its requirements in, unticking
      // drops whatever required it. Looped to a fixpoint so chains resolve in one click
      // („Aufgaben" → Projekte → Künstler, or un-ticking „Künstler" → Projekte → Aufgaben).
      for (let changed = true; changed; ) {
        changed = false;
        for (const [k, deps] of Object.entries(REQUIRES) as Array<[CopyKey, CopyKey[]]>) {
          if (!next[k]) continue;
          for (const d of deps) {
            if (next[d]) continue;
            if (on) next[d] = true;
            else next[k] = false;
            changed = true;
          }
        }
      }
      return next;
    });
  };

  // A ref, not the `busy` state: setBusy is not visible to a second call in the same tick,
  // and the Enter key auto-repeats at ~30/s, so the button's disabled={busy} guarded nothing
  // — each repeat created its own season, its own .db file and its own full copy run
  // (SHL-08). The latch is checked and set synchronously, before the first await.
  const busyRef = useRef(false);

  const submit = async () => {
    if (!label.trim() || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await onSubmit(label.trim(), copyFrom ? Number(copyFrom) : undefined, copy);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`${term.singular} anlegen`}
      size="lg"
      onClose={onClose}
      // The copy checkboxes only render once „Übernehmen aus" is set, so `copyFrom` covers them.
      dirty={label !== '' || copyFrom !== ''}
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
            onKeyDown={onEnterKey(() => void submit())}
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
              { title: 'Daten', groups: dataGroups(artistNoun) },
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

