import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { ArtistCard as ArtistCardT, EventItem, Task } from '../api/types';
import { withAlpha } from '../lib/colors';
import { formatEventWhen, weekdayShort } from '../lib/dates';
import { Card, SectionTitle, Spinner, EmptyState, ErrorState } from '../components/ui';
import { ProjectBadge } from '../components/ProjectBadge';
import { TaskTable } from '../components/TaskTable';
import { TaskStatChips } from '../components/TaskStatChips';
import { AttentionList } from '../components/AttentionList';
import { NewArtistButton } from '../components/EntityButtons';
import { EditableLabel } from '../components/EditableLabel';
import { SectionArranger, parseLayoutEntries } from '../components/SectionArranger';
import {
  builtinPicker,
  customSectionEntries,
  useNonEmptyCustomSections,
  useRemoveCustomSection,
  type SectionGroup,
} from '../components/CustomSections';
import type { LabelKey } from '../lib/labels';
import {
  useAllTasks,
  useGlobalColumns,
  useLabel,
  useSettingsArray,
  useTaskStatsConfig,
} from '../hooks';

/** Which heading names each section in the "Bereiche bearbeiten" strip. */
const SECTION_LABEL_KEYS: Record<string, LabelKey> = {
  artists: 'dash.artists',
  events: 'dash.events',
  stats: 'dash.stats',
  tasks: 'dash.tasks',
  aufmerksamkeit: 'dash.aufmerksamkeit',
};

/** Picker group of each optional built-in — everything here is computed, hence „Einblicke". */
const SECTION_GROUPS: Record<string, SectionGroup> = {
  events: 'einblicke',
  stats: 'einblicke',
  aufmerksamkeit: 'einblicke',
};

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
  const { windowDays } = useTaskStatsConfig();
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

  if (isLoading) return <Spinner />;
  if (isError || !data) {
    return <ErrorState title="Übersicht konnte nicht geladen werden." onRetry={() => void refetch()} />;
  }

  // Season-wide todos (no artist, no project): the editable „Festival-Aufgaben" list, which also
  // carries the only create surface for this scope.
  const festivalTasks = data.tasks.filter((t) => !t.artist_id && !t.project_id && !t.resolved_artist_id);

  const sections: Record<string, ReactNode> = {
    artists: (
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
                tasks={tasksByArtist.get(a.id) ?? []}
              />
            ))}
          </div>
        )}
      </section>
    ),
    events: (
      <section>
        <SectionTitle>
          <EditableLabel k="dash.events" />
        </SectionTitle>
        {data.upcoming14.length === 0 ? (
          <div className="space-y-3">
            <EmptyState>Keine Termine in den nächsten 14 Tagen.</EmptyState>
            {data.nextUp.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">Danach</div>
                <UpcomingList events={data.nextUp} />
              </div>
            )}
          </div>
        ) : (
          <UpcomingList events={data.upcoming14} />
        )}
      </section>
    ),
    // Festival-wide KPIs at a glance — the scannable overview that replaced the long table.
    stats: (
      <section>
        <SectionTitle>
          <EditableLabel k="dash.stats" />
        </SectionTitle>
        <TaskStatChips tasks={allTasks} variant="tiles" />
      </section>
    ),
    tasks: (
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
    aufmerksamkeit: (
      <section>
        <SectionTitle>
          <EditableLabel k="dash.aufmerksamkeit" />
        </SectionTitle>
        <AttentionList tasks={data.tasks} windowDays={windowDays} />
      </section>
    ),
  };
  const custom = customSectionEntries(customSections);
  Object.assign(sections, custom.nodes);

  return (
    <div className="space-y-8">
      <SectionArranger
        layoutKey="dashboard_layout"
        sections={sections}
        labelKeys={SECTION_LABEL_KEYS}
        titles={custom.titles}
        mandatoryKeys={['artists', 'tasks']}
        fullWidthKeys={['tasks', 'aufmerksamkeit']}
        nonEmptyKeys={nonEmptyKeys}
        toolbarAfterKey="artists"
        onRemoveCustom={removeCustomSection}
        addAction={builtinPicker(SECTION_LABEL_KEYS, SECTION_GROUPS, {})}
      />
    </div>
  );
}

function ArtistCard({ artist, tasks }: { artist: ArtistCardT; tasks: Task[] }) {
  return (
    <Link to={`/artist/${artist.id}`}>
      <Card className="overflow-hidden transition hover:shadow-md">
        <div className="h-2" style={{ background: artist.color }} />
        <div className="p-4">
          <div className="flex items-center gap-2">
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

function UpcomingList({ events }: { events: EventItem[] }) {
  return (
    <ul className="space-y-2">
      {events.map((ev) => {
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
              <div className="w-36 shrink-0 text-xs font-medium text-neutral-500">
                <span className="mr-1 text-neutral-400">{weekdayShort(ev.start_at)}</span>
                {formatEventWhen(ev)}
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
    </ul>
  );
}
