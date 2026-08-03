import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Btn } from './ui';
import { RecordFormModal, type FieldDef } from './fields';
import { api } from '../api/client';
import type { Artist, CustomColumnOption, Project } from '../api/types';
import { pickArtistColor, projectShade } from '../lib/colors';
import { useInvalidateAll, useLabel, useProjectStatusOptions, useUndoablePatch } from '../hooks';

/** `artists.color TEXT NOT NULL DEFAULT '#888888'` — the value an empty field means. */
const ARTIST_DEFAULT_COLOR = '#888888';

const ARTIST_FIELDS: FieldDef[] = [
  { name: 'name', label: 'Name', required: true, span2: true },
  { name: 'image', label: 'Profilbild', type: 'image' },
  // No `fallback`: artists.color is NOT NULL DEFAULT '#888888', so the plain grey swatch is
  // exactly what an empty field ends up rendering. Nothing is inherited here — which also
  // means `ColorField` offers no „Zurücksetzen" and clearing the hex text is the only reset.
  // No notes field: "Allgemeines / Beschreibung" is edited inline on the artist page.
  { name: 'color', label: 'Farbe', type: 'color' },
];

/** Create: drop an empty colour so the NOT NULL default applies. */
function stripEmptyColor(values: Record<string, string | null>): Record<string, string | null> {
  if (!values.color) {
    const { color, ...rest } = values;
    void color;
    return rest;
  }
  return values;
}

/**
 * Edit: send the default explicitly instead.
 *
 * On a PATCH an absent key means „leave unchanged", not „apply the DB default" — the crud
 * router builds its SET clause only from the keys present in the body. Sharing
 * `stripEmptyColor` with the create path therefore made clearing an artist's colour a silent
 * no-op: the dialog closed with no error, and the artist plus every project shade derived from
 * it kept the old value (SHL-06).
 */
function resetEmptyColor(values: Record<string, string | null>): Record<string, string | null> {
  return values.color ? values : { ...values, color: ARTIST_DEFAULT_COLOR };
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
              patch: resetEmptyColor(v),
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
    // No description field: "Allgemeines / Beschreibung" is edited inline on the project page.
    { name: 'color', label: 'Farbe (optional, sonst Schattierung)', type: 'color', fallback, fallbackHint },
  ];
}

export function NewProjectButton({ artistId, artistColor }: { artistId: number; artistColor: string }) {
  const invalidate = useInvalidateAll();
  const statuses = useProjectStatusOptions();
  const [open, setOpen] = useState(false);
  // Follow the „Projekte" heading rename — this button sits under the artist page's
  // `artist.projekte` section, so it tracks that key (same fix as „+ Künstler" above).
  const projekteLabel = useLabel()('artist.projekte');
  return (
    <>
      <Btn variant="primary" onClick={() => setOpen(true)}>
        + {projekteLabel}
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
