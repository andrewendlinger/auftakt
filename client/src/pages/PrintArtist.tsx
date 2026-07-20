import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { doneValueOf } from '../api/types';
import { Spinner } from '../components/ui';
import { Markdown } from '../components/Markdown';
import { Empty, PrintHeader, PrintPage, Section } from '../components/PrintSheet';
import { formatDate, formatEventWhen, weekdayShort } from '../lib/dates';
import { useLabel, useSaison } from '../hooks';

export function PrintArtist() {
  const { id } = useParams<{ id: string }>();
  const artistId = Number(id);
  const saison = useSaison();
  // The sheet prints whatever the user renamed each section to on the artist page — the
  // headings are the same sections, so a PDF that disagreed with the screen would be the
  // drift this registry exists to prevent.
  const label = useLabel();

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
    <PrintPage>
      <PrintHeader accent={artist.color} kicker={saison} title={artist.name} image={artist.image}>
        {artist.notes && <Markdown className="mt-1 text-sm text-neutral-600">{artist.notes}</Markdown>}
      </PrintHeader>

      <Section title={label('artist.kontakte')}>
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

      <Section title={label('artist.termine')}>
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

      {/* "n offen" rather than a fixed „Offene “ prefix: the sheet omits done tasks and has to
          keep saying so, but the prefix would read „Offene Alle Aufgaben“ once renamed. */}
      <Section title={`${label('artist.aufgaben')} (${openTasks.length} offen)`}>
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
    </PrintPage>
  );
}
