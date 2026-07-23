import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { CustomColumnOption, Season } from '../api/types';
import { Card, SectionTitle, Spinner, Btn, IconButton } from '../components/ui';
import { Label, TextInput, Modal } from '../components/fields';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { CustomColumnManager } from '../components/CustomColumnManager';
import { OptionsEditor, normalizeOptions } from '../components/OptionsEditor';
import { TaskSortEditor } from '../components/TaskSortEditor';
import { TrashIcon } from '../components/icons';
import { useToast } from '../components/Toast';
import { ALL_METRICS } from '../lib/taskStats';
import {
  useEventTypeOptions,
  useInvalidateAll,
  useLinkCategoryOptions,
  useProjectStatusOptions,
  useSeasonTerm,
  useSettings,
  useTaskStatsConfig,
} from '../hooks';

/**
 * Shell of the settings sub-navigation: heading + tab bar; the actual cards live in the
 * three tab pages below, rendered through the Outlet (routes in `main.tsx`).
 */
export function SettingsPage() {
  const term = useSeasonTerm();
  const tabs = [
    { to: 'aufgaben', label: 'Aufgaben' },
    { to: 'kategorien', label: 'Kategorien & Optionen' },
    { to: 'daten', label: `${term.singular} & Daten` },
  ];
  return (
    <div className="max-w-3xl space-y-8">
      <Breadcrumbs trail={[{ label: 'Übersicht', to: '/dashboard' }, { label: 'Einstellungen' }]} />
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-neutral-800">Einstellungen</h1>
        <nav className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-neutral-900 text-white'
                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                }`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <Outlet />
    </div>
  );
}

/** Patch one or more settings keys and blanket-invalidate — shared by all three tabs. */
function usePatchSettings() {
  const invalidate = useInvalidateAll();
  return async (p: Record<string, unknown>) => {
    await api.patchSettings(p);
    await invalidate();
  };
}

/** Tab „Aufgaben": global columns, automatic sort rules, overview metrics. */
export function SettingsTasksTab() {
  const { data: settings, isLoading } = useSettings();
  const patch = usePatchSettings();
  const [managingColumns, setManagingColumns] = useState(false);

  const { data: globalCols = [] } = useQuery({
    queryKey: ['customColumns', 'global'],
    queryFn: () => api.customColumns.list({ scope: 'global' }),
  });

  if (isLoading || !settings) return <Spinner />;

  return (
    <div className="space-y-8">
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
          Bestimmt, wie Aufgaben in allen Tabellen automatisch angeordnet werden; Erledigtes
          rutscht immer nach unten. Die Reihenfolge der Status-Werte selbst legst du bei den
          Status-Spaltenoptionen fest.
        </p>
        <TaskSortEditor
          value={settings.task_sort ?? []}
          onChange={(v) => patch({ task_sort: v })}
        />
      </Card>

      <Card className="p-5">
        <SectionTitle>Aufgaben-Übersicht</SectionTitle>
        <p className="mt-1 mb-3 text-xs text-neutral-400">
          Welche Kennzahlen auf den Projekt- und Künstlerkarten sowie in der Übersicht angezeigt
          werden, und ab wann eine fällige Aufgabe unter „Braucht Aufmerksamkeit" auftaucht.
        </p>
        <TaskStatsSetting onSave={(task_stats, attention_window_days) => patch({ task_stats, attention_window_days })} />
      </Card>

      {managingColumns && (
        <CustomColumnManager columns={globalCols} onClose={() => setManagingColumns(false)} />
      )}
    </div>
  );
}

/** Tab „Kategorien & Optionen": the three coloured-options lists. */
export function SettingsCategoriesTab() {
  const patch = usePatchSettings();

  const eventTypeOptions = useEventTypeOptions();
  const projectStatusOptions = useProjectStatusOptions();
  const linkCategoryOptions = useLinkCategoryOptions();

  // Usage counts drive the "in use → can't delete" guard. The dataset is tiny and blanket-
  // invalidated on every write, so listing all events/projects here is cheap and needs no endpoint.
  const { data: allEvents = [] } = useQuery({ queryKey: ['events', 'all'], queryFn: () => api.events.list() });
  const { data: allProjects = [] } = useQuery({ queryKey: ['projects', 'all'], queryFn: () => api.projects.list() });
  const { data: allLinks = [] } = useQuery({ queryKey: ['links', 'all'], queryFn: () => api.links.list() });
  const eventTypeUsage = useMemo(() => countBy(allEvents.map((e) => e.type)), [allEvents]);
  const projectStatusUsage = useMemo(() => countBy(allProjects.map((p) => p.status)), [allProjects]);
  const linkCategoryUsage = useMemo(() => countBy(allLinks.map((l) => l.category)), [allLinks]);

  return (
    <div className="space-y-8">
      <Card className="p-5">
        <SectionTitle>Termin-Typen</SectionTitle>
        <p className="mt-1 mb-3 text-xs text-neutral-400">
          Kategorien für Wichtige Termine (z. B. Auftritt, Probe, Anreise), jeweils mit eigener
          Farbe. Umbenennen ändert nur die Anzeige – bestehende Termine behalten ihren Typ.
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
        <SectionTitle>Dokument-Kategorien</SectionTitle>
        <p className="mt-1 mb-3 text-xs text-neutral-400">
          Kategorien für Dokumente & Links, jeweils mit eigener Farbe — die Liste wird danach
          gruppiert. Umbenennen ändert nur die Anzeige – bestehende Links behalten ihre Kategorie.
        </p>
        <SelectOptionsSetting
          options={linkCategoryOptions}
          usage={linkCategoryUsage}
          usageNoun="Links"
          addLabel="+ Kategorie"
          onSave={(v) => patch({ link_categories: v })}
        />
      </Card>
    </div>
  );
}

/** The season list with the only delete affordance in the app — deliberately not on the landing. */
function SeasonManagementCard() {
  const { data } = useQuery({ queryKey: ['seasons'], queryFn: api.seasons });
  const invalidate = useInvalidateAll();
  const toast = useToast();
  const term = useSeasonTerm();
  const [deleting, setDeleting] = useState<Season | null>(null);

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.deleteSeason(deleting.id);
      await invalidate();
      toast.show({ message: `${term.singular} „${deleting.label}“ gelöscht.` });
    } catch (err) {
      toast.show({
        message: err instanceof ApiError ? err.message : `${term.singular} konnte nicht gelöscht werden.`,
      });
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Card className="p-5">
      <SectionTitle>{term.plural}</SectionTitle>
      <p className="mt-1 mb-3 text-xs text-neutral-400">
        Anlegen und Umbenennen auf der Übersichtsseite — Löschen nur hier.
      </p>
      <ul className="space-y-1">
        {data?.seasons.map((s) => (
          <li key={s.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-neutral-50">
            <span className="flex-1 truncate text-sm text-neutral-700">{s.label}</span>
            {s.id === data.activeId ? (
              <span className="shrink-0 rounded-full bg-neutral-900 px-2 py-0.5 text-[11px] font-medium text-white">
                Aktiv
              </span>
            ) : (
              <IconButton
                size="sm"
                variant="danger"
                title="Löschen"
                className="opacity-0 group-hover:opacity-100"
                onClick={() => setDeleting(s)}
              >
                <TrashIcon className="h-4 w-4" />
              </IconButton>
            )}
          </li>
        ))}
      </ul>
      {deleting && (
        <Modal
          title={`${term.singular} endgültig löschen`}
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Btn onClick={() => setDeleting(null)}>Abbrechen</Btn>
              <Btn variant="danger" onClick={confirmDelete}>Endgültig löschen</Btn>
            </>
          }
        >
          <p className="text-sm text-neutral-600">
            „{deleting.label}“ und die zugehörige Datenbank-Datei werden endgültig gelöscht.
            Das kann nicht rückgängig gemacht werden — {term.plural} landen nicht im Papierkorb.
          </p>
        </Modal>
      )}
    </Card>
  );
}

/** The user-renameable word for a season, stored app-globally in seasons.json. */
function SeasonTermCard() {
  const { data } = useQuery({ queryKey: ['seasons'], queryFn: api.seasons });
  const invalidate = useInvalidateAll();
  const [singular, setSingular] = useState('');
  const [plural, setPlural] = useState('');

  useEffect(() => {
    setSingular(data?.terms?.season ?? '');
    setPlural(data?.terms?.seasonPlural ?? '');
  }, [data?.terms]);

  const save = async () => {
    await api.updateSeasonTerms({
      season: singular.trim() || null,
      seasonPlural: plural.trim() || null,
    });
    await invalidate();
  };

  return (
    <Card className="p-5">
      <SectionTitle>Bezeichnung</SectionTitle>
      <p className="mt-1 mb-3 text-xs text-neutral-400">
        Wie diese Einheit überall in der App heißt — z. B. „Saison", „Jahr" oder „Jahrgang".
        Leer lassen setzt zurück.
      </p>
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Label>Einzahl</Label>
          <TextInput value={singular} placeholder="Saison" onChange={(e) => setSingular(e.target.value)} />
        </div>
        <div className="flex-1">
          <Label>Mehrzahl</Label>
          <TextInput value={plural} placeholder="Saisons" onChange={(e) => setPlural(e.target.value)} />
        </div>
        <Btn variant="primary" onClick={save}>
          Speichern
        </Btn>
      </div>
    </Card>
  );
}

/** Tab „Saison & Daten": season management, Bezeichnung, database & backups (later: update card, WP-N). */
export function SettingsDataTab() {
  const { data: settings, isLoading } = useSettings();
  const term = useSeasonTerm();

  if (isLoading || !settings) return <Spinner />;

  const hasElectron = typeof window.auftakt?.exportDatabase === 'function';

  return (
    <div className="space-y-8">
      <SeasonManagementCard />
      <SeasonTermCard />

      <Card className="p-5">
        <SectionTitle>Datenbank & Backups</SectionTitle>
        <p className="mt-1 mb-3 text-xs text-neutral-400">
          Automatische Sicherung aller {term.plural} sowie Export und Import der Datenbank.
        </p>
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
              Beim App-Start wird eine datierte Kopie <strong>aller {term.plural}</strong> hierhin gesichert (die
              letzten 30 Stände bleiben erhalten). In einen Cloud-Ordner (z. B. Google Drive) legen.
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
    </div>
  );
}

/**
 * Editor for the task-insight prefs: which metrics show (toggle chips) and the
 * „Braucht Aufmerksamkeit" window in days. Local draft + one „Speichern" (like the option
 * editors), reseeded when the server data changes. An empty metric set is a valid save — the
 * user chose to show none.
 */
function TaskStatsSetting({
  onSave,
}: {
  onSave: (metrics: string[], windowDays: number) => Promise<void>;
}) {
  const cfg = useTaskStatsConfig();
  const [metrics, setMetrics] = useState<Set<string>>(() => new Set(cfg.metrics));
  const [windowDays, setWindowDays] = useState<number>(cfg.windowDays);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setMetrics(new Set(cfg.metrics));
    setWindowDays(cfg.windowDays);
  }, [cfg.metrics, cfg.windowDays]);

  const enabled = ALL_METRICS.filter((m) => metrics.has(m.key)).map((m) => m.key);
  const sameSet = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().join() === [...b].sort().join();
  const dirty = !sameSet(enabled, cfg.metrics) || windowDays !== cfg.windowDays;

  const toggle = (key: string) =>
    setMetrics((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const save = async () => {
    setBusy(true);
    try {
      await onSave(enabled, windowDays);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {ALL_METRICS.map((m) => {
          const on = metrics.has(m.key);
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => toggle(m.key)}
              className={`rounded-full px-3 py-1 text-sm font-medium transition ${
                on ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              }`}
            >
              {on ? '✓ ' : ''}
              {m.label}
            </button>
          );
        })}
      </div>
      <div>
        <Label>Zeitfenster „Braucht Aufmerksamkeit" (Tage)</Label>
        <input
          type="number"
          min={1}
          max={365}
          value={windowDays}
          onChange={(e) => setWindowDays(Math.max(1, Math.min(365, Math.round(Number(e.target.value)) || 1)))}
          className="w-24 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-800 outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-900/5"
        />
      </div>
      <div className="flex justify-end">
        <Btn variant="primary" onClick={save} disabled={busy || !dirty}>
          Speichern
        </Btn>
      </div>
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
