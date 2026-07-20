import { useState } from 'react';
import { SectionTitle, Btn, EmptyState } from './ui';
import { ProjectBadge } from './ProjectBadge';
import { EventEditor, type EventParent } from './EventEditor';
import { api } from '../api/client';
import type { EventItem } from '../api/types';
import { formatEventWhen, weekdayShort } from '../lib/dates';
import { Markdown } from './Markdown';
import { TrashIcon } from './icons';
import { useInvalidateAll, useUndoableDelete, resourceUndo } from '../hooks';

const TYPE_COLORS: Record<string, { bg: string; fg: string }> = {
  Auftritt: { bg: '#fef3c7', fg: '#92400e' },
  Termin: { bg: '#e2e8f0', fg: '#334155' },
  Anreise: { bg: '#e0f2fe', fg: '#075985' },
  Deadline: { bg: '#fee2e2', fg: '#991b1b' },
  Probe: { bg: '#ede9fe', fg: '#5b21b6' },
};

function typeColor(type: string) {
  return TYPE_COLORS[type] ?? { bg: '#f1f5f9', fg: '#475569' };
}

export function EventList({
  title = 'Wichtige Termine',
  events,
  parent,
  eventTypes,
  emptyLabel = 'Keine Termine.',
  showProject = false,
}: {
  title?: string;
  events: EventItem[];
  parent: EventParent;
  eventTypes: string[];
  emptyLabel?: string;
  showProject?: boolean;
}) {
  const invalidate = useInvalidateAll();
  const del = useUndoableDelete();
  const [editing, setEditing] = useState<EventItem | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <SectionTitle
        right={
          <Btn variant="subtle" onClick={() => setCreating(true)}>
            + Termin
          </Btn>
        }
      >
        {title}
      </SectionTitle>

      {events.length === 0 ? (
        <EmptyState>{emptyLabel}</EmptyState>
      ) : (
        <ul className="space-y-2">
          {events.map((ev) => {
            const tc = typeColor(ev.type);
            return (
              <li
                key={ev.id}
                className="group flex items-start gap-3 rounded-xl bg-white px-3 py-2.5 shadow-sm ring-1 ring-black/5"
              >
                <div className="mt-0.5 w-32 shrink-0 text-xs font-medium text-neutral-500">
                  <span className="mr-1 text-neutral-400">{weekdayShort(ev.start_at)}</span>
                  {formatEventWhen(ev)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="rounded px-1.5 py-0.5 text-[11px] font-semibold"
                      style={{ background: tc.bg, color: tc.fg }}
                    >
                      {ev.type}
                    </span>
                    {showProject && ev.project_id && ev.project_code && (
                      <ProjectBadge
                        code={ev.project_code}
                        projectId={ev.project_id}
                        artistColor={ev.artist_color}
                        projectColor={ev.project_color}
                        to={`/project/${ev.project_id}`}
                      />
                    )}
                    <span className="font-medium text-neutral-800">{ev.title}</span>
                  </div>
                  {ev.location && <div className="text-sm text-neutral-500">{ev.location}</div>}
                  {ev.notes && (
                    <Markdown className="mt-1 text-sm text-neutral-600">{ev.notes}</Markdown>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                  <Btn variant="ghost" title="Bearbeiten" onClick={() => setEditing(ev)}>
                    ✎
                  </Btn>
                  <Btn
                    variant="ghost"
                    title="Duplizieren"
                    onClick={async () => {
                      await api.duplicateEvent(ev.id);
                      await invalidate();
                    }}
                  >
                    ⧉
                  </Btn>
                  <Btn
                    variant="danger"
                    title="Löschen"
                    onClick={() =>
                      del({ label: `Termin „${ev.title}“`, ...resourceUndo(api.events, ev.id) })
                    }
                  >
                    <TrashIcon className="h-4 w-4" />
                  </Btn>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {(creating || editing) && (
        <EventEditor
          event={editing}
          parent={parent}
          eventTypes={eventTypes}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
