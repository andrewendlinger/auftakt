import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { contrastText, projectShade, withAlpha } from '../lib/colors';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { LayoutMenu, SectionArranger, useEntityLayout } from '../components/SectionArranger';
import { EditableLabel } from '../components/EditableLabel';
import { Card, SectionTitle, Spinner, Btn, ErrorState, LoadError } from '../components/ui';
import { isValidId } from '../lib/routeParams';
import { EventList } from '../components/EventList';
import { ContactList } from '../components/ContactList';
import { LinkList } from '../components/LinkList';
import { TaskTable } from '../components/TaskTable';
import { CustomColumnManager } from '../components/CustomColumnManager';
import { EditProjectButton } from '../components/EntityButtons';
import { ProjectStatusPill } from '../components/ProjectStatusPill';
import { ExcelButton } from '../components/ExcelButton';
import { InlineNotes } from '../components/InlineNotes';
import {
  builtinPicker,
  customSectionEntries,
  useNonEmptyCustomSections,
  useRemoveCustomSection,
} from '../components/CustomSections';
import {
  arrangerConfig,
  AttentionSection,
  StatsSection,
  type SectionSpec,
} from '../components/SectionCatalog';
import {
  useAllTasks,
  useEventTypeOptions,
  useScopedColumns,
  useUndoablePatch,
} from '../hooks';

