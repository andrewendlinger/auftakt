import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Btn } from './ui';
import { RecordFormModal, type FieldDef } from './fields';
import { api } from '../api/client';
import type { Artist, CustomColumnOption, Project } from '../api/types';
import { pickArtistColor, projectShade } from '../lib/colors';
import { useInvalidateAll, useLabel, useProjectStatusOptions, useUndoablePatch } from '../hooks';

const ARTIST_FIELDS: FieldDef[] = [
  { name: 'name', label: 'Name', required: true, span2: true },
  { name: 'image', label: 'Profilbild', type: 'image' },
  // No `fallback`: artists.color is NOT NULL DEFAULT '#888888', so the plain grey swatch is
  // exactly what an empty field ends up rendering. Nothing is inherited here.
  { name: 'color', label: 'Farbe', type: 'color' },
  { name: 'notes', label: 'Notizen', type: 'textarea' },
];

function stripEmptyColor(values: Record<string, string | null>): Record<string, string | null> {
  // Artist colour is NOT NULL — drop it when empty so the DB default applies.
  if (!values.color) {
    const { color, ...rest } = values;
    void color;
    return rest;
  }
  return values;
}

export function NewArtistButton() {
  const invalidate = useInvalidateAll();
  const [open, setOpen] = useState(false);
  // Follow the „Künstler" heading rename (WP-F) — this button sits under the dashboard's
  // `dash.artists` section, so it tracks that key, not the artist page's kicker.
  const artistLabel = useLabel()('dash.artists');
  const { data: artists = [] } = useQuery({
    queryKey: ['artists'],
    queryFn: () => api.artists.list(),
  });
  return (
    <>
      <Btn variant="primary" onClick={() => setOpen(true)}>
        + {artistLabel}
      </Btn>
      {open && (
        <RecordFormModal
          title={`${artistLabel} anlegen`}
          fields={ARTIST_FIELDS}
          initial={{ color: pickArtistColor(artists.map((a) => a.color)) }}
          onSubmit={async (v) => {
            await api.artists.create(stripEmptyColor(v));
            await invalidate();
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function EditArtistButton({ artist }: { artist: Artist }) {
  const undoablePatch = useUndoablePatch();
  const [open, setOpen] = useState(false);
  // The edit button lives on the artist page, under the `artist.kicker` heading — follow that
  // rename rather than the dashboard's `dash.artists`.
  const artistLabel = useLabel()('artist.kicker');
  return (
    <>
      <Btn variant="subtle" onClick={() => setOpen(true)}>
        ✎ Bearbeiten
      </Btn>
      {open && (
        <RecordFormModal
          title={`${artistLabel} bearbeiten`}
          fields={ARTIST_FIELDS}
          initial={artist}
          onSubmit={async (v) => {
            await undoablePatch({
              res: api.artists,
              row: artist,
              patch: stripEmptyColor(v),
              label: `Änderung an ${artistLabel}`,
            });
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** `fallback` is the shade the project renders with no explicit colour — see ColorField. */
function projectFields(statuses: CustomColumnOption[], fallback: string, fallbackHint: string): FieldDef[] {
  return [
    { name: 'code', label: 'Kürzel (Badge)', required: true, placeholder: 'z. B. K3a' },
    { name: 'name', label: 'Name', required: true },
    { name: 'status', label: 'Status', type: 'select', options: statuses.map((o) => ({ value: o.value, label: o.label })) },
    { name: 'color', label: 'Farbe (optional, sonst Schattierung)', type: 'color', fallback, fallbackHint },
    { name: 'description', label: 'Beschreibung', type: 'textarea' },
    { name: 'notes', label: 'Notizen', type: 'textarea' },
  ];
}

export function NewProjectButton({ artistId, artistColor }: { artistId: number; artistColor: string }) {
  const invalidate = useInvalidateAll();
  const statuses = useProjectStatusOptions();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Btn variant="primary" onClick={() => setOpen(true)}>
        + Projekt
      </Btn>
      {open && (
        <RecordFormModal
          title="Neues Projekt"
          // The exact shade keys off the project id (projectShade), which doesn't exist yet —
          // preview the artist colour and say so rather than showing a grey that never renders.
          fields={projectFields(
            statuses,
            artistColor,
            'Schattierung wird beim Anlegen aus der Künstlerfarbe abgeleitet.',
          )}
          initial={{ status: statuses[0]?.value ?? '' }}
          onSubmit={async (v) => {
            await api.projects.create({ ...v, artist_id: artistId });
            await invalidate();
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function EditProjectButton({ project, artistColor }: { project: Project; artistColor: string }) {
  const undoablePatch = useUndoablePatch();
  const statuses = useProjectStatusOptions();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Btn variant="subtle" onClick={() => setOpen(true)}>
        ✎ Bearbeiten
      </Btn>
      {open && (
        <RecordFormModal
          title="Projekt bearbeiten"
          // Pass null, not project.color: the fallback must be the *inherited* shade, which is
          // what renders once the user clears the field — not an echo of the explicit colour.
          fields={projectFields(
            statuses,
            projectShade(artistColor, null, project.id),
            'Automatisch aus der Künstlerfarbe abgeleitet.',
          )}
          initial={project}
          onSubmit={async (v) => {
            await undoablePatch({
              res: api.projects,
              row: project,
              patch: v,
              label: 'Änderung am Projekt',
            });
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
