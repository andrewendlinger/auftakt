import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { contrastText, projectShade, withAlpha } from '../lib/colors';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { SectionArranger } from '../components/SectionArranger';
import { EditableLabel } from '../components/EditableLabel';
import type { LabelKey } from '../lib/labels';
import { Card, SectionTitle, Spinner, Btn } from '../components/ui';
import { EventList } from '../components/EventList';
import { ContactList } from '../components/ContactList';
import { LinkList } from '../components/LinkList';
import { TaskTable } from '../components/TaskTable';
import { CustomColumnManager } from '../components/CustomColumnManager';
import { EditProjectButton } from '../components/EntityButtons';
import { ProjectStatusPill } from '../components/ProjectStatusPill';
import { ExcelButton } from '../components/ExcelButton';
import { InlineNotes } from '../components/InlineNotes';
import { useEventTypeOptions, useUndoablePatch } from '../hooks';

/**
 * Which heading names each section in the "Bereiche anordnen" strip. `kontakte` holds two
 * lists side by side; its contacts heading is the one that names the section.
 */
const SECTION_LABEL_KEYS = {
  termine: 'project.termine',
  fakten: 'project.fakten',
  kontakte: 'project.kontakte',
  aufgaben: 'project.aufgaben',
} as const satisfies Record<string, LabelKey>;

export function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const eventTypes = useEventTypeOptions();
  const undoablePatch = useUndoablePatch();
  const [managingColumns, setManagingColumns] = useState(false);

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.projects.get(projectId),
  });
  const { data: artist } = useQuery({
    queryKey: ['artist', project?.artist_id],
    queryFn: () => api.artists.get(project!.artist_id),
    enabled: !!project,
  });
  const { data: events = [] } = useQuery({
    queryKey: ['project', projectId, 'events'],
    queryFn: () => api.events.list({ project_id: projectId }),
  });
  const { data: contacts = [] } = useQuery({
    queryKey: ['project', projectId, 'contacts'],
    queryFn: () => api.contacts.list({ project_id: projectId }),
  });
  const { data: links = [] } = useQuery({
    queryKey: ['project', projectId, 'links'],
    queryFn: () => api.links.list({ project_id: projectId }),
  });
  const { data: tasks = [] } = useQuery({
    queryKey: ['project', projectId, 'tasks'],
    queryFn: () => api.tasks.list({ project_id: projectId }),
  });
  const { data: globalCols = [] } = useQuery({
    queryKey: ['customColumns', 'global'],
    queryFn: () => api.customColumns.list({ scope: 'global' }),
  });
  const { data: projectCols = [] } = useQuery({
    queryKey: ['customColumns', 'project', projectId],
    queryFn: () => api.customColumns.list({ scope: 'project', project_id: projectId }),
  });

  if (isLoading || !project) return <Spinner />;
  const artistColor = artist?.color ?? '#888888';
  const shade = projectShade(artistColor, project.color, project.id);
  const columns = [...globalCols, ...projectCols];

  const sections: Record<string, ReactNode> = {
    termine: (
      <EventList
        titleKey="project.termine"
        events={events}
        parent={{ project_id: projectId }}
        eventTypes={eventTypes}
      />
    ),
    fakten: (
      <>
        <SectionTitle>
          <EditableLabel k="project.fakten" />
        </SectionTitle>
        <Card className="p-5">
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
        </Card>
      </>
    ),
    kontakte: (
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <ContactList contacts={contacts} parent={{ project_id: projectId }} titleKey="project.kontakte" />
        <LinkList links={links} parent={{ project_id: projectId }} titleKey="project.links" />
      </div>
    ),
    aufgaben: (
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
  };
  return (
    <div className="space-y-8">
      <Breadcrumbs
        trail={[
          { label: 'Übersicht', to: '/' },
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
        layoutKey="project_layout"
        sections={sections}
        labelKeys={SECTION_LABEL_KEYS}
        fullWidthKeys={['aufgaben']}
      />

      {managingColumns && (
        <CustomColumnManager
          columns={columns}
          projectId={projectId}
          onClose={() => setManagingColumns(false)}
        />
      )}
    </div>
  );
}
