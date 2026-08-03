import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { LayoutEntry, Season, SeasonCopyOptions, SeasonPatch, SeasonStats } from '../api/types';
import { Card, Btn, DragHandle, Spinner, EmptyState, ErrorState } from '../components/ui';
import { EditableText, EditableFallbackText } from '../components/EditableText';
import {
  AddLandingSectionButton,
  LandingDocsSection,
  LandingLinksSection,
  LandingNotesSection,
  LandingTextSection,
  landingSectionKey,
  nonEmptyLandingKeys,
  useRemoveLandingSection,
} from '../components/LandingCards';
import { NewSeasonModal, reloadToDashboard } from '../components/SeasonModals';
import { SectionArranger } from '../components/SectionArranger';
import { useToast } from '../components/Toast';
import {
  useErrorToast,
  useGuardedAction,
  useInvalidateAll,
  useLabel,
  useLanding,
  useSeasons,
  useSeasonTerm,
} from '../hooks';
import { useListReorder, type DragReorder } from '../lib/dragReorder';
import { formatDate } from '../lib/dates';

/**
 * The start page: every season as a card, plus cross-season Notizen/Dokumente/Textfelder
 * below — all arrangeable via SectionArranger, persisted in seasons.json (not per-season
 * settings). Season cards keep the manual registry order and reorder via drag handle.
 * A card click opens the season; the card texts edit in place. Deleting a season lives
 * in Einstellungen, deliberately not here.
 */

/** Visual parity with the pre-arranger landing: Notizen | Dokumente side by side. */
const DEFAULT_LANDING_LAYOUT: LayoutEntry[] = [
  { key: 'saisons', width: 'full' },
  { key: 'notizen', width: 'half' },
  { key: 'dokumente', width: 'half' },
];

