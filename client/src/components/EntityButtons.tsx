import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Btn } from './ui';
import { RecordFormModal, type FieldDef } from './fields';
import { api } from '../api/client';
import type { Artist, Project } from '../api/types';
import { pickArtistColor } from '../lib/colors';
import { useInvalidateAll, useSettings } from '../hooks';

const ARTIST_FIELDS: FieldDef[] = [
  { name: 'name', label: 'Name', required: true, span2: true },
  { name: 'image', label: 'Profilbild', type: 'image' },
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
  const { data: artists = [] } = useQuery({
    queryKey: ['artists'],
    queryFn: () => api.artists.list(),
  });
  return (
    <>
      <Btn variant="primary" onClick={() => setOpen(true)}>
        + Künstler
      </Btn>
      {open && (
        <RecordFormModal
          title="Neuer Künstler"
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
  const invalidate = useInvalidateAll();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Btn variant="subtle" onClick={() => setOpen(true)}>
        ✎ Bearbeiten
      </Btn>
      {open && (
        <RecordFormModal
          title="Künstler bearbeiten"
          fields={ARTIST_FIELDS}
          initial={artist}
          onSubmit={async (v) => {
            await api.artists.update(artist.id, stripEmptyColor(v));
            await invalidate();
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function projectFields(statuses: string[]): FieldDef[] {
  return [
    { name: 'code', label: 'Kürzel (Badge)', required: true, placeholder: 'z. B. K3a' },
    { name: 'name', label: 'Name', required: true },
    { name: 'status', label: 'Status', type: 'select', options: statuses.map((s) => ({ value: s, label: s })) },
    { name: 'color', label: 'Farbe (optional, sonst Schattierung)', type: 'color' },
    { name: 'description', label: 'Beschreibung', type: 'textarea' },
    { name: 'notes', label: 'Notizen', type: 'textarea' },
  ];
}

export function NewProjectButton({ artistId }: { artistId: number }) {
  const invalidate = useInvalidateAll();
  const { data: settings } = useSettings();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Btn variant="primary" onClick={() => setOpen(true)}>
        + Projekt
      </Btn>
      {open && (
        <RecordFormModal
          title="Neues Projekt"
          fields={projectFields(settings?.project_statuses ?? [])}
          initial={{ status: (settings?.project_statuses ?? [])[0] ?? '', color: '' }}
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

export function EditProjectButton({ project }: { project: Project }) {
  const invalidate = useInvalidateAll();
  const { data: settings } = useSettings();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Btn variant="subtle" onClick={() => setOpen(true)}>
        ✎ Bearbeiten
      </Btn>
      {open && (
        <RecordFormModal
          title="Projekt bearbeiten"
          fields={projectFields(settings?.project_statuses ?? [])}
          initial={project}
          onSubmit={async (v) => {
            await api.projects.update(project.id, v);
            await invalidate();
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
