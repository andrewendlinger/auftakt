import { useState } from 'react';
import { SectionTitle, Btn, EmptyState } from './ui';
import { ProjectBadge } from './ProjectBadge';
import { EventEditor, type EventParent } from './EventEditor';
import { api } from '../api/client';
import type { CustomColumnOption, EventItem } from '../api/types';
import { contrastText } from '../lib/colors';
import { formatEventWhen, weekdayShort } from '../lib/dates';
import { Markdown } from './Markdown';
import { TrashIcon } from './icons';
import { EditableLabel } from './EditableLabel';
import type { LabelKey } from '../lib/labels';
import { useInvalidateAll, useUndoableDelete, resourceUndo } from '../hooks';

export function EventList({
  titleKey,
  events,
  parent,
  eventTypes,
  emptyLabel = 'Keine Termine.',
  showProject = false,
}: {
  /** Heading id — the text itself lives in `lib/labels.ts` and is user-renameable. */
  titleKey: LabelKey;
  events: EventItem[];
  parent: EventParent;
  /** Coloured event-type options; the chip colour + label are looked up by `events.type`. */
  eventTypes: CustomColumnOption[];
  emptyLabel?: string;
  showProject?: boolean;
}) {
  const invalidate = useInvalidateAll();
  const del = useUndoableDelete();
  const [editing, setEditing] = useState<EventItem | null>(null);
  const [creating, setCreating] = useState(false);
  const typeByValue = new Map(eventTypes.map((o) => [o.value, o]));
  // Date-less (TBD) events form their own block on top — they still need scheduling and
  // should not get lost below the chronology.
  const undated = events.filter((ev) => !ev.start_at);
  const dated = events.filter((ev) => ev.start_at);

  const renderEvent = (ev: EventItem) => {
    const opt = typeByValue.get(ev.type);
    const bg = opt?.color ?? '#f1f5f9';
    return (
      <li
        key={ev.id}
        className="group flex items-start gap-3 rounded-xl bg-white px-3 py-2.5 shadow-sm ring-1 ring-black/5"
      >
        <div className="mt-0.5 w-32 shrink-0 text-xs font-medium text-neutral-500">
          {ev.start_at ? (
            <>
              <span className="mr-1 text-neutral-400">{weekdayShort(ev.start_at)}</span>
              {formatEventWhen(ev)}
            </>
          ) : (
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-semibold text-neutral-500">
              Datum offen
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded px-1.5 py-0.5 text-[11px] font-semibold"
              style={{ background: bg, color: contrastText(bg) }}
            >
              {opt?.label ?? ev.type}
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
          {ev.notes && <Markdown className="mt-1 text-sm text-neutral-600">{ev.notes}</Markdown>}
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
            onClick={() => del({ label: `Termin „${ev.title}“`, ...resourceUndo(api.events, ev.id) })}
          >
            <TrashIcon className="h-4 w-4" />
          </Btn>
        </div>
      </li>
    );
  };

  return (
    <div>
      <SectionTitle
        right={
          <Btn variant="subtle" onClick={() => setCreating(true)}>
            + Termin
          </Btn>
        }
      >
        <EditableLabel k={titleKey} />
      </SectionTitle>

      {events.length === 0 ? (
        <EmptyState>{emptyLabel}</EmptyState>
      ) : (
        <div className="space-y-3">
          {undated.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Datum offen
              </div>
              <ul className="space-y-2">{undated.map(renderEvent)}</ul>
            </div>
          )}
          {dated.length > 0 && <ul className="space-y-2">{dated.map(renderEvent)}</ul>}
        </div>
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