export function LandingPage() {
  const { data, isLoading, isError, refetch } = useSeasons();
  const { data: stats } = useQuery({ queryKey: ['seasonStats'], queryFn: api.seasonStats });
  const { data: landing, patch: patchLanding } = useLanding();
  const navigate = useNavigate();
  const toast = useToast();
  const report = useErrorToast();
  const guard = useGuardedAction();
  const invalidate = useInvalidateAll();
  const label = useLabel();
  const term = useSeasonTerm();
  const removeLandingSection = useRemoveLandingSection();

  const [creating, setCreating] = useState(false);
  const [switching, setSwitching] = useState(false);

  const seasons = data?.seasons ?? []; // registry order — manual and stable

  // `switching` disables every card (and drops it out of the tab order), so it has to be
  // cleared on failure: without the finally, one rejected activation — a restarting server,
  // a 400, a dropped fetch — left the whole page dead for good, silently, until the user
  // reloaded the app by hand (PGS-03).
  const open = async (s: Season) => {
    if (switching) return;
    if (s.id === data?.activeId) {
      navigate('/dashboard');
      return;
    }
    setSwitching(true);
    try {
      await api.activateSeason(s.id);
      reloadToDashboard();
    } catch (err) {
      report(err, `${term.singular} konnte nicht geöffnet werden.`);
    } finally {
      setSwitching(false);
    }
  };

  const update = async (id: number, patch: SeasonPatch) => {
    await api.updateSeason(id, patch);
    await invalidate(); // refreshes the cards, the header chip and the `saison` setting
    if (patch.label !== undefined) toast.show({ message: `${term.singular} umbenannt.` });
  };

  const create = async (labelText: string, copyFrom: number | undefined, copy: SeasonCopyOptions) => {
    try {
      const season = await api.createSeason(labelText, { copyFrom, ...copy });
      // A toast would not survive the reload below, so say it in something that blocks.
      if (season.copyError) {
        alert(
          `${term.singular} „${season.label}“ wurde angelegt, aber das Übernehmen ist fehlgeschlagen:\n\n${season.copyError}`,
        );
      }
      await api.activateSeason(season.id);
      reloadToDashboard();
    } catch (err) {
      // No reload happens on this path, so a toast survives — and a failed „Anlegen &
      // wechseln" used to vanish without a word (PGS-03).
      report(err, `${term.singular} konnte nicht angelegt werden.`);
    }
  };

  const drag = useListReorder(seasons, api.reorderSeasons);

  const seasonGrid =
    isLoading ? (
      <Spinner />
    ) : isError || !data ? (
      // The registry is the whole page — an unreadable seasons.json used to spin for ever
      // instead of saying so (PGS-05).
      <ErrorState
        title={`${term.plural} konnten nicht geladen werden.`}
        onRetry={() => void refetch()}
      />
    ) : seasons.length === 0 ? (
      // Defensive — the registry always bootstraps one season.
      <EmptyState>{`Noch keine ${term.plural} angelegt.`}</EmptyState>
    ) : (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {seasons.map((s) => (
          <SeasonCard
            key={s.id}
            season={s}
            active={s.id === data.activeId}
            stats={stats?.[s.id]}
            disabled={switching}
            drag={drag}
            term={term.singular}
            onOpen={() => open(s)}
            onUpdate={(patch) => update(s.id, patch)}
          />
        ))}
      </div>
    );

  const sections: Record<string, ReactNode> = { saisons: seasonGrid };
  const titles: Record<string, string> = { saisons: term.plural };
  if (landing) {
    sections.notizen = <LandingNotesSection landing={landing} />;
    sections.dokumente = <LandingDocsSection landing={landing} />;
    for (const s of landing.sections) {
      sections[landingSectionKey(s)] =
        s.type === 'links' ? (
          <LandingLinksSection section={s} />
        ) : (
          <LandingTextSection section={s} />
        );
      titles[landingSectionKey(s)] = s.name;
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-800">{term.plural}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Jede Karte ist eine eigene Datenbank — ein Klick öffnet sie.
          </p>
        </div>
        <Btn variant="primary" onClick={() => setCreating(true)}>{`＋ ${term.singular} anlegen`}</Btn>
      </div>

      {landing ? (
        <SectionArranger
          layout={landing.layout.length ? landing.layout : DEFAULT_LANDING_LAYOUT}
          // Guarded here rather than left to the caller: the arranger fires five of its six
          // layout writes as `void persist(…)`, so an unguarded rejection was invisible —
          // no toast, and in the packaged app not even a console the user could open (SHL-14).
          onPersist={(next) =>
            guard('Die Anordnung konnte nicht gespeichert werden.', () =>
              patchLanding({ layout: next }),
            )
          }
          sections={sections}
          labelKeys={{ notizen: 'landing.notizen', dokumente: 'landing.dokumente' }}
          titles={titles}
          mandatoryKeys={['saisons']}
          fullWidthKeys={['saisons']}
          nonEmptyKeys={[
            ...(landing.notes ? ['notizen'] : []),
            ...(landing.documents.length ? ['dokumente'] : []),
            ...nonEmptyLandingKeys(landing),
          ]}
          toolbarAfterKey="saisons"
          onRemoveCustom={removeLandingSection}
          removeCustomCopy={{
            // No „im Archiv wiederherstellen" here: these sections live in the seasons.json
            // registry, which has no soft delete and no Papierkorb — the undo toast is the
            // whole recovery window (SHL-03).
            body: 'samt Inhalt löschen? Diese Bereiche liegen außerhalb der Saisons und landen nicht im Papierkorb — nur „Rückgängig“ holt sie zurück.',
            confirm: 'Löschen',
          }}
          addAction={({ hiddenKeys, restore, prepend }) => (
            <AddLandingSectionButton
              hiddenKeys={hiddenKeys}
              hiddenNames={{ notizen: label('landing.notizen'), dokumente: label('landing.dokumente') }}
              onRestore={restore}
              onPrepend={prepend}
            />
          )}
        />
      ) : (
        seasonGrid
      )}

      {creating && (
        <NewSeasonModal seasons={data?.seasons ?? []} onSubmit={create} onClose={() => setCreating(false)} />
      )}
    </div>
  );
}

/**
 * The card's auto Zeitraum text when the user has not overridden it. Three states, not two:
 * `undefined` is still loading and `null` is a season whose file seasonStats() could not read.
 * Collapsing either into „Noch keine Termine" asserted something about a season that may hold a
 * full festival calendar — and directly contradicted the „Kennzahlen nicht verfügbar" line the
 * same value renders two elements up (PGS-17).
 */
function periodFallback(stats: SeasonStats | null | undefined): string {
  if (stats === undefined) return '…'; // loading; an empty string would collapse the edit target
  if (stats === null) return 'Zeitraum nicht verfügbar';
  if (!stats.firstEvent) return 'Noch keine Termine';
  return stats.firstEvent === stats.lastEvent
    ? formatDate(stats.firstEvent)
    : `${formatDate(stats.firstEvent)} – ${formatDate(stats.lastEvent)}`;
}

function SeasonCard({
  season,
  active,
  stats,
  disabled,
  drag,
  term,
  onOpen,
  onUpdate,
}: {
  season: Season;
  active: boolean;
  /** undefined = still loading, null = file unreadable. */
  stats: SeasonStats | null | undefined;
  disabled: boolean;
  drag: DragReorder;
  term: string;
  onOpen: () => void;
  onUpdate: (patch: SeasonPatch) => void | Promise<void>;
}) {
  return (
    // Not a <button>: the inline-edit inputs may not nest inside one. A role="button"
    // div opens the season; the editable texts stop propagation. h-full all the way
    // down so every card in a grid row is equally tall.
    <div className="group relative h-full" {...drag.itemProps(season.id)}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={`${term} „${season.label}“ öffnen`}
        className="block h-full w-full cursor-pointer text-left"
        onClick={onOpen}
        onKeyDown={(e) => {
          // Only the wrapper itself — Enter inside an inline-edit input must not open the season.
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        }}
      >
        <Card
          className={`flex h-full flex-col p-5 transition hover:shadow-md ${
            active ? 'ring-2 ring-neutral-900/15' : ''
          } ${drag.isDropTarget(season.id) ? 'ring-2 ring-neutral-500' : ''} ${
            drag.isDragging(season.id) ? 'opacity-40' : ''
          }`}
        >
          <div className="flex items-center gap-2 pr-10">
            <h3
              className="min-w-0 flex-1 overflow-hidden text-lg font-semibold text-neutral-800"
              title={season.label}
            >
              <EditableText truncate value={season.label} onSave={(label) => onUpdate({ label })} />
            </h3>
            {active && (
              <span className="shrink-0 rounded-full bg-neutral-900 px-2 py-0.5 text-[11px] font-medium text-white">
                Aktiv
              </span>
            )}
          </div>
          <p className="mt-0.5">
            <EditableFallbackText
              className="text-xs text-neutral-400"
              value={season.subtitle}
              fallback={`Angelegt am ${formatDate(season.createdAt)}`}
              onSave={(subtitle) => onUpdate({ subtitle })}
            />
          </p>
          {stats === null ? (
            <p className="mt-4 text-xs text-neutral-400">Kennzahlen nicht verfügbar</p>
          ) : (
            <div className="mt-4 grid grid-cols-3 gap-2">
              <Stat n={stats?.artists} label="Künstler" />
              <Stat n={stats?.projects} label="Projekte" />
              <Stat n={stats?.openTasks} label="Offene Aufgaben" />
            </div>
          )}
          <p className="mt-auto pt-3">
            <EditableFallbackText
              className="text-xs text-neutral-500"
              value={season.period}
              fallback={periodFallback(stats)}
              onSave={(period) => onUpdate({ period })}
            />
          </p>
        </Card>
      </div>
      {/* Reorder handle where the trash used to sit — deleting lives in Einstellungen. */}
      <DragHandle
        className="absolute right-4 top-4 text-base"
        {...drag.handleProps(season.id)}
      />
    </div>
  );
}

function Stat({ n, label }: { n: number | undefined; label: string }) {
  return (
    <div className="rounded-xl bg-neutral-50 px-2 py-2 text-center">
      <div className="text-lg font-semibold text-neutral-800">{n ?? '–'}</div>
      <div className="text-[11px] text-neutral-500">{label}</div>
    </div>
  );
}
