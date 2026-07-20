import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { CustomColumn, Task } from '../api/types';
import { customValueOf, doneValueOf, parseColumnOptions } from '../api/types';
import { Spinner } from '../components/ui';
import { Markdown } from '../components/Markdown';
import { Empty, PrintHeader, PrintPage, Section } from '../components/PrintSheet';
import { contrastText, projectShade } from '../lib/colors';
import { formatDate, formatEventWhen, weekdayShort } from '../lib/dates';
import { useSaison } from '../hooks';

export function PrintProject() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const saison = useSaison();

  const { data, isLoading } = useQuery({
    queryKey: ['print-project', projectId],
    queryFn: async () => {
      // The artist alone depends on the fetched project (for the name and the accent colour).
      const [project, events, contacts, tasks, globalCols, projectCols] = await Promise.all([
        api.projects.get(projectId),
        api.events.list({ project_id: projectId }),
        api.contacts.list({ project_id: projectId }),
        api.tasks.list({ project_id: projectId }),
        api.customColumns.list({ scope: 'global' }),
        api.customColumns.list({ scope: 'project', project_id: projectId }),
      ]);
      const artist = await api.artists.get(project.artist_id);
      // Global columns first, then project ones — same order as the live page.
      return { project, artist, events, contacts, tasks, columns: [...globalCols, ...projectCols] };
    },
  });

  if (isLoading || !data) return <Spinner />;
  const { project, artist, events, contacts, tasks, columns } = data;
  const shade = projectShade(artist?.color ?? '#888888', project.color, project.id);

  const openTasks = tasks.filter((t) => t.status !== doneValueOf(columns));
  const groups = groupByStatus(openTasks, columns);
  const customCols = columns
    .filter((c) => c.kind === 'custom' && c.enabled)
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);

  return (
    <PrintPage>
      <PrintHeader
        accent={shade}
        kicker={`${saison}${artist ? ` · ${artist.name}` : ''}`}
        title={project.name}
        badges={
          <>
            {project.code && (
              <span
                className="rounded-md px-2 py-0.5 text-sm font-bold"
                style={{ background: shade, color: contrastText(shade) }}
              >
                {project.code}
              </span>
            )}
            {project.status && (
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
                {project.status}
              </span>
            )}
          </>
        }
      >
        {project.description && (
          <Markdown className="mt-1 text-sm text-neutral-600">{project.description}</Markdown>
        )}
      </PrintHeader>

      {project.notes && (
        <Section title="Notizen">
          <Markdown className="text-sm text-neutral-700">{project.notes}</Markdown>
        </Section>
      )}

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
          // One table across all groups so the columns line up; each status is a spanning
          // header row rather than its own table.
          <table className="w-full text-sm">
            {customCols.length > 0 && (
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-neutral-400">
                  <th className="w-4" />
                  <th className="py-1 pr-3 font-medium">Aufgabe</th>
                  {customCols.map((c) => (
                    <th key={c.id} className="py-1 pr-3 font-medium">
                      {c.name}
                    </th>
                  ))}
                  <th className="w-24 py-1 font-medium">Fällig</th>
                </tr>
              </thead>
            )}
            {groups.map((g) => (
              <tbody key={g.label}>
                <tr>
                  <td colSpan={customCols.length + 3} className="pb-1 pt-4">
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-semibold text-neutral-700"
                      style={{ background: g.color }}
                    >
                      {g.label} ({g.tasks.length})
                    </span>
                  </td>
                </tr>
                {g.tasks.map((t) => (
                  <tr key={t.id} className="border-b border-neutral-100 align-top">
                    <td className="w-4 py-1 pr-2">☐</td>
                    <td className="py-1 pr-3">{t.title}</td>
                    {customCols.map((c) => (
                      <td key={c.id} className="py-1 pr-3 text-neutral-600">
                        {printCustomValue(t, c)}
                      </td>
                    ))}
                    <td className="w-24 py-1 text-neutral-500">
                      {t.due_date ? formatDate(t.due_date) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        )}
      </Section>
    </PrintPage>
  );
}

interface StatusGroup {
  label: string;
  color: string;
  tasks: Task[];
}

/**
 * One block per configured Status option, in the column's own order, skipping empty ones.
 * Driven off the options rather than hardcoded names, so "In Arbeit" and any user-added
 * status get a block for free. Statuses matching no option land in a trailing catch-all so
 * a stale value can never make a task vanish from the sheet.
 */
function groupByStatus(tasks: Task[], columns: CustomColumn[]): StatusGroup[] {
  const statusCol = columns.find((c) => c.kind === 'builtin' && c.key === 'status');
  const options = parseColumnOptions(statusCol?.options);
  const groups = options
    .filter((o) => !o.done)
    .map((o) => ({
      label: o.label,
      color: o.color,
      tasks: tasks.filter((t) => t.status === o.value),
    }))
    .filter((g) => g.tasks.length > 0);

  const known = new Set(options.map((o) => o.value));
  const rest = tasks.filter((t) => !known.has(t.status));
  if (rest.length > 0) groups.push({ label: 'Ohne Status', color: '#d4d4d4', tasks: rest });
  return groups;
}

function printCustomValue(task: Task, col: CustomColumn): string {
  const raw = customValueOf(task, col.id);
  if (!raw) return '';
  if (col.type === 'checkbox') return raw === 'true' ? '✓' : '';
  if (col.type === 'select') {
    return parseColumnOptions(col.options).find((o) => o.value === raw)?.label ?? raw;
  }
  if (col.type === 'date') return formatDate(raw);
  return raw;
}
