import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { ArtistCard as ArtistCardT, Task, UpcomingEvent } from '../api/types';
import { withAlpha } from '../lib/colors';
import { formatEventWhen, weekdayShort } from '../lib/dates';
import { groupUpcomingEvents } from '../lib/eventGroups';
import { Card, DragHandle, SectionTitle, Spinner, EmptyState, ErrorState } from '../components/ui';
import { ProjectBadge } from '../components/ProjectBadge';
import { TaskTable } from '../components/TaskTable';
import { TaskStatChips } from '../components/TaskStatChips';
import {
  arrangerConfig,
  AttentionSection,
  StatsSection,
  type SectionSpec,
} from '../components/SectionCatalog';
import { NewArtistButton } from '../components/EntityButtons';
import { EditableLabel } from '../components/EditableLabel';
import { SectionArranger, parseLayoutEntries } from '../components/SectionArranger';
import { useListReorder, type DragReorder } from '../lib/dragReorder';
import {
  builtinPicker,
  customSectionEntries,
  useNonEmptyCustomSections,
  useRemoveCustomSection,
} from '../components/CustomSections';
import {
  useAllTasks,
  useEventWindowDays,
  useGlobalColumns,
  useLabel,
  useSettingsArray,
} from '../hooks';

/**
 * Rows a block shows before it collapses the rest behind „+ N weitere anzeigen" — the cap
 * `AttentionList` uses, for the same reason (a full season under one heading is a scroll that
 * pushes every section below it off screen). Local rather than imported: it is this list's own
 * presentation choice, not a shared contract.
 *
 * All three blocks carry it, not just „Danach". „Datum offen" sits at the *top* of the section, so
 * an import that leaves 40 events without a date pushes every section below it off the first
 * screen; and the near block is „Danach"'s own argument once `event_window_days` is raised, since
 * 365 is a legal setting and the window then holds the season.
 */
const PREVIEW_ROWS = 8;

