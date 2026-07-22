import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { CustomColumnOption } from '../api/types';
import { Card, SectionTitle, Spinner, Btn } from '../components/ui';
import { Label, TextInput } from '../components/fields';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { CustomColumnManager } from '../components/CustomColumnManager';
import { OptionsEditor, normalizeOptions } from '../components/OptionsEditor';
import { TaskSortEditor } from '../components/TaskSortEditor';
import {
  useEventTypeOptions,
  useInvalidateAll,
  useProjectStatusOptions,
  useSettings,
} from '../hooks';

export function SettingsPage() {
  const { data: settings, isLoading } = useSettings();
  const invalidate = useInvalidateAll();
  const [saison, setSaison] = useState('');
  const [managingColumns, setManagingColumns] = useState(false);

  const { data: globalCols = [] } = useQuery({
    queryKey: ['customColumns', 'global'],
    queryFn: () => api.customColumns.list({ scope: 'global' }),
  });

  const eventTypeOptions = useEventTypeOptions();
  const projectStatusOptions = useProjectStatusOptions();

  // Usage counts drive the "in use → can't delete" guard. The dataset is tiny and blanket-
  // invalidated on every write, so listing all events/projects here is cheap and needs no endpoint.
  const { data: allEvents = [] } = useQuery({ queryKey: ['events', 'all'], queryFn: () => api.events.list() });
  const { data: allProjects = [] } = useQuery({ queryKey: ['projects', 'all'], queryFn: () => api.projects.list() });
  const eventTypeUsage = useMemo(() => countBy(allEvents.map((e) => e.type)), [allEvents]);
  const projectStatusUsage = useMemo(() => countBy(allProjects.map((p) => p.status)), [allProjects]);

  useEffect(() => {
    if (settings) setSaison(settings.saison ?? '');
  }, [settings]);

  if (isLoading || !settings) return <Spinner />;

  const patch = async (p: Record<string, unknown>) => {
    await api.patchSettings(p);
    await invalidate();
  };

  const hasElectron = typeof window.auftakt?.exportDatabase === 'function';

  return (
    <div className="max-w-3xl space-y-8">
      <Breadcrumbs trail={[{ label: 'Übersicht', to: '/' }, { label: 'Einstellungen' }]} />
      <h1 className="text-2xl font-bold text-neutral-800">Einstellungen</h1>

      <Card className="p-5">
        <SectionTitle right={<Btn onClick={() => setManagingColumns(true)}>Verwalten</Btn>}>
          Aufgaben-Spalten
        </SectionTitle>
        <p className="mt-1 text-xs text-neutral-400">
          Zusätzliche <span className="font-medium">globale</span> Spalten, die in allen
          Aufgaben-Tabellen erscheinen. Projektspezifische Spalten legst du auf der jeweiligen
          Projektseite an.
        </p>
        <p className="mt-2 text-sm text-neutral-500">
          {globalCols.length === 0
            ? 'Noch keine globalen Spalten angelegt.'
            : globalCols.map((c) => c.name).join(', ')}
        </p>
      </Card>

      <Card className="p-5">
        <SectionTitle>Automatische Aufgaben-Sortierung</SectionTitle>
        <p className="mt-1 mb-3 text-xs text-neutral-400">
          Bestimmt, wie Aufgaben in allen Tabellen automatisch angeordnet werden (von oben nach unten
          angewandt). Erledigte Aufgaben rutschen immer nach unten. Die Reihenfolge der Status-Werte
          selbst (z. B. Not Started → In Progress → Done) legst du bei den Status-Spaltenoptionen fest.
        </p>
        <TaskSortEditor
          value={settings.task_sort ?? []}
          onChange={(v) => patch({ task_sort: v })}
        />
      </Card>

      <Card className="p-5">
        <SectionTitle>Saison</SectionTitle>
        <p className="mt-1 mb-3 text-xs text-neutral-400">
          Name dieser Saison – wird oben in der Kopfzeile angezeigt.
        </p>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Label>Bezeichnung (im Kopf angezeigt)</Label>
            <TextInput value={saison} onChange={(e) => setSaison(e.target.value)} />
          </div>
          <Btn variant="primary" onClick={() => patch({ saison })}>
            Speichern
          </Btn>
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle>Termin-Typen</SectionTitle>
        <p className="mt-1 mb-3 text-xs text-neutral-400">
          Kategorien für Wichtige Termine (z. B. Auftritt, Probe, Anreise), jeweils mit eigener Farbe.
          Umbenennen ändert nur die Anzeige – bestehende Termine behalten ihren Typ. Beim Import
          gefundene Typen werden automatisch ergänzt.
        </p>
        <SelectOptionsSetting
          options={eventTypeOptions}
          usage={eventTypeUsage}
          usageNoun="Terminen"
          addLabel="+ Typ"
          onSave={(v) => patch({ event_types: v })}
        />
      </Card>

      <Card className="p-5">
        <SectionTitle>Projekt-Status</SectionTitle>
        <p className="mt-1 mb-3 text-xs text-neutral-400">
          Auswahlmöglichkeiten für den Status eines Projekts, jeweils mit eigener Farbe. Umbenennen
          ändert nur die Anzeige – bestehende Projekte behalten ihren Status.
        </p>
        <SelectOptionsSetting
          options={projectStatusOptions}
          usage={projectStatusUsage}
          usageNoun="Projekten"
          addLabel="+ Status"
          onSave={(v) => patch({ project_statuses: v })}
        />
      </Card>

      <Card className="p-5">
        <SectionTitle>Datenbank & Backups</SectionTitle>
        <div className="space-y-3 text-sm">
          <div>
            <Label>Backup-Ordner</Label>
            <div className="flex items-center gap-2">
              <TextInput readOnly value={settings.backup_dir || '(noch nicht gewählt)'} />
              <Btn onClick={() => window.auftakt?.chooseBackupDir?.()} disabled={!hasElectron}>
                Wählen…
              </Btn>
            </div>
            <p className="mt-1 text-xs text-neutral-400">
              Beim App-Start wird eine datierte Kopie <strong>aller Saisons</strong> hierhin gesichert (die letzten
              30 Stände bleiben erhalten). In einen Cloud-Ordner (z. B. Google Drive) legen.
            </p>
            {hasElectron && !settings.backup_dir && (
              <p className="mt-1 text-xs text-amber-600">
                Ohne Backup-Ordner werden keine Sicherungen angelegt.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Btn onClick={() => window.auftakt?.exportDatabase?.()} disabled={!hasElectron}>
              Datenbank exportieren…
            </Btn>
            <Btn onClick={() => window.auftakt?.importDatabase?.()} disabled={!hasElectron}>
              Datenbank importieren…
            </Btn>
          </div>
          {!hasElectron && (
            <p className="text-xs text-amber-600">
              Backup, Export und Import stehen nur in der Desktop-App (Electron) zur Verfügung, nicht im Browser-Modus.
            </p>
          )}
        </div>
      </Card>

      {managingColumns && (
        <CustomColumnManager columns={globalCols} onClose={() => setManagingColumns(false)} />
      )}
    </div>
  );
}

/** Tally non-empty values into a `{ value: count }` map for the delete-in-use guard. */
function countBy(values: Array<string | null | undefined>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) {
    if (!v) continue;
    out[v] = (out[v] ?? 0) + 1;
  }
  return out;
}

/**
 * The coloured-options editor for `event_types` / `project_statuses` (WP-I). Local draft state so
 * label/colour edits don't hit the server per keystroke — one PATCH on „Speichern", exactly like
 * the task-column editor. Removing a value still used by an event/project is blocked on save so a
 * rename can never orphan data (the whole point of this WP); renaming is free because
 * `normalizeOptions` keeps each option's stored `value` stable and edits only its label.
 */
function SelectOptionsSetting({
  options,
  usage,
  usageNoun,
  addLabel,
  onSave,
}: {
  options: CustomColumnOption[];
  usage: Record<string, number>;
  usageNoun: string;
  addLabel: string;
  onSave: (v: CustomColumnOption[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState<CustomColumnOption[]>(options);
  const [busy, setBusy] = useState(false);
  // Reseed when the server data changes (after a save, or a season switch).
  useEffect(() => setDraft(options), [options]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(options);

  const save = async () => {
    const cleaned = normalizeOptions(draft);
    const removed = options.filter((o) => !cleaned.some((c) => c.value === o.value));
    const blocked = removed.filter((o) => (usage[o.value] ?? 0) > 0);
    if (blocked.length) {
      const lines = blocked.map((o) => `• „${o.label}“ wird von ${usage[o.value]} ${usageNoun} verwendet`);
      window.alert(
        `Diese Kategorie(n) werden noch verwendet und können nicht gelöscht werden:\n\n${lines.join(
          '\n',
        )}\n\nBenenne sie um oder weise die betroffenen Einträge zuerst einer anderen Kategorie zu.`,
      );
      return;
    }
    setBusy(true);
    try {
      await onSave(cleaned);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <OptionsEditor value={draft} onChange={setDraft} addLabel={addLabel} />
      <div className="mt-3 flex justify-end">
        <Btn variant="primary" onClick={save} disabled={busy || !dirty}>
          Speichern
        </Btn>
      </div>
    </div>
  );
}
