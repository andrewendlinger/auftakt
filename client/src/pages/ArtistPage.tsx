import { useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Project, Task } from '../api/types';
import { contrastText, projectShade, withAlpha } from '../lib/colors';
import { useListReorder, type DragReorder } from '../lib/dragReorder';
import { Markdown } from '../components/Markdown';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { SectionArranger } from '../components/SectionArranger';
import { EditableLabel } from '../components/EditableLabel';
import type { LabelKey } from '../lib/labels';
import { Card, DragHandle, SectionTitle, Spinner, EmptyState, ErrorState, LoadError } from '../components/ui';
import { isValidId } from '../lib/routeParams';
import { EventList } from '../components/EventList';
import { ContactList } from '../components/ContactList';
import { InlineNotes } from '../components/InlineNotes';
import {
  builtinPicker,
  customSectionEntries,
  useNonEmptyCustomSections,
  useRemoveCustomSection,
  type SectionGroup,
} from '../components/CustomSections';
import { TaskTable } from '../components/TaskTable';
import { TaskStatChips } from '../components/TaskStatChips';
import { AttentionList } from '../components/AttentionList';
import { EditArtistButton, NewProjectButton } from '../components/EntityButtons';
import { ProjectStatusPill } from '../components/ProjectStatusPill';
import { ExcelButton } from '../components/ExcelButton';
import {
  useAllTasks,
  useEventTypeOptions,
  useGlobalColumns,
  useTaskStatsConfig,
  useUndoablePatch,
} from '../hooks';

/** Which heading names each section in the "Bereiche bearbeiten" strip. */
const SECTION_LABEL_KEYS: Record<string, LabelKey> = {
  projekte: 'artist.projekte',
  termine: 'artist.termine',
  aufmerksamkeit: 'artist.aufmerksamkeit',
  stats: 'artist.stats',
  kontakte: 'artist.kontakte',
  aufgaben: 'artist.aufgaben',
};

/** Picker group of each optional built-in. */
const SECTION_GROUPS: Record<string, SectionGroup> = {
  projekte: 'eingabe',
  termine: 'eingabe',
  kontakte: 'eingabe',
  stats: 'einblicke',
  aufmerksamkeit: 'einblicke',
};