export function Dashboard() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.dashboard,
  });
  const customColumns = useGlobalColumns();
  const { data: customSections = [] } = useQuery({
    queryKey: ['customSections', 'dashboard'],
    queryFn: () => api.customSections.list({ scope: 'dashboard' }),
  });
  const eventWindowDays = useEventWindowDays();
  const artistLabel = useLabel()('dash.artists');
  // Still the settings array: there is only one dashboard, so it has nothing to be per-entity
  // about and stays the one page whose layout is a setting (WP-25).
  const dashboardLayout = useSettingsArray('dashboard_layout', parseLayoutEntries);
  const removeCustomSection = useRemoveCustomSection(customSections, dashboardLayout);
  // All dashboard built-ins are computed views — only filled custom widgets block their 🗑.
  const nonEmptyKeys = useNonEmptyCustomSections(customSections);

  // Live + archived, because „Fortschritt" counts finished work while the dashboard's own list is
  // scope 'live' — see useAllTasks (CCL-04).
  const { tasks: allTasks } = useAllTasks();

  // Group every task under the artist it resolves to, for the enriched artist-card stats.
  const tasksByArtist = useMemo(() => {
    const m = new Map<number, Task[]>();
    for (const t of allTasks) {
      if (t.resolved_artist_id == null) continue;
      const arr = m.get(t.resolved_artist_id);
      if (arr) arr.push(t);
      else m.set(t.resolved_artist_id, [t]);
    }
    return m;
  }, [allTasks]);

  // Above the early returns, where every hook has to sit. The server sends one unsliced list; the
  // three blocks the section renders are cut here.
  //
  // The default `fromUtcMs` reads the clock once, when this memo runs, and the deps do not include
  // the date — so a window left open past midnight keeps yesterday's boundary until a write
  // invalidates ['dashboard']. Known and accepted, not an oversight: see „Known sharp edges" in
  // docs/DECISIONS.md.
  const { undated, within, beyond } = useMemo(
    () => groupUpcomingEvents(data?.upcoming ?? [], eventWindowDays),
    [data?.upcoming, eventWindowDays],
  );

  // Above the early returns for the same reason. `/api/dashboard` sends every live artist ordered
  // by `sort_order` (never a slice), so the ids this renumbers are the complete sequence — the
  // condition `useListReorder` is built on.
  const artistDrag = useListReorder(data?.artists ?? [], api.artists.reorder);

  if (isLoading) return <Spinner />;
  if (isError || !data) {
    return <ErrorState title="Übersicht konnte nicht geladen werden." onRetry={() => void refetch()} />;
  }

  // Season-wide todos (no artist, no project): the editable „Festival-Aufgaben" list, which also
  // carries the only create surface for this scope.
  const festivalTasks = data.tasks.filter((t) => !t.artist_id && !t.project_id && !t.resolved_artist_id);

  // Spec order = default section order for fresh layouts.
  const specs: SectionSpec[] = [
    {
      key: 'artists',
      labelKey: 'dash.artists',
      mandatory: true,
      node: (
        <section>
        <SectionTitle right={<NewArtistButton />}>
          <EditableLabel k="dash.artists" />
        </SectionTitle>
        {data.artists.length === 0 ? (
          <EmptyState>Noch keine {artistLabel} angelegt.</EmptyState>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.artists.map((a) => (
              <ArtistCard
                key={a.id}
                artist={a}
                drag={artistDrag}
                tasks={tasksByArtist.get(a.id) ?? []}
              />
            ))}
          </div>
        )}
        </section>
      ),
    },
    {
      key: 'events',
      labelKey: 'dash.events',
      group: 'einblicke',
      node: (
        <section>
        <SectionTitle hint="Übersicht aus allen Künstlern & Projekten — wird automatisch befüllt.">
          <EditableLabel k="dash.events" />
        </SectionTitle>
        {/* Three blocks, each rendered on its own merits. „Danach" used to sit in the `else` of
            „nothing in the next 14 days", so a single event this week hid every later one — the
            bug the customer reported as „es zeigt nur 6 an" (WP-33). Nothing here is conditional
            on another block being empty. */}
        {data.upcoming.length === 0 ? (
          <EmptyState>Keine anstehenden Termine.</EmptyState>
        ) : (
          <div className="space-y-3">
            {undated.length > 0 && (
              <div>
                <Kicker>Datum offen</Kicker>
                <UpcomingList events={undated} cap={PREVIEW_ROWS} />
              </div>
            )}
            {/* No kicker: this is the block the section heading already names, and leaving it bare
                is the layout EventList uses on the artist and project pages. */}
            {within.length > 0 && <UpcomingList events={within} cap={PREVIEW_ROWS} />}
            {beyond.length > 0 && (
              <div>
                <Kicker>Danach</Kicker>
                <UpcomingList events={beyond} cap={PREVIEW_ROWS} />
              </div>
            )}
          </div>
        )}
        </section>
      ),
    },
    // Festival-wide KPIs at a glance — the scannable overview that replaced the long table.
    {
      key: 'stats',
      labelKey: 'dash.stats',
      group: 'einblicke',
      node: <StatsSection labelKey="dash.stats" tasks={allTasks} />,
    },
    {
      key: 'tasks',
      labelKey: 'dash.tasks',
      mandatory: true,
      fullWidth: true,
      node: (
        <section className="space-y-6">
          <SectionTitle>
            <EditableLabel k="dash.tasks" />
          </SectionTitle>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              <EditableLabel k="dash.festival" />
            </h3>
            <TaskTable tasks={festivalTasks} customColumns={customColumns} parent={{ general: true }} />
          </div>
        </section>
      ),
    },
    {
      key: 'aufmerksamkeit',
      labelKey: 'dash.aufmerksamkeit',
      group: 'einblicke',
      fullWidth: true,
      node: <AttentionSection labelKey="dash.aufmerksamkeit" tasks={data.tasks} />,
    },
  ];
  const cfg = arrangerConfig(specs);
  const custom = customSectionEntries(customSections);
  const sections = { ...cfg.sections, ...custom.nodes };

  return (
    <div className="space-y-8">
      <SectionArranger
        layoutKey="dashboard_layout"
        sections={sections}
        labelKeys={cfg.labelKeys}
        titles={custom.titles}
        mandatoryKeys={cfg.mandatoryKeys}
        defaultHidden={cfg.defaultHidden}
        fullWidthKeys={cfg.fullWidthKeys}
        defaultWidths={cfg.defaultWidths}
        nonEmptyKeys={nonEmptyKeys}
        toolbarAfterKey="artists"
        onRemoveCustom={removeCustomSection}
        addAction={builtinPicker(specs, {})}
      />
    </div>
  );
}

