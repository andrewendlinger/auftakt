import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../api/client';
import type { CustomColumnOption, ReassignField, Season, WritableSettings } from '../api/types';
import { Card, SectionTitle, Spinner, Btn, IconButton, ErrorState } from '../components/ui';
import { Label, TextInput, Modal, onEnterKey } from '../components/fields';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { CustomColumnManager } from '../components/CustomColumnManager';
import { FeedbackDialog } from '../components/FeedbackDialog';
import {
  OptionsEditor,
  countWithNoun,
  normalizeOptions,
  removedOptions,
  validateOptions,
  type UsageNoun,
} from '../components/OptionsEditor';
import { OptionRemovalDialog, type OptionRemoval } from '../components/OptionRemovalDialog';
import { TaskSortEditor } from '../components/TaskSortEditor';
import { TrashIcon } from '../components/icons';
import { useToast } from '../components/Toast';
import { ALL_METRICS } from '../lib/taskStats';
import { openExternal, type UpdateStatus } from '../lib/external';
import { getWindowSeason } from '../lib/season';
import {
  useErrorToast,
  useEventTypeOptions,
  useEventWindowDays,
  useGlobalColumns,
  useGuardedAction,
  useInvalidateAll,
  useLinkCategoryOptions,
  useOptionUsage,
  useProjectStatusOptions,
  useSeasons,
  useSeasonTerm,
  useSettings,
  useTaskSort,
  useTaskStatsConfig,
} from '../hooks';

/**
 * Shell of the settings sub-navigation: heading + tab bar; the actual cards live in the
 * four tab pages below, rendered through the Outlet (routes in `main.tsx`).
 *
 * Four since WP-54, which needed somewhere for „Feedback & Diagnose" to live that was not
 * „<Saison> & Daten". Grouping by what a setting *acts on* rather than by what it happens
 * to sit next to also moved „Version & Updates" out of the data tab and „Termine in der
 * Übersicht" out of the category tab.
 */
