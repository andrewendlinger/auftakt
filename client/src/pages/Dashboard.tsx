import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { ArtistCard as ArtistCardT, EventItem } from '../api/types';
import { contrastText, withAlpha } from '../lib/colors';
import { formatEventWhen, weekdayShort } from '../lib/dates';
import { Card, SectionTitle, Spinner, EmptyState, IconButton } from '../components/ui';
import { ProjectBadge } from '../components/ProjectBadge';
import { TaskTable } from '../components/TaskTable';
import { NewArtistButton } from '../components/EntityButtons';
import { ExcelButton } from '../components/ExcelButton';

export function Dashboard() {
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });
  const { data: customColumns = [] } = useQuery({
    queryKey: ['customColumns', 'global'],
    queryFn: () => api.customColumns.list({ scope: 'global' }),
  });
  const [artistFilter, setArtistFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');

  const projectOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const t of data?.tasks ?? []) {
      if (t.project_id && t.project_code) map.set(t.project_id, `${t.project_code} · ${t.project_name}`);
    }
    return [...map.entries()];
  }, [data]);

  if (isLoading || !data) return <Spinner />;

  const tasks = data.tasks.filter(
    (t) =>
      (!artistFilter || String(t.resolved_artist_id) === artistFilter) &&
      (!projectFilter || String(t.project_id) === projectFilter),
  );

  return (
    <div className="space-y-10">
      <section>
        <SectionTitle right={<NewArtistButton />}>Künstler</SectionTitle>
        {data.artists.length === 0 ? (
          <EmptyState>Noch keine Künstler angelegt.</EmptyState>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.artists.map((a) => (
              <ArtistCard key={a.id} artist={a} />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle>Nächste Termine · 14 Tage</SectionTitle>
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

      <section>
        <SectionTitle
          right={
            <div className="flex items-center gap-2">
              <select
                value={artistFilter}
                onChange={(e) => setArtistFilter(e.target.value)}
                className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-sm"
              >
                <option value="">Alle Künstler</option>
                {data.artists.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-sm"
              >
                <option value="">Alle Projekte</option>
                {projectOptions.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
              {(artistFilter || projectFilter) && (
                <IconButton
                  title="Filter zurücksetzen"
                  onClick={() => {
                    setArtistFilter('');
                    setProjectFilter('');
                  }}
                >
                  ×
                </IconButton>
              )}
              <ExcelButton
                params={{
                  scope: 'live',
                  artist_id: artistFilter || undefined,
                  project_id: projectFilter || undefined,
                }}
              />
            </div>
          }
        >
          Alle Aufgaben
        </SectionTitle>
        <TaskTable
          tasks={tasks}
          customColumns={customColumns}
          showAssignment
          parent={artistFilter || projectFilter ? undefined : { general: true }}
        />
      </section>
    </div>
  );
}

function ArtistCard({ artist }: { artist: ArtistCardT }) {
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
          <div className="mt-3 flex gap-2 text-xs">
            <span
              className="rounded-full px-2 py-0.5 font-medium"
              style={{ background: withAlpha(artist.color, 0.15), color: '#525252' }}
            >
              {artist.project_count} {artist.project_count === 1 ? 'Projekt' : 'Projekte'}
            </span>
            <span
              className="rounded-full px-2 py-0.5 font-medium"
              style={{
                background: artist.open_task_count > 0 ? artist.color : '#f1f5f9',
                color: artist.open_task_count > 0 ? contrastText(artist.color) : '#94a3b8',
              }}
            >
              {artist.open_task_count} offen
            </span>
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
                  {ev.location ? ` · ${ev.location}` : ''}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
