import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Task } from '../api/types';
import { attentionTasks, duePhrase } from '../lib/taskStats';
import { daysUntil } from '../lib/dates';
import { ProjectBadge } from './ProjectBadge';
import { EmptyState } from './ui';
import { useDoneValue } from '../hooks';

const ROW_CLS =
  'flex items-center gap-3 rounded-xl bg-white px-3 py-2.5 shadow-sm ring-1 ring-black/5 transition';

/**
 * How many rows the section shows before it collapses the rest behind „+ N weitere".
 *
 * The list was unbounded, and on a real festival season with 80 overdue tasks it became an
 * 80-row scroll that pushed every section below it off screen — the long read-only table this
 * component exists to replace (TTU-32). The cap is what makes „the short, actionable slice"
 * true; the affordance is what keeps the rest reachable.
 */
const PREVIEW_ROWS = 8;

/**
 * „Braucht Aufmerksamkeit" — the short, actionable slice of a task set: overdue plus everything
 * due within `windowDays`, most-urgent first. Read-only; each row links into the project (or
 * artist) where the task is edited, mirroring the dashboard's upcoming-events list. Reused on the
 * dashboard (festival-wide) and the artist page (that artist's tasks).
 */
export function AttentionList({ tasks, windowDays }: { tasks: Task[]; windowDays: number }) {
  const doneValue = useDoneValue();
  const [expanded, setExpanded] = useState(false);
  // Memoised: the filter+sort ran on every render of the page around it, and the page re-renders
  // for every toast, every write and every refetch.
  const items = useMemo(
    () => attentionTasks(tasks, doneValue, windowDays),
    [tasks, doneValue, windowDays],
  );
  const shown = expanded ? items : items.slice(0, PREVIEW_ROWS);
  const hidden = items.length - shown.length;
  if (items.length === 0) return <EmptyState>Nichts Dringendes.</EmptyState>;
  return (
    <ul className="space-y-2">
      {shown.map((t) => {
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
