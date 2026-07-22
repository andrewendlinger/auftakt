import { type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Project, Task } from '../api/types';
import { doneValueOf } from '../api/types';
import { contrastText, projectShade, withAlpha } from '../lib/colors';
import { arrayMoveTo } from '../lib/arrays';
import { useDragReorder } from '../lib/dragReorder';
import { Markdown } from '../components/Markdown';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { SectionArranger } from '../components/SectionArranger';
import { EditableLabel } from '../components/EditableLabel';
import type { LabelKey } from '../lib/labels';
import { Card, DragHandle, SectionTitle, Spinner, EmptyState } from '../components/ui';
import { EventList } from '../components/EventList';
import { ContactList } from '../components/ContactList';
import { TaskTable } from '../components/TaskTable';
import { TaskStatChips } from '../components/TaskStatChips';
import { AttentionList } from '../components/AttentionList';
import { EditArtistButton, NewProjectButton } from '../components/EntityButtons';
import { ProjectStatusPill } from '../components/ProjectStatusPill';
import { ExcelButton } from '../components/ExcelButton';
import { useEventTypeOptions, useInvalidateAll, useTaskStatsConfig } from '../hooks';

/** Which heading names each section in the "Bereiche anordnen" strip. */
const SECTION_LABEL_KEYS = {
  termine: 'artist.termine',
  aufmerksamkeit: 'artist.aufmerksamkeit',
  projekte: 'artist.projekte',
  kontakte: 'artist.kontakte',
  aufgaben: 'artist.aufgaben',
} as const satisfies Record<string, LabelKey>;

