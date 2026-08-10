import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { type Contact, type Task } from '../api/types';
import { Spinner, ErrorState, LoadError } from '../components/ui';
import { isValidId } from '../lib/routeParams';
import { Markdown } from '../components/Markdown';
import {
  Empty,
  PrintContacts,
  PrintEvents,
  PrintFallback,
  PrintHeader,
  PrintPage,
  Section,
} from '../components/PrintSheet';
import { formatDate } from '../lib/dates';
import { useDoneValue, useLabel, useSaison } from '../hooks';

export function PrintArtist() {
  const { id } = useParams<{ id: string }>();
  const artistId = Number(id);
  const validId = isValidId(artistId);
  const saison = useSaison();
  // The sheet prints whatever the user renamed each section to on the artist page — the
  // headings are the same sections, so a PDF that disagreed with the screen would be the
  // drift this registry exists to prevent.
  const label = useLabel();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['print-artist', artistId],
    enabled: validId,
    queryFn: async () => {
      // One unfiltered contact list rather than one request per project — the season's contacts
      // are a handful of rows and the filtering is a comparison, the trade CustomSections and
      // SettingsPage already make. Fetching them per project made the sheet wait for a second
      // round-trip wave that grew with the artist's project count (PGS-25).
      const [artist, projects, events, tasks, allContacts] = await Promise.all([
        api.artists.get(artistId),
        api.projects.list({ artist_id: artistId }),
        api.events.list({ resolved_artist_id: artistId }),
        api.tasks.list({ resolved_artist_id: artistId, order: 'due' }),
        api.contacts.list(),
      ]);
      // `projects` holds the live ones, so a contact hanging off a project in the Papierkorb
      // stays out — as it did when its project was never asked about. Rank keeps the printed
      // order: the artist's own contacts first, then per project in the project list's order,
      // each group still in the server's sort_order (the sort is stable).
      const rank = new Map(projects.map((p, i) => [p.id, i + 1]));
      const rankOf = (c: Contact) => (c.artist_id === artistId ? 0 : (rank.get(c.project_id ?? -1) ?? 0));
      const contacts = allContacts
        .filter((c) => c.artist_id === artistId || rank.has(c.project_id ?? -1))
        .sort((a, b) => rankOf(a) - rankOf(b));
      return { artist, events, tasks, contacts };
    },
  });

  // "Open" = not the Status column's terminal "done" category. The handout mirrors the app's
  // general/project split: general (no project) and project tasks each get their own subsection.
  const doneValue = useDoneValue();

  if (!validId) {
    return (
      <PrintFallback>
        <ErrorState title="Künstler nicht gefunden" hint="Diese Adresse enthält keine gültige Künstler-Nummer." />
      </PrintFallback>
    );
  }
  if (isLoading) return <Spinner />;
  // The sheet is the artist, so this one stays fatal — but it now says so instead of spinning.
  if (isError || !data) {
    return (
      <PrintFallback>
        <LoadError
          error={error}
          notFound="Künstler nicht gefunden"
          failed="Der Ein-Pager konnte nicht geladen werden."
          onRetry={() => void refetch()}
        />
      </PrintFallback>
    );
  }
  const { artist, events, tasks, contacts } = data;
  const openTasks = tasks.filter((t) => t.status !== doneValue);
  const generalOpen = openTasks.filter((t) => !t.project_id);
  const projectOpen = openTasks.filter((t) => t.project_id);

  return (
    <PrintPage>
      <PrintHeader accent={artist.color} kicker={saison} title={artist.name} image={artist.image}>
        {artist.notes && <Markdown className="mt-1 text-sm text-neutral-600">{artist.notes}</Markdown>}
      </PrintHeader>

      <Section title={label('artist.kontakte')}>
        <PrintContacts contacts={contacts} />
      </Section>

      {/* The artist's events span every project, so each one names its own. */}
      <Section title={label('artist.termine')}>
        <PrintEvents events={events} showProjectCode />
      </Section>

      {/* "n offen" rather than a fixed „Offene “ prefix: the sheet omits done tasks and has to
          keep saying so, but the prefix would read „Offene Allgemeine Aufgaben“ once renamed. */}
      <Section title={`${label('artist.aufgaben')} (${generalOpen.length} offen)`}>
        <PrintTaskTable tasks={generalOpen} />
      </Section>

      <Section title={`${label('artist.projektaufgaben')} (${projectOpen.length} offen)`}>
        <PrintTaskTable tasks={projectOpen} />
      </Section>
    </PrintPage>
  );
}

/** Checkbox list of open tasks; the project code rides along as a `[K-code]` tag when present. */
function PrintTaskTable({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) return <Empty />;
  return (
    <table className="w-full text-sm">
      <tbody>
        {tasks.map((t) => (
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
  );
}