/**
 * Reorderable by dragging the ⠿, like the project cards on the artist page. The handle sits in the
 * card's top-right corner rather than in a bar of its own — the artist card's colour strip is 8 px
 * of pure colour with nothing in it, and the season cards already put their handle there
 * (LandingPage). It sits *inside* the card's `<Link>`, which is safe: `DragHandle` swallows the
 * click, so a grab that never became a drag does not navigate into the artist.
 */
function ArtistCard({ artist, drag, tasks }: { artist: ArtistCardT; drag: DragReorder; tasks: Task[] }) {
  return (
    <Link
      to={`/artist/${artist.id}`}
      className={`group relative block rounded-2xl transition ${
        drag.isDropTarget(artist.id) ? 'ring-2 ring-neutral-500' : ''
      } ${drag.isDragging(artist.id) ? 'opacity-40' : ''}`}
      {...drag.itemProps(artist.id)}
    >
      <DragHandle className="absolute right-3 top-4 z-10 text-base" {...drag.handleProps(artist.id)} />
      <Card className="overflow-hidden transition hover:shadow-md">
        <div className="h-2" style={{ background: artist.color }} />
        <div className="p-4">
          {/* pr-6 keeps a long artist name clear of the handle in the corner above it. */}
          <div className="flex items-center gap-2 pr-6">
            {artist.image ? (
              <img
                src={artist.image}
                alt=""
                className="h-8 w-8 rounded-full object-cover ring-1 ring-black/10"
              />
            ) : (
              <span className="h-3 w-3 rounded-full" style={{ background: artist.color }} />
            )}
            <h3 className="text-lg font-semibold text-neutral-800">{artist.name}</h3>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
            <span
              className="rounded-full px-2 py-0.5 font-medium"
              style={{ background: withAlpha(artist.color, 0.15), color: '#525252' }}
            >
              {artist.project_count} {artist.project_count === 1 ? 'Projekt' : 'Projekte'}
            </span>
            <TaskStatChips tasks={tasks} />
          </div>
        </div>
      </Card>
    </Link>
  );
}

/**
 * One block of the events section. `cap` collapses everything past the first `cap` rows behind
 * „+ N weitere anzeigen" — the AttentionList affordance, and the only kind of shortening this
 * section is allowed: a cap without a way to open it is what WP-33 removed.
 *
 * Required, not optional, so that a fourth block cannot be added uncapped by leaving the prop off.
 */
function UpcomingList({ events, cap }: { events: UpcomingEvent[]; cap: number }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? events : events.slice(0, cap);
  const hidden = events.length - shown.length;
  return (
    <ul className="space-y-2">
      {shown.map((ev) => {
        const to = ev.project_id ? `/project/${ev.project_id}` : `/artist/${ev.resolved_artist_id}`;
        return (
          <li key={ev.id}>
            <Link
              to={to}
              className="flex items-start gap-3 rounded-xl bg-white px-3 py-2.5 shadow-sm ring-1 ring-black/5 transition hover:shadow-md"
            >
              <span
                className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: ev.artist_color ?? '#999' }}
              />
              {/* Both formatters answer '' for a null start, so a dateless row would show an
                  empty 9rem column. The pill is EventList's, verbatim — the two views render one
                  thing one way. */}
              <div className="w-36 shrink-0 text-xs font-medium text-neutral-500">
                {ev.start_at ? (
                  <>
                    <span className="mr-1 text-neutral-400">{weekdayShort(ev.start_at)}</span>
                    {formatEventWhen(ev)}
                  </>
                ) : (
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-semibold text-neutral-500">
                    Datum offen
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {ev.project_id && ev.project_code && (
                    <ProjectBadge
                      code={ev.project_code}
                      projectId={ev.project_id}
                      artistColor={ev.artist_color}
                      projectColor={ev.project_color}
                    />
                  )}
                  <span className="font-medium text-neutral-800">{ev.title}</span>
                </div>
                <div className="text-xs text-neutral-400">
                  {ev.artist_name}
                  {ev.location ? <span className="italic"> 📍 {ev.location}</span> : ''}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
      {(hidden > 0 || expanded) && (
        <li>
          <button
            type="button"
            onClick={() => setExpanded((x) => !x)}
            className="px-3 py-1 text-xs font-medium text-neutral-500 transition hover:text-neutral-800"
          >
            {expanded ? 'Weniger anzeigen' : `+ ${hidden} weitere anzeigen`}
          </button>
        </li>
      )}
    </ul>
  );
}

/** The small uppercase heading above a block — „Datum offen" and „Danach" wear the same one. */
function Kicker({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
      {children}
    </div>
  );
}