export function ArtistPage() {
  const { id } = useParams<{ id: string }>();
  const artistId = Number(id);
  const eventTypes = useEventTypeOptions();
  const { windowDays } = useTaskStatsConfig();

  const { data: artist, isLoading } = useQuery({
    queryKey: ['artist', artistId],
    queryFn: () => api.artists.get(artistId),
  });
  const { data: projects = [] } = useQuery({
    queryKey: ['artist', artistId, 'projects'],
    queryFn: () => api.projects.list({ artist_id: artistId }),
  });
  const { data: events = [] } = useQuery({
    queryKey: ['artist', artistId, 'events'],
    queryFn: () => api.events.list({ resolved_artist_id: artistId }),
  });
  const { data: contacts = [] } = useQuery({
    queryKey: ['artist', artistId, 'contacts'],
    queryFn: () => api.contacts.list({ artist_id: artistId }),
  });
  const { data: tasks = [] } = useQuery({
    queryKey: ['artist', artistId, 'tasks'],
    queryFn: () => api.tasks.list({ resolved_artist_id: artistId }),
  });
  const { data: customColumns = [] } = useQuery({
    queryKey: ['customColumns', 'global'],
    queryFn: () => api.customColumns.list({ scope: 'global' }),
  });

  if (isLoading || !artist) return <Spinner />;
  const color = artist.color;

  // The single resolved-task list splits cleanly on `project_id`: general (artist-level) tasks are
  // the only editable table; project tasks feed the per-project card stats. A subtask inherits its
  // parent's project_id, so whole trees stay on the same side of the split.
  const doneValue = doneValueOf(customColumns);
  const generalTasks = tasks.filter((t) => !t.project_id);
  const tasksByProject = new Map<number, Task[]>();
  for (const t of tasks) {
    if (t.project_id != null) {
      const arr = tasksByProject.get(t.project_id);
      if (arr) arr.push(t);
      else tasksByProject.set(t.project_id, [t]);
    }
  }

  const sections: Record<string, ReactNode> = {
    termine: (
      <EventList
        titleKey="artist.termine"
        events={events}
        parent={{ artist_id: artistId }}
        eventTypes={eventTypes}
        showProject
        emptyLabel="Keine Termine für diesen Künstler."
      />
    ),
    aufmerksamkeit: (
      <>
        <SectionTitle>
          <EditableLabel k="artist.aufmerksamkeit" />
        </SectionTitle>
        <AttentionList tasks={tasks} doneValue={doneValue} windowDays={windowDays} />
      </>
    ),
    projekte: (
      <>
        <SectionTitle right={<NewProjectButton artistId={artistId} artistColor={color} />}>
          <EditableLabel k="artist.projekte" />
        </SectionTitle>
        {projects.length === 0 ? (
          <EmptyState>Noch keine Projekte.</EmptyState>
        ) : (
          <ProjectGrid
            projects={projects}
            artistColor={color}
            tasksByProject={tasksByProject}
            doneValue={doneValue}
          />
        )}
      </>
    ),
    kontakte: <ContactList contacts={contacts} parent={{ artist_id: artistId }} titleKey="artist.kontakte" />,
    aufgaben: (
      <>
        <SectionTitle right={<ExcelButton params={{ artist_id: artistId }} />}>
          <EditableLabel k="artist.aufgaben" />
        </SectionTitle>
        <TaskTable tasks={generalTasks} customColumns={customColumns} parent={{ artist_id: artistId }} />
      </>
    ),
  };

  return (
    <div className="space-y-8">
      <Breadcrumbs trail={[{ label: 'Übersicht', to: '/' }, { label: artist.name }]} />

      <Card style={{ background: withAlpha(color, 0.12) }}>
        <div className="h-1.5 rounded-t-2xl" style={{ background: color }} />
        <div className="flex flex-wrap items-start justify-between gap-4 p-6">
          <div className="flex items-center gap-4">
            {artist.image ? (
              <img
                src={artist.image}
                alt=""
                className="h-12 w-12 shrink-0 rounded-full object-cover shadow-sm ring-2 ring-white"
              />
            ) : (
              <span
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold shadow-sm"
                style={{ background: color, color: contrastText(color) }}
              >
                {initials(artist.name)}
              </span>
            )}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                <EditableLabel k="artist.kicker" />
              </div>
              <h1 className="text-2xl font-bold text-neutral-800">{artist.name}</h1>
              {artist.notes && (
                <Markdown className="mt-1 max-w-2xl text-sm text-neutral-600">{artist.notes}</Markdown>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`#/print/artist/${artistId}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-200"
            >
              🖨 Ein-Pager (PDF)
            </a>
            <EditArtistButton artist={artist} />
          </div>
        </div>
      </Card>

      <SectionArranger
        layoutKey="artist_layout"
        sections={sections}
        labelKeys={SECTION_LABEL_KEYS}
        fullWidthKeys={['aufgaben', 'aufmerksamkeit']}
      />
    </div>
  );
}

/** Up to two initials from an artist name, for the header avatar. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/**
 * The project cards, reorderable by dragging the ⠿ handle in a card's colour bar. Order is the
 * `sort_order` column, which the projects list already sorts by, so a drop is one batch request
 * and the server round-trip returns the list already in the new order.
 */
function ProjectGrid({
  projects,
  artistColor,
  tasksByProject,
  doneValue,
}: {
  projects: Project[];
  artistColor: string;
  tasksByProject: Map<number, Task[]>;
  doneValue: string;
}) {
  const invalidate = useInvalidateAll();
  const drag = useDragReorder<number>({
    mode: 'armed',
    onReorder: async (fromId, toId) => {
      const next = arrayMoveTo(
        projects,
        projects.findIndex((p) => p.id === fromId),
        projects.findIndex((p) => p.id === toId),
      );
      if (next === projects) return;
      await api.projects.reorder(next.map((p) => p.id));
      await invalidate();
    },
  });
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((p) => (
        <ProjectCard
          key={p.id}
          project={p}
          artistColor={artistColor}
          drag={drag}
          tasks={tasksByProject.get(p.id) ?? []}
          doneValue={doneValue}
        />
      ))}
    </div>
  );
}

function ProjectCard({
  project,
  artistColor,
  drag,
  tasks,
  doneValue,
}: {
  project: Project;
  artistColor: string;
  drag: ReturnType<typeof useDragReorder<number>>;
  tasks: Task[];
  doneValue: string;
}) {
  const shade = projectShade(artistColor, project.color, project.id);
  return (
    <Link
      to={`/project/${project.id}`}
      data-project-card={project.id}
      className={`group block rounded-2xl transition ${
        drag.isDropTarget(project.id) ? 'ring-2 ring-neutral-500' : ''
      } ${drag.isDragging(project.id) ? 'opacity-40' : ''}`}
      {...drag.itemProps(project.id)}
    >
      <Card className="overflow-hidden transition hover:shadow-md">
        <div className="flex items-center gap-2 px-4 py-2" style={{ background: shade }}>
          <DragHandle
            className="text-base"
            style={{ color: contrastText(shade) }}
            {...drag.handleProps(project.id)}
          />
          {project.code && (
            <span
              className="rounded-md bg-black/15 px-1.5 py-0.5 text-xs font-bold"
              style={{ color: contrastText(shade) }}
            >
              {project.code}
            </span>
          )}
          {project.status && <ProjectStatusPill status={project.status} className="ml-auto" />}
        </div>
        <div className="p-4">
          <h3 className="font-semibold text-neutral-800">{project.name}</h3>
          {project.description && (
            // Render Markdown like the project page does; bound the preview height
            // (line-clamp doesn't clamp block-level Markdown output cleanly).
            <div className="mt-1 max-h-16 overflow-hidden text-sm text-neutral-500">
              {/* The whole card is a <Link>; render preview links as plain text so a Markdown
                  link in the description can't nest an <a> inside that outer anchor. */}
              <Markdown plainLinks>{project.description}</Markdown>
            </div>
          )}
          {/* Task insights for this project — the cross-project overview the FB asked for, per
              card. Empty projects show nothing (no zero-noise on a card with no tasks). */}
          {tasks.length > 0 && (
            <div className="mt-3 border-t border-neutral-100 pt-3">
              <TaskStatChips tasks={tasks} doneValue={doneValue} />
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}
