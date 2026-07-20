import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Card, SectionTitle, Spinner, Btn, IconButton } from '../components/ui';
import { Label, TextInput } from '../components/fields';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { CustomColumnManager } from '../components/CustomColumnManager';
import { TaskSortEditor } from '../components/TaskSortEditor';
import { useInvalidateAll, useSettings } from '../hooks';

export function SettingsPage() {
  const { data: settings, isLoading } = useSettings();
  const invalidate = useInvalidateAll();
  const [saison, setSaison] = useState('');
  const [managingColumns, setManagingColumns] = useState(false);

  const { data: globalCols = [] } = useQuery({
    queryKey: ['customColumns', 'global'],
    queryFn: () => api.customColumns.list({ scope: 'global' }),
  });

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
          Kategorien für Wichtige Termine (z. B. Auftritt, Probe, Anreise). Beim Import gefundene Typen
          werden automatisch ergänzt.
        </p>
        <ListEditor
          value={settings.event_types ?? []}
          onChange={(v) => patch({ event_types: v })}
          placeholder="Neuer Typ…"
        />
      </Card>

      <Card className="p-5">
        <SectionTitle>Projekt-Status</SectionTitle>
        <p className="mt-1 mb-3 text-xs text-neutral-400">
          Auswahlmöglichkeiten für den Status eines Projekts. Frei wählbar – dient nur der Übersicht.
        </p>
        <ListEditor
          value={settings.project_statuses ?? []}
          onChange={(v) => patch({ project_statuses: v })}
          placeholder="Neuer Status…"
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

function ListEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState('');
  const add = () => {
    const v = input.trim();
    if (!v || value.includes(v)) return;
    onChange([...value, v]);
    setInput('');
  };
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {value.map((item) => (
          <span
            key={item}
            className="inline-flex items-center gap-1 rounded-full bg-neutral-100 py-1 pl-3 pr-1 text-sm text-neutral-700"
          >
            {item}
            <IconButton
              variant="danger"
              size="sm"
              title="Entfernen"
              onClick={() => onChange(value.filter((x) => x !== item))}
            >
              ×
            </IconButton>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <TextInput
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder={placeholder}
          className="max-w-xs"
        />
        <Btn onClick={add}>+ Hinzufügen</Btn>
      </div>
    </div>
  );
}