export function ArtistPage() {
  const { id } = useParams<{ id: string }>();
  const artistId = Number(id);
  // `#/artist/abc` parses to NaN. Answer it here rather than asking the server for /artists/NaN.
  const validId = isValidId(artistId);
  const eventTypes = useEventTypeOptions();
  const { windowDays } = useTaskStatsConfig();
  const undoablePatch = useUndoablePatch();

  const { data: artist, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['artist', artistId],
    queryFn: () => api.artists.get(artistId),
    enabled: validId,
  });
  const { data: projects = [] } = useQuery({
    queryKey: ['artist', artistId, 'projects'],
    queryFn: () => api.projects.list({ artist_id: artistId }),
    enabled: validId,
  });
  const { data: events = [] } = useQuery({
    queryKey: ['artist', artistId, 'events'],
    queryFn: () => api.events.list({ resolved_artist_id: artistId }),
    enabled: validId,
  });
  const { data: contacts = [] } = useQuery({
    queryKey: ['artist', artistId, 'contacts'],
    queryFn: () => api.contacts.list({ artist_id: artistId }),
    enabled: validId,
  });
  const { data: tasks = [] } = useQuery({
    queryKey: ['artist', artistId, 'tasks'],
    queryFn: () => api.tasks.list({ resolved_artist_id: artistId }),
    enabled: validId,
  });
  const customColumns = useGlobalColumns();
  const { data: customSections = [] } = useQuery({
    queryKey: ['customSections', 'artist', artistId],
    queryFn: () => api.customSections.list({ artist_id: artistId }),
    enabled: validId,
  });
  const removeCustomSection = useRemoveCustomSection(customSections);
  const nonEmptyCustom = useNonEmptyCustomSections(customSections);

  // Everything statistical is computed over live + archived tasks: the list above is scope 'live',
  // from which the server has already dropped whatever was finished longer ago than
  // ARCHIVE_AFTER_DAYS, so „Fortschritt" ran backwards as work aged out (CCL-04). The map feeds the
  // per-project card chips; the whole slice feeds the „Einblicke" tiles.
  const { tasks: allTasks } = useAllTasks();
  const statsTasks = useMemo(
    () => allTasks.filter((t) => t.resolved_artist_id === artistId),
    [allTasks, artistId],
  );
  const statsByProject = useMemo(() => {
    const m = new Map<number, Task[]>();
    for (const t of statsTasks) {
      if (t.project_id == null) continue;
      const arr = m.get(t.project_id);
      if (arr) arr.push(t);
      else m.set(t.project_id, [t]);
    }
    return m;
  }, [statsTasks]);

  // Not `isLoading || !artist`: once the query settles in error, isLoading is false and data is
  // undefined, so that guard rendered the spinner for ever — a stale bookmark to a deleted
  // artist spun with no message and no way to retry (PGS-05).
  if (!validId) {
    return <ErrorState title="Künstler nicht gefunden" hint="Diese Adresse enthält keine gültige Künstler-Nummer." />;
  }
  if (isLoading) return <Spinner />;
  if (isError || !artist) {
    return (
      <LoadError
        error={error}
        notFound="Künstler nicht gefunden"
        failed="Künstler konnte nicht geladen werden."
        onRetry={() => void refetch()}
      />
    );
  }

  // A filled section can't be binned (nonEmptyKeys) — the computed Einblicke stay free.
  const nonEmptyKeys = [
    ...nonEmptyCustom,
    ...(projects.length > 0 ? ['projekte'] : []),
    ...(events.length > 0 ? ['termine'] : []),
    ...(contacts.length > 0 ? ['kontakte'] : []),
  ];
  const color = artist.color;

  // The editable table is the live list, split on `project_id`: general (artist-level) tasks are
  // the only ones editable here. A subtask inherits its parent's project_id, so whole trees stay
  // on the same side of the split.
  const generalTasks = tasks.filter((t) => !t.project_id);

  // Insertion order = default section order for fresh layouts: Projekte first, directly
  // under the artist header (user decision).
  const sections: Record<string, ReactNode> = {
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
            tasksByProject={statsByProject}
          />
        )}
      </>
    ),
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
        <AttentionList tasks={tasks} windowDays={windowDays} />
      </>
    ),
    stats: (
      <>
        <SectionTitle>
          <EditableLabel k="artist.stats" />
        </SectionTitle>
        <TaskStatChips tasks={statsTasks} variant="tiles" />
      </>
    ),
    kontakte: <ContactList contacts={contacts} parent={{ artist_id: artistId }} titleKey="artist.kontakte" />,
    aufgaben: (
      <>
        {/* resolved_artist_id, matching the page's own task query above — `artist_id` filters on
            `t.artist_id` alone, so the export silently dropped every task that belongs to this
            artist through its project (PGS-31). */}
        <SectionTitle right={<ExcelButton params={{ resolved_artist_id: artistId }} />}>
          <EditableLabel k="artist.aufgaben" />
        </SectionTitle>
        <TaskTable tasks={generalTasks} customColumns={customColumns} parent={{ artist_id: artistId }} />
      </>
    ),
  };
  const custom = customSectionEntries(customSections);
  Object.assign(sections, custom.nodes);

  return (
    <div className="space-y-8">
      <Breadcrumbs trail={[{ label: 'Übersicht', to: '/dashboard' }, { label: artist.name }]} />

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
              {/* The one general free-text field lives inside the header, not as a section. */}
              <div className="mt-1 max-w-2xl text-sm text-neutral-600">
                <InlineNotes
                  value={artist.notes}
                  onSave={async (v) => {
                    await undoablePatch({
                      res: api.artists,
                      row: artist,
                      patch: { notes: v },
                      label: 'Textänderung',
                    });
                  }}
                />
              </div>
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
        titles={custom.titles}
        mandatoryKeys={['aufgaben']}
        defaultHidden={['stats']}
        fullWidthKeys={['aufgaben', 'aufmerksamkeit']}
        nonEmptyKeys={nonEmptyKeys}
        onRemoveCustom={removeCustomSection}
        addAction={builtinPicker(SECTION_LABEL_KEYS, SECTION_GROUPS, { artist_id: artistId })}
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
}: {
  projects: Project[];
  artistColor: string;
  tasksByProject: Map<number, Task[]>;
}) {
  const drag = useListReorder(projects, api.projects.reorder);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((p) => (
        <ProjectCard
          key={p.id}
          project={p}
          artistColor={artistColor}
          drag={drag}
          tasks={tasksByProject.get(p.id) ?? []}
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
}: {
  project: Project;
  artistColor: string;
  drag: DragReorder;
  tasks: Task[];
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
              <TaskStatChips tasks={tasks} />
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}