export function SettingsPage() {
  const term = useSeasonTerm();
  const tabs = [
    { to: 'aufgaben', label: 'Aufgaben & Übersicht' },
    { to: 'kategorien', label: 'Kategorien' },
    { to: 'daten', label: `${term.singular} & Daten` },
    { to: 'hilfe', label: 'Programm & Hilfe' },
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

/**
 * Patch one or more settings keys and blanket-invalidate — shared by all three tabs.
 *
 * Guarded, because every editor here is fully controlled off the server value: TaskSortEditor
 * writes on each interaction, and if the PATCH rejects, the promise never reaches invalidate(),
 * the cache keeps the old rules and the editor re-renders them. The user watched their
 * reordered hierarchy snap back with no toast and no hint that nothing had been saved (PGS-09).
 *
 * Returns whether the write landed, so a caller that has follow-up work — reassigning options,
 * closing a dialog — does not treat a reported failure as success.
 *
 * Typed `Partial<WritableSettings>` rather than a `Record` bag: a `Record<string, unknown>` is
 * assignable to an all-optional target vacuously, so this wrapper would have re-opened CCL-22
 * for every settings write on the page even after the index signature came off `Settings`.
 */
function usePatchSettings(): (p: Partial<WritableSettings>) => Promise<boolean> {
  const invalidate = useInvalidateAll();
  const guard = useGuardedAction();
  return (p) =>
    guard('Einstellung konnte nicht gespeichert werden.', async () => {
      await api.patchSettings(p);
      await invalidate();
    });
}

/**
 * Tab „Aufgaben & Übersicht": global columns, automatic sort rules, and the two windows the
 * Übersicht reads — task metrics and, since WP-54, the event window that used to sit with
 * the categories.
 */
export function SettingsTasksTab() {
  const { data: settings, isLoading, isError, refetch } = useSettings();
  const patch = usePatchSettings();
  // Not `usePatchSettings` like its neighbours: TaskSortEditor saves on every interaction, so it
  // is the one editor on this page that can be clicked again before the previous write's refetch
  // lands. `useTaskSort`'s write publishes the new array to the query cache first, so the second
  // click computes from it instead of from the array this render was built with (PGS-10).
  const taskSort = useTaskSort();
  const [managingColumns, setManagingColumns] = useState(false);

  const globalCols = useGlobalColumns();

  if (isLoading) return <Spinner />;
  // Settings have no "not found" case — they either load or they don't (PGS-05).
  if (isError || !settings) {
    return (
      <ErrorState title="Einstellungen konnten nicht geladen werden." onRetry={() => void refetch()} />
    );
  }

  const userCols = globalCols.filter((c) => c.kind === 'custom');

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
        {/* Only the user's own columns: the query has no `kind` filter and ensureBuiltinColumns()
            inserts every built-in with scope 'global', so this list used to name Status, Aufgabe,
            Priorität, Fällig, Kommentar, Zuletzt bearbeitet and Erstellt am under copy calling
            them extra columns the user added — and the empty state below could never render
            (PGS-18). CustomColumnManager still gets the full list; it manages built-ins too. */}
        <p className="mt-2 text-sm text-neutral-500">
          {userCols.length === 0
            ? 'Noch keine globalen Spalten angelegt.'
            : userCols.map((c) => c.name).join(', ')}
        </p>
      </Card>

      <Card className="p-5">
        <SectionTitle>Automatische Aufgaben-Sortierung</SectionTitle>
        <p className="mt-1 mb-3 text-xs text-neutral-400">
          Bestimmt, wie Aufgaben in allen Tabellen automatisch angeordnet werden; Erledigtes
          rutscht immer nach unten. Die Reihenfolge der Status-Werte selbst legst du bei den
          Status-Spaltenoptionen fest.
        </p>
        <TaskSortEditor value={taskSort.value} onChange={(v) => void taskSort.write(v)} />
      </Card>

      <Card className="p-5">
        <SectionTitle>Aufgaben-Übersicht</SectionTitle>
        <p className="mt-1 mb-3 text-xs text-neutral-400">
          Welche Kennzahlen auf den Projekt- und Künstlerkarten sowie in der Übersicht angezeigt
          werden, und ab wann eine fällige Aufgabe unter „Braucht Aufmerksamkeit“ auftaucht.
        </p>
        {/* String(): the setting is a scalar, and the server stores every non-array value via
            String(v) — so the stored and returned shape is text, which is what the type says.
            `useTaskStatsConfig` parses it back with Number() on read. */}
        <TaskStatsSetting
          onSave={(task_stats, windowDays) =>
            patch({ task_stats, attention_window_days: String(windowDays) })
          }
        />
      </Card>

      {/* Moved here from the category tab in WP-54: it is a display window, not a category,
          and this tab is now named for the Übersicht it feeds. It used to sit beside the
          event types precisely to keep the two „Zeitfenster" fields off one screen — they
          are on one screen now, so this card stays last and the two labels have to keep
          naming what they window („Braucht Aufmerksamkeit" vs „Danach"). */}
      <Card className="p-5">
        <SectionTitle>Termine in der Übersicht</SectionTitle>
        <p className="mt-1 mb-3 text-xs text-neutral-400">
          Wie weit die Übersicht nach vorn schaut. Spätere Termine verschwinden dadurch nicht – sie
          stehen darunter unter „Danach“, der Rest hinter „weitere anzeigen“. Termine ohne Datum
          stehen immer ganz oben; Vergangenes steht auf der Künstler- und Projektseite.
        </p>
        {/* String(): scalar settings are stored via String(v) server-side, and `useEventWindowDays`
            parses them back with Number() — same round trip as attention_window_days. */}
        <EventWindowSetting onSave={(days) => patch({ event_window_days: String(days) })} />
      </Card>

      {managingColumns && (
        <CustomColumnManager columns={globalCols} onClose={() => setManagingColumns(false)} />
      )}
    </div>
  );
}

/** Tab „Kategorien": the three coloured-options lists, and nothing else since WP-54. */
export function SettingsCategoriesTab() {
  const patch = usePatchSettings();

  const eventTypeOptions = useEventTypeOptions();
  const projectStatusOptions = useProjectStatusOptions();
  const linkCategoryOptions = useLinkCategoryOptions();

  // Counted server-side over *every* row. The previous tally listed live events/projects/links,
  // and crudRouter's default list hard-filters `deleted_at IS NULL` — so a category used only by
  // a soft-deleted row read as unused, was deletable, and orphaned that row the moment it was
  // restored from the Papierkorb 30 days later. The same hole existed during the initial-load
  // window, where the `= []` default also read as „unused" (PGS-02).
  const { usage, ready } = useOptionUsage();

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
          usage={usage?.event_types ?? {}}
          ready={ready}
          field="event_type"
          usageNoun={{ one: 'Termin', many: 'Terminen' }}
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
          usage={usage?.project_statuses ?? {}}
          ready={ready}
          field="project_status"
          usageNoun={{ one: 'Projekt', many: 'Projekten' }}
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
          usage={usage?.link_categories ?? {}}
          ready={ready}
          field="link_category"
          usageNoun={{ one: 'Link', many: 'Links' }}
          addLabel="+ Kategorie"
          onSave={(v) => patch({ link_categories: v })}
        />
      </Card>
    </div>
  );
}

