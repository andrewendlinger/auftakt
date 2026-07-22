import { Link } from 'react-router-dom';
import type { Task } from '../api/types';
import { attentionTasks, duePhrase } from '../lib/taskStats';
import { daysUntil } from '../lib/dates';
import { ProjectBadge } from './ProjectBadge';
import { EmptyState } from './ui';

const ROW_CLS =
  'flex items-center gap-3 rounded-xl bg-white px-3 py-2.5 shadow-sm ring-1 ring-black/5 transition';

/**
 * „Braucht Aufmerksamkeit" — the short, actionable slice of a task set: overdue plus everything
 * due within `windowDays`, most-urgent first. Read-only; each row links into the project (or
 * artist) where the task is edited, mirroring the dashboard's upcoming-events list. Reused on the
 * dashboard (festival-wide) and the artist page (that artist's tasks).
 */
export function AttentionList({
  tasks,
  doneValue,
  windowDays,
}: {
  tasks: Task[];
  doneValue: string;
  windowDays: number;
}) {
  const items = attentionTasks(tasks, doneValue, windowDays);
  if (items.length === 0) return <EmptyState>Nichts Dringendes.</EmptyState>;
  return (
    <ul className="space-y-2">
      {items.map((t) => {
        const overdue = (daysUntil(t.due_date) ?? 0) < 0;
        const to = t.project_id
          ? `/project/${t.project_id}`
          : t.resolved_artist_id
            ? `/artist/${t.resolved_artist_id}`
            : null;
        const inner = (
          <>
            <span className={`h-2 w-2 shrink-0 rounded-full ${overdue ? 'bg-amber-500' : 'bg-neutral-300'}`} />
            <span className="min-w-0 flex-1 truncate font-medium text-neutral-800">{t.title}</span>
            {t.project_id && (t.project_code || t.project_name) ? (
              <ProjectBadge
                code={t.project_code || t.project_name!}
                projectId={t.project_id}
                artistColor={t.artist_color}
                projectColor={t.project_color}
              />
            ) : (
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500">
                Allgemein
              </span>
            )}
            <span className={`shrink-0 text-xs font-medium ${overdue ? 'text-amber-700' : 'text-neutral-500'}`}>
              {duePhrase(t.due_date)}
            </span>
          </>
        );
        return (
          <li key={t.id}>
            {to ? (
              <Link to={to} className={`${ROW_CLS} hover:shadow-md`}>
                {inner}
              </Link>
            ) : (
              <div className={ROW_CLS}>{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
