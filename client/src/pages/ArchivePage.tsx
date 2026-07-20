import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { SectionTitle, Spinner, EmptyState } from '../components/ui';
import { ProjectBadge } from '../components/ProjectBadge';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { TextInput } from '../components/fields';
import { formatDate } from '../lib/dates';
import { Markdown } from '../components/Markdown';

export function ArchivePage() {
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['archive'],
    queryFn: () => api.tasks.list({ scope: 'archive' }),
  });
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return tasks;
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(needle) ||
        (t.comment ?? '').toLowerCase().includes(needle) ||
        (t.artist_name ?? '').toLowerCase().includes(needle) ||
        (t.project_code ?? '').toLowerCase().includes(needle),
    );
  }, [tasks, q]);

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-5">
      <Breadcrumbs trail={[{ label: 'Übersicht', to: '/' }, { label: 'Archiv' }]} />
      <SectionTitle
        right={
          <TextInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Archiv durchsuchen…"
            className="w-64"
          />
        }
      >
        Archiv · erledigte Aufgaben (älter als 30 Tage)
      </SectionTitle>

      {filtered.length === 0 ? (
        <EmptyState>
          {tasks.length === 0
            ? 'Noch nichts archiviert. Erledigte Aufgaben wandern 30 Tage nach Abschluss hierher.'
            : 'Keine Treffer.'}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-400">
                <th className="px-3 py-2">Aufgabe</th>
                <th className="px-3 py-2">Zuordnung</th>
                <th className="px-3 py-2">Erledigt am</th>
                <th className="px-3 py-2">Kommentar</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id} className="border-b border-neutral-50 align-top text-neutral-500">
                  <td className="px-3 py-2 font-medium text-neutral-700 line-through">{t.title}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5 whitespace-nowrap">
                      {t.resolved_artist_id && (
                        <Link to={`/artist/${t.resolved_artist_id}`} className="hover:underline">
                          {t.artist_name}
                        </Link>
                      )}
                      {t.project_id && t.project_code && (
                        <ProjectBadge
                          code={t.project_code}
                          projectId={t.project_id}
                          artistColor={t.artist_color}
                          projectColor={t.project_color}
                          to={`/project/${t.project_id}`}
                        />
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{t.erledigt_am ? formatDate(t.erledigt_am) : ''}</td>
                  <td className="max-w-md px-3 py-2"><Markdown>{t.comment}</Markdown></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