export function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  // `#/project/abc` parses to NaN. Answer it here rather than asking the server for /projects/NaN.
  const validId = isValidId(projectId);
  const eventTypes = useEventTypeOptions();
  const undoablePatch = useUndoablePatch();
  const [managingColumns, setManagingColumns] = useState(false);

  const { data: project, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.projects.get(projectId),
    enabled: validId,
  });
  const { data: artist } = useQuery({
    queryKey: ['artist', project?.artist_id],
    queryFn: () => api.artists.get(project!.artist_id),
    enabled: !!project,
  });
  const { data: events = [] } = useQuery({
    queryKey: ['project', projectId, 'events'],
    queryFn: () => api.events.list({ project_id: projectId }),
    enabled: validId,
  });
  const { data: contacts = [] } = useQuery({
    queryKey: ['project', projectId, 'contacts'],
    queryFn: () => api.contacts.list({ project_id: projectId }),
    enabled: validId,
  });
  const { data: links = [] } = useQuery({
    queryKey: ['project', projectId, 'links'],
    queryFn: () => api.links.list({ project_id: projectId }),
    enabled: validId,
  });
  const { data: tasks = [] } = useQuery({
    queryKey: ['project', projectId, 'tasks'],
    queryFn: () => api.tasks.list({ project_id: projectId }),
    enabled: validId,
  });
  const columns = useScopedColumns({ scope: 'project', id: projectId }, validId);
  const { data: customSections = [] } = useQuery({
    queryKey: ['customSections', 'project', projectId],
    queryFn: () => api.customSections.list({ project_id: projectId }),
    enabled: validId,
  });
  // This project's own arrangement, falling back to the `project_layout` template (WP-25).
  const layout = useEntityLayout('project', project);
  const removeCustomSection = useRemoveCustomSection(customSections, layout);
  const nonEmptyCustom = useNonEmptyCustomSections(customSections);

  // „Fortschritt" counts finished work, and the list above is scope 'live' — the server has already
  // dropped whatever was done longer ago than ARCHIVE_AFTER_DAYS, so the percentage *fell* as the
  // project was completed (CCL-04). The editable table below stays on the live list.
  const { tasks: allTasks } = useAllTasks();
  const statsTasks = useMemo(
    () => allTasks.filter((t) => t.project_id === projectId),
    [allTasks, projectId],
  );

  // See ArtistPage: a settled error has isLoading === false and data === undefined, so the old
  // guard spun for ever on a stale link to a deleted project (PGS-05).
  if (!validId) {
    return <ErrorState title="Projekt nicht gefunden" hint="Diese Adresse enthält keine gültige Projekt-Nummer." />;
  }
  if (isLoading) return <Spinner />;
  if (isError || !project) {
    return (
      <LoadError
        error={error}
        notFound="Projekt nicht gefunden"
        failed="Projekt konnte nicht geladen werden."
        onRetry={() => void refetch()}
      />
    );
  }
  const artistColor = artist?.color ?? '#888888';
  const shade = projectShade(artistColor, project.color, project.id);

  // A filled section can't be binned (nonEmptyKeys). The computed Einblicke stay freely removable.
  const nonEmptyKeys = [
    ...nonEmptyCustom,
    ...(events.length > 0 ? ['termine'] : []),
    ...(contacts.length > 0 ? ['kontakte'] : []),
    ...(links.length > 0 ? ['links'] : []),
  ];

  // Spec order = default section order for fresh layouts. `kontakte` and `links` were one welded
  // section until WP-48 split them (docs/DECISIONS.md); the half defaults keep the pair sitting
  // side by side on fresh and template pages, while a stored layout finds `links` appended at the
  // bottom — the same arrival WP-36 gave the artist page's links.
  const specs: SectionSpec[] = [
    {
      key: 'termine',
      labelKey: 'project.termine',
      group: 'eingabe',
      node: (
        <EventList
          titleKey="project.termine"
          events={events}
          parent={{ project_id: projectId }}
          eventTypes={eventTypes}
        />
      ),
    },
    {
      key: 'kontakte',
      labelKey: 'project.kontakte',
      group: 'eingabe',
      defaultWidth: 'half',
      node: (
        <ContactList contacts={contacts} parent={{ project_id: projectId }} titleKey="project.kontakte" />
      ),
    },
    {
      key: 'links',
      labelKey: 'project.links',
      group: 'eingabe',
      defaultWidth: 'half',
      node: <LinkList links={links} parent={{ project_id: projectId }} titleKey="project.links" />,
    },
    {
      key: 'stats',
      labelKey: 'project.stats',
      group: 'einblicke',
      defaultHidden: true,
      node: <StatsSection labelKey="project.stats" tasks={statsTasks} />,
    },
    {
      key: 'aufmerksamkeit',
      labelKey: 'project.aufmerksamkeit',
      group: 'einblicke',
      defaultHidden: true,
      fullWidth: true,
      node: <AttentionSection labelKey="project.aufmerksamkeit" tasks={tasks} />,
    },
    {
      key: 'aufgaben',
      labelKey: 'project.aufgaben',
      mandatory: true,
      fullWidth: true,
      node: (
        <>
          <SectionTitle
            right={
              <div className="flex items-center gap-2">
                <ExcelButton params={{ project_id: projectId }} />
                <Btn variant="subtle" onClick={() => setManagingColumns(true)}>
                  ⚙ Spalten
                </Btn>
              </div>
            }
          >
            <EditableLabel k="project.aufgaben" />
          </SectionTitle>
          <TaskTable tasks={tasks} customColumns={columns} parent={{ project_id: projectId }} />
        </>
      ),
    },
  ];
  const cfg = arrangerConfig(specs);
  const custom = customSectionEntries(customSections);
  const sections = { ...cfg.sections, ...custom.nodes };
  return (
    <div className="space-y-8">
      <Breadcrumbs
        trail={[
          { label: 'Übersicht', to: '/dashboard' },
          ...(artist ? [{ label: artist.name, to: `/artist/${artist.id}` }] : []),
          { label: project.code || project.name },
        ]}
      />

      <Card style={{ background: withAlpha(shade, 0.16) }}>
        <div className="h-1.5 rounded-t-2xl" style={{ background: shade }} />
        <div className="flex flex-wrap items-start justify-between gap-4 p-6">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              <EditableLabel k="project.kicker" />
              {artist ? ` · ${artist.name}` : ''}
            </div>
            <div className="mt-1 flex items-center gap-2">
              {project.code && (
                <span
                  className="rounded-md px-2 py-0.5 text-sm font-bold"
                  style={{ background: shade, color: contrastText(shade) }}
                >
                  {project.code}
                </span>
              )}
              {project.status && <ProjectStatusPill status={project.status} />}
            </div>
            <h1 className="mt-2 text-2xl font-bold text-neutral-800">{project.name}</h1>
            {/* The one general free-text field lives inside the header, not as a section. */}
            <div className="mt-1 max-w-2xl text-sm text-neutral-600">
              <InlineNotes
                value={project.description}
                onSave={async (v) => {
                  await undoablePatch({
                    res: api.projects,
                    row: project,
                    patch: { description: v },
                    label: 'Textänderung',
                  });
                }}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`#/print/project/${projectId}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-200"
            >
              🖨 Ein-Pager (PDF)
            </a>
            <EditProjectButton project={project} artistColor={artistColor} />
          </div>
        </div>
      </Card>

      <SectionArranger
        store={layout}
        sections={sections}
        labelKeys={cfg.labelKeys}
        titles={custom.titles}
        mandatoryKeys={cfg.mandatoryKeys}
        defaultHidden={cfg.defaultHidden}
        fullWidthKeys={cfg.fullWidthKeys}
        defaultWidths={cfg.defaultWidths}
        nonEmptyKeys={nonEmptyKeys}
        onRemoveCustom={removeCustomSection}
        addAction={builtinPicker(specs, { project_id: projectId })}
        layoutAction={({ full }) => (
          <LayoutMenu store={layout} full={full} labelKey="project.kicker" />
        )}
      />

      {managingColumns && (
        <CustomColumnManager
          columns={columns}
          owner={{ scope: 'project', id: projectId }}
          onClose={() => setManagingColumns(false)}
        />
      )}
    </div>
  );
}
