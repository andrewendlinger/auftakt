import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { doneValueOf } from '../api/types';
import { Spinner } from '../components/ui';
import { Markdown } from '../components/Markdown';
import { formatDate, formatEventWhen, weekdayShort } from '../lib/dates';
import { useSaison } from '../hooks';

export function PrintArtist() {
  const { id } = useParams<{ id: string }>();
  const artistId = Number(id);
  const saison = useSaison();

  const { data, isLoading } = useQuery({
    queryKey: ['print-artist', artistId],
    queryFn: async () => {
      // These four are independent; contacts alone depend on the fetched projects.
      const [artist, projects, events, tasks, columns] = await Promise.all([
        api.artists.get(artistId),
        api.projects.list({ artist_id: artistId }),
        api.events.list({ resolved_artist_id: artistId }),
        api.tasks.list({ resolved_artist_id: artistId }),
        api.customColumns.list({ scope: 'global' }),
      ]);
      const contactLists = await Promise.all([
        api.contacts.list({ artist_id: artistId }),
        ...projects.map((p) => api.contacts.list({ project_id: p.id })),
      ]);
      return { artist, events, tasks, columns, contacts: contactLists.flat() };
    },
  });

  if (isLoading || !data) return <Spinner />;
  const { artist, events, tasks, columns, contacts } = data;
  // "Open" = not the Status column's terminal "done" category.
  const doneValue = doneValueOf(columns);
  const openTasks = tasks.filter((t) => t.status !== doneValue);

  return (
    <div className="mx-auto max-w-3xl bg-white p-10 print-page">
      <div className="no-print mb-6 flex justify-end">
        <button
          onClick={() => window.print()}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          Als PDF speichern / Drucken
        </button>
      </div>

      <header className="mb-6 flex items-start gap-4 border-b-4 pb-3" style={{ borderColor: artist.color }}>
        {artist.image && (
          <img src={artist.image} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover" />
        )}
        <div>
          <div className="text-xs uppercase tracking-widest text-neutral-400">{saison}</div>
          <h1 className="text-3xl font-bold text-neutral-900">{artist.name}</h1>
          {artist.notes && <Markdown className="mt-1 text-sm text-neutral-600">{artist.notes}</Markdown>}
        </div>
      </header>

      <Section title="Kontakte">
        {contacts.length === 0 ? (
          <Empty />
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-b border-neutral-100">
                  <td className="py-1 pr-4 font-medium">{c.name}</td>
                  <td className="py-1 pr-4 text-neutral-500">{c.role}</td>
                  <td className="py-1 pr-4">{c.email}</td>
                  <td className="py-1">{c.phone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Wichtige Termine">
        {events.length === 0 ? (
          <Empty />
        ) : (
          <ul className="space-y-1 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex gap-3">
                <span className="w-40 shrink-0 text-neutral-500">
                  {weekdayShort(e.start_at)} {formatEventWhen(e)}
                </span>
                <span>
                  <span className="font-medium">{e.title}</span>
                  {e.project_code ? <span className="ml-1 text-neutral-400">[{e.project_code}]</span> : ''}
                  {e.location ? <span className="text-neutral-500"> · {e.location}</span> : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Offene Aufgaben (${openTasks.length})`}>
        {openTasks.length === 0 ? (
          <Empty />
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {openTasks.map((t) => (
                <tr key={t.id} className="border-b border-neutral-100 align-top">
                  <td className="w-4 py-1 pr-2">☐</td>
                  <td className="py-1 pr-3">
                    {t.title}
                    {t.project_code ? <span className="ml-1 text-neutral-400">[{t.project_code}]</span> : ''}
                  </td>
                  <td className="w-24 py-1 text-neutral-500">{t.due_date ? formatDate(t.due_date) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-neutral-700">{title}</h2>
      {children}
    </section>
  );
}

function Empty() {
  return <p className="text-sm text-neutral-400">—</p>;
}