/**
 * The season list with the only *irreversible* delete in the app — deliberately not on the
 * landing page, where seasons are created and renamed. A season is a file, not a row: no
 * `deleted_at`, no Papierkorb, no undo, and no way back but a backup folder. Re-raised and
 * confirmed by WP-34, which gave artists and projects a delete of their own; see
 * `docs/DECISIONS.md`, „Deleting a record lives inside ✎ Bearbeiten".
 */
function SeasonManagementCard() {
  const { data } = useSeasons();
  const invalidate = useInvalidateAll();
  const guard = useGuardedAction();
  const toast = useToast();
  const term = useSeasonTerm();
  const [deleting, setDeleting] = useState<Season | null>(null);

  const confirmDelete = async () => {
    if (!deleting) return;
    const ok = await guard(`${term.singular} konnte nicht gelöscht werden.`, async () => {
      await api.deleteSeason(deleting.id);
      await invalidate();
    });
    if (ok) toast.show({ message: `${term.singular} „${deleting.label}“ gelöscht.` });
    setDeleting(null);
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
            {/* The registry default (what new windows open) is the one season the server
                refuses to delete; the season THIS window shows can be deleted — the window
                recovers to the landing page via the 410 path (lib/season.ts). */}
            {s.id === data.activeId ? (
              <span className="shrink-0 rounded-full bg-neutral-900 px-2 py-0.5 text-[11px] font-medium text-white">
                Standard
              </span>
            ) : (
              <IconButton size="sm" variant="danger" title="Löschen" onClick={() => setDeleting(s)}>
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
  const { data } = useSeasons();
  const invalidate = useInvalidateAll();
  const guard = useGuardedAction();
  const [singular, setSingular] = useState('');
  const [plural, setPlural] = useState('');

  useEffect(() => {
    setSingular(data?.terms?.season ?? '');
    setPlural(data?.terms?.seasonPlural ?? '');
  }, [data?.terms]);

  // Same shape as the settings writes: the fields are reseeded from the server value, so an
  // unreported failure just puts the old wording back as if nothing had been typed.
  const save = () =>
    guard('Bezeichnung konnte nicht gespeichert werden.', async () => {
      await api.updateSeasonTerms({
        season: singular.trim() || null,
        seasonPlural: plural.trim() || null,
      });
      await invalidate();
    });

  return (
    <Card className="p-5">
      <SectionTitle>Bezeichnung</SectionTitle>
      <p className="mt-1 mb-3 text-xs text-neutral-400">
        Wie diese Einheit überall in der App heißt — z. B. „Saison“, „Jahr“ oder „Jahrgang“.
        Leer lassen setzt zurück.
      </p>
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Label>Einzahl</Label>
          <TextInput
            value={singular}
            placeholder="Saison"
            onChange={(e) => setSingular(e.target.value)}
            onKeyDown={onEnterKey(() => void save())}
          />
        </div>
        <div className="flex-1">
          <Label>Mehrzahl</Label>
          <TextInput
            value={plural}
            placeholder="Saisons"
            onChange={(e) => setPlural(e.target.value)}
            onKeyDown={onEnterKey(() => void save())}
          />
        </div>
        <Btn variant="primary" onClick={save}>
          Speichern
        </Btn>
      </div>
    </Card>
  );
}

/** Tab „<Saison> & Daten": season management, Bezeichnung, database & backups. */
export function SettingsDataTab() {
  const { data: settings, isLoading, isError, refetch } = useSettings();
  const term = useSeasonTerm();

  if (isLoading) return <Spinner />;
  if (isError || !settings) {
    return (
      <ErrorState title="Einstellungen konnten nicht geladen werden." onRetry={() => void refetch()} />
    );
  }

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
              Beim App-Start wird eine datierte Kopie <strong>aller {term.plural}</strong> in den
              Unterordner „backups“ gesichert (die letzten 30 Stände bleiben erhalten). In einen
              Cloud-Ordner (z. B. Google Drive) legen. Die Datei „README.txt“ im Backup-Ordner erklärt
              den Aufbau und wie sich eine Sicherung zurückspielen lässt.
            </p>
            {hasElectron && !settings.backup_dir && (
              <p className="mt-1 text-xs text-amber-600">
                Ohne Backup-Ordner werden keine Sicherungen angelegt.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Btn onClick={() => window.auftakt?.exportDatabase?.(getWindowSeason() ?? undefined)} disabled={!hasElectron}>
              Datenbank exportieren…
            </Btn>
            <Btn onClick={() => window.auftakt?.importDatabase?.(getWindowSeason() ?? undefined)} disabled={!hasElectron}>
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
 * Tab „Programm & Hilfe": the app itself rather than what is in it — its version, and the
 * way to report that something is wrong with it (WP-54).
 */
export function SettingsHelpTab() {
  // The same predicate the Daten tab uses, deliberately: the question is „is there a
  // preload bridge at all", not „does this one method exist", and one phrasing for it
  // means one thing to keep true.
  const hasElectron = typeof window.auftakt?.exportDatabase === 'function';
  return (
    <div className="space-y-8">
      {hasElectron && <UpdateCard />}
      <FeedbackCard />
    </div>
  );
}

/**
 * „Feedback & Diagnose" — the entry point to the guided support mail (WP-54).
 *
 * Renders in the browser too, unlike its neighbour: `mailto:` works without a bridge, and
 * the dialog itself greys out only the parts that need one. A card that vanished in browser
 * mode would also be a card no driving script could ever see.
 */
function FeedbackCard() {
  const [open, setOpen] = useState(false);
  return (
    <Card className="p-5">
      <SectionTitle
        right={
          <Btn variant="primary" onClick={() => setOpen(true)}>
            Feedback senden…
          </Btn>
        }
      >
        Feedback & Diagnose
      </SectionTitle>
      <p className="mt-1 text-xs text-neutral-400">
        Fehler oder Wunsch: Auftakt fragt das Nötige ab und schreibt die E-Mail vor. Bei einem
        Fehler legt es zusätzlich einen Diagnosebericht auf dem Schreibtisch ab, den du anhängen
        kannst. Verschickt wird in deinem eigenen E-Mail-Programm — du siehst vorher, was
        drinsteht.
      </p>
      {open && <FeedbackDialog onClose={() => setOpen(false)} />}
    </Card>
  );
}

/**
 * Version display + update check (WP-N). The check itself runs in Electron main
 * (GitHub Releases API on macOS, electron-updater/latest.yml on Windows) — this card
 * only renders the normalized result. On packaged Windows (`canInstall`) the update
 * installs in-app; on macOS the download stays manual via the Releases page, so the
 * card also explains the quarantine step for the unsigned app. Mounting reads the
 * cached silent startup check, so an available update shows without clicking.
 */
type UpdateView =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'upToDate' }
  | { kind: 'available'; status: UpdateStatus }
  | { kind: 'downloading'; status: UpdateStatus }
  | { kind: 'error' };

function UpdateCard() {
  const [version, setVersion] = useState('');
  const [view, setView] = useState<UpdateView>({ kind: 'idle' });
  const isMac = window.auftakt?.platform === 'darwin';
  const toast = useToast();

  useEffect(() => {
    void window.auftakt?.getVersion?.().then(setVersion);
    // Surface the silent startup check; a cached "up to date" stays quiet.
    void window.auftakt
      ?.checkForUpdates?.(false)
      .then((status) => {
        if (status?.updateAvailable) setView({ kind: 'available', status });
      })
      .catch(() => {});
  }, []);

  const check = async () => {
    setView({ kind: 'checking' });
    try {
      const status = await window.auftakt?.checkForUpdates?.(true);
      if (!status) throw new Error('kein Ergebnis');
      setView(status.updateAvailable ? { kind: 'available', status } : { kind: 'upToDate' });
    } catch {
      setView({ kind: 'error' });
    }
  };

  const install = async (status: UpdateStatus) => {
    setView({ kind: 'downloading', status });
    try {
      // Resolves after the native dialog (restart now / later / error) — either way
      // the hint stays relevant until the app actually restarts.
      await window.auftakt?.installUpdate?.();
    } catch {
      // A rejected IPC call used to leave the card on „wird heruntergeladen…" forever,
      // with the install button gone and „Nach Updates suchen" disabled (PGS-16).
      toast.show({ message: 'Update konnte nicht installiert werden.' });
    }
    setView({ kind: 'available', status });
  };

  return (
    <Card className="p-5">
      <SectionTitle>Version & Updates</SectionTitle>
      <p className="mt-1 mb-3 text-xs text-neutral-400">
        Prüft, ob auf GitHub eine neuere Version von Auftakt veröffentlicht wurde.
      </p>
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-3">
          <span className="text-neutral-700">
            Installierte Version: <strong>{version || '…'}</strong>
          </span>
          <Btn onClick={check} disabled={view.kind === 'checking' || view.kind === 'downloading'}>
            Nach Updates suchen
          </Btn>
        </div>

        {view.kind === 'checking' && <p className="text-xs text-neutral-400">Suche nach Updates…</p>}
        {view.kind === 'upToDate' && (
          <p className="text-xs text-neutral-500">Du hast die neueste Version.</p>
        )}
        {view.kind === 'error' && (
          <p className="text-xs text-amber-600">
            Konnte nicht nach Updates suchen. Bitte später erneut versuchen oder die{' '}
            <button
              type="button"
              className="underline"
              onClick={() => openExternal('https://github.com/andrewendlinger/auftakt/releases')}
            >
              Releases-Seite
            </button>{' '}
            im Browser öffnen.
          </p>
        )}
        {view.kind === 'downloading' && (
          <p className="text-xs text-neutral-500">Update wird heruntergeladen…</p>
        )}

        {view.kind === 'available' && (
          <div className="space-y-2 rounded-lg bg-neutral-50 p-3">
            <p className="text-neutral-700">
              Version <strong>{view.status.latest}</strong> ist verfügbar.
            </p>
            {view.status.canInstall ? (
              <Btn variant="primary" onClick={() => install(view.status)}>
                Herunterladen & installieren
              </Btn>
            ) : (
              <>
                <Btn variant="primary" onClick={() => openExternal(view.status.url)}>
                  Zur Releases-Seite
                </Btn>
                <details className="text-xs text-neutral-500">
                  <summary className="cursor-pointer select-none font-medium text-neutral-600">
                    So installierst du die neue Version
                  </summary>
                  {isMac ? (
                    <ol className="mt-2 list-decimal space-y-1 pl-4">
                      <li>Die neue .dmg-Datei von der Releases-Seite herunterladen und öffnen.</li>
                      <li>Auftakt in den Programme-Ordner ziehen und das Ersetzen bestätigen.</li>
                      <li>
                        Im Terminal einmal{' '}
                        <code className="rounded bg-neutral-100 px-1 py-0.5">
                          xattr -dr com.apple.quarantine /Applications/Auftakt.app
                        </code>{' '}
                        ausführen — die App ist nicht Apple-signiert, macOS meldet sie sonst als
                        „beschädigt“. Deine Daten bleiben beim Update erhalten.
                      </li>
                    </ol>
                  ) : (
                    <p className="mt-2">
                      Die neue .exe-Datei von der Releases-Seite herunterladen und ausführen. Falls
                      Windows mit SmartScreen warnt („Der Computer wurde durch Windows geschützt“):
                      auf „Weitere Informationen“ und dann „Trotzdem ausführen“ klicken. Deine Daten
                      bleiben beim Update erhalten.
                    </p>
                  )}
                </details>
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * A „Zeitfenster" draft as a number, or null while it is empty or unparseable. Shared by both
 * window editors on this page — „Braucht Aufmerksamkeit" and „Termine in der Übersicht". Clamped
 * to the same [1, 365] `useTaskStatsConfig` and `useEventWindowDays` clamp on read, so a bad value
 * cannot escape at either end.
 */
function parseWindowDays(draft: string): number | null {
  const n = Number(draft.trim());
  if (draft.trim() === '' || !Number.isFinite(n)) return null;
  return Math.max(1, Math.min(365, Math.round(n)));
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
  onSave: (metrics: string[], windowDays: number) => Promise<unknown>;
}) {
  const cfg = useTaskStatsConfig();
  const [metrics, setMetrics] = useState<Set<string>>(() => new Set(cfg.metrics));
  // The window is a *string* draft: held as a number and clamped per keystroke, `''` coerced to 1,
  // the control wrote that 1 straight back and the next digits appended to it — so backspacing 14
  // to type 60 saved 160, with no validation message (PGS-04). Clamping happens on blur and on
  // save instead, which is what lets the field be emptied at all.
  const [windowDraft, setWindowDraft] = useState<string>(() => String(cfg.windowDays));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setMetrics(new Set(cfg.metrics));
    setWindowDraft(String(cfg.windowDays));
  }, [cfg.metrics, cfg.windowDays]);

  const enabled = ALL_METRICS.filter((m) => metrics.has(m.key)).map((m) => m.key);
  const sameSet = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().join() === [...b].sort().join();
  // An unparseable draft is not a value to save: it neither counts as dirty nor reaches onSave.
  const windowDays = parseWindowDays(windowDraft);
  const dirty = !sameSet(enabled, cfg.metrics) || (windowDays !== null && windowDays !== cfg.windowDays);

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
      await onSave(enabled, windowDays ?? cfg.windowDays);
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
        <Label>Zeitfenster „Braucht Aufmerksamkeit“ (Tage)</Label>
        <TextInput
          type="number"
          min={1}
          max={365}
          className="w-24"
          invalid={windowDays === null}
          value={windowDraft}
          onChange={(e) => setWindowDraft(e.target.value)}
          onBlur={() => setWindowDraft(String(windowDays ?? cfg.windowDays))}
          // Mirrors the button's disabled condition. Fires before the blur clamp, which is
          // fine: `save` parses the live draft, the clamp only rewrites what is displayed.
          onKeyDown={onEnterKey(() => {
            if (dirty && !busy) void save();
          })}
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

/**
 * Editor for the „Nächste Termine" window. Same mechanics as the field above and for the same
 * reason: the draft is a *string*, clamped on blur and on save rather than per keystroke, because
 * clamping each keystroke wrote `''` back as 1 and appended the next digits to it (PGS-04).
 */
function EventWindowSetting({ onSave }: { onSave: (windowDays: number) => Promise<unknown> }) {
  const current = useEventWindowDays();
  const [draft, setDraft] = useState<string>(() => String(current));
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(String(current)), [current]);

  const windowDays = parseWindowDays(draft);
  const dirty = windowDays !== null && windowDays !== current;

  const save = async () => {
    setBusy(true);
    try {
      await onSave(windowDays ?? current);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>Zeitfenster bis „Danach“ (Tage)</Label>
        <TextInput
          type="number"
          min={1}
          max={365}
          className="w-24"
          invalid={windowDays === null}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setDraft(String(windowDays ?? current))}
          onKeyDown={onEnterKey(() => {
            if (dirty && !busy) void save();
          })}
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

/**
 * The coloured-options editor for `event_types` / `project_statuses` (WP-I). Local draft state so
 * label/colour edits don't hit the server per keystroke — one PATCH on „Speichern", exactly like
 * the task-column editor. Removing a value still used by an event/project can never orphan data
 * (the whole point of this WP): the rows are counted first and moved to a replacement category.
 * Renaming is free because `normalizeOptions` keeps each option's stored `value` stable and edits
 * only its label.
 *
 * Shares `validateOptions` and `OptionRemovalDialog` with the task-column editor, so the one
 * `OptionsEditor` component behaves identically wherever it appears — the guard used to be
 * bolted onto this call site only, and the other one deleted referenced categories silently.
 */
function SelectOptionsSetting({
  options,
  usage,
  ready,
  field,
  usageNoun,
  addLabel,
  onSave,
}: {
  options: CustomColumnOption[];
  usage: Record<string, number>;
  /** False while the usage query is in flight — an empty map must not read as „unused". */
  ready: boolean;
  field: ReassignField;
  usageNoun: UsageNoun;
  addLabel: string;
  /** Resolves false when the settings write failed — the reassignment must not follow it. */
  onSave: (v: CustomColumnOption[]) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<CustomColumnOption[]>(options);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<CustomColumnOption[]>([]);
  const [pending, setPending] = useState<OptionRemoval[] | null>(null);
  const invalidate = useInvalidateAll();
  const report = useErrorToast();
  // Reseed when the server data changes (after a save, or a season switch).
  useEffect(() => setDraft(options), [options]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(options);
  const problem = validateOptions(draft);

  const edit = (v: CustomColumnOption[]) => {
    setBlocked([]); // the message described the previous draft
    setDraft(v);
  };

  const persist = async (mapping: Array<{ from: string; to: string }>) => {
    setBusy(true);
    try {
      // The option list has to land before the rows are moved onto it: a reassignment that ran
      // after a failed save would point rows at a category the settings row never got.
      if (!(await onSave(normalizeOptions(draft)))) return;
      for (const m of mapping) await api.reassignOption({ field, ...m });
      await invalidate();
      setPending(null);
    } catch (err) {
      // The reassignment; it is invoked via `void` from the dialog, so an uncaught rejection
      // here left the dialog open, busy and silent.
      report(err, 'Einträge konnten nicht verschoben werden.');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (problem || !ready) return;
    setBlocked([]);
    const cleaned = normalizeOptions(draft);
    const removals = removedOptions(options, cleaned)
      .map((option) => ({ option, count: usage[option.value] ?? 0 }))
      .filter((r) => r.count > 0);
    if (removals.length === 0) return persist([]);
    // Nothing left to move them to, so this one really is a dead end.
    if (cleaned.length === 0) {
      setBlocked(removals.map((r) => r.option));
      return;
    }
    setPending(removals);
  };

  return (
    <div>
      <OptionsEditor value={draft} onChange={edit} addLabel={addLabel} />
      {problem && <p className="mt-3 text-sm text-amber-700">{problem}</p>}
      {/* Inline, not window.alert: a native dialog renders OS chrome with English buttons and
          blocks the Electron renderer, while every other error path on this page uses the app's
          own surfaces. It also keeps the list next to the rows it is about (PGS-23). */}
      {blocked.length > 0 && (
        <div className="mt-3 space-y-1 text-sm text-amber-700">
          <p>Diese Kategorien werden noch verwendet:</p>
          <ul className="list-inside list-disc">
            {blocked.map((o) => (
              <li key={o.value}>
                „{o.label}“ wird von {countWithNoun(usage[o.value] ?? 0, usageNoun)} verwendet
              </li>
            ))}
          </ul>
          <p className="text-neutral-500">
            Es muss eine Kategorie übrig bleiben, in die die Einträge verschoben werden können.
          </p>
        </div>
      )}
      <div className="mt-3 flex justify-end">
        <Btn variant="primary" onClick={save} disabled={busy || !dirty || !ready || !!problem}>
          Speichern
        </Btn>
      </div>
      {pending && (
        <OptionRemovalDialog
          removals={pending}
          targets={normalizeOptions(draft)}
          noun={usageNoun}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={(mapping) => void persist(mapping)}
        />
      )}
    </div>
  );
}
