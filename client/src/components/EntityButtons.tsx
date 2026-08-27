import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Btn } from './ui';
import { TrashIcon } from './icons';
import { Modal, RecordFormModal, type FieldDef } from './fields';
import { api } from '../api/client';
import type {
  Artist,
  ArtistCreate,
  ArtistUpdate,
  CustomColumnOption,
  ID,
  Project,
  ProjectCreate,
} from '../api/types';
import { pickArtistColor, projectShade } from '../lib/colors';
import { cascadeText } from '../lib/deletedTypes';
import {
  resourceUndo,
  useArtistNoun,
  useInvalidateAll,
  useLabel,
  useProjectStatusOptions,
  useTypeLabels,
  useUndoableDelete,
  useUndoablePatch,
} from '../hooks';

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

/**
 * Create: an empty colour is *dropped* so the NOT NULL default applies. `undefined` is exactly
 * a deleted key here — JSON.stringify omits it and the crud router builds its column list from
 * what the body actually carries.
 *
 * These mappers are where the modal's `Record<string, string | null>` bag becomes a typed
 * payload. Casting instead would put CCL-24's hole back: an index signature satisfies an
 * all-optional target vacuously, so nothing would be checked at all. `?? ''` is unreachable —
 * `name` is `required: true` and RecordFormModal refuses to submit while it is blank.
 */
function artistCreatePayload(v: Record<string, string | null>): ArtistCreate {
  return { name: v.name ?? '', image: v.image, color: v.color || undefined };
}

/**
 * Edit: send the default explicitly instead.
 *
 * On a PATCH an absent key means „leave unchanged“, not „apply the DB default“ — the crud
 * router builds its SET clause only from the keys present in the body. Sharing the create
 * path's drop-the-key rule therefore made clearing an artist's colour a silent no-op: the
 * dialog closed with no error, and the artist plus every project shade derived from it kept
 * the old value (SHL-06).
 */
function artistUpdatePayload(v: Record<string, string | null>): ArtistUpdate {
  return { name: v.name ?? '', image: v.image, color: v.color || ARTIST_DEFAULT_COLOR };
}

/**
 * Both project arms: `artist_id` is the caller's, never the form's, so the create site supplies
 * it and the edit site leaves it alone. An empty colour stays `null` here — a project with no
 * explicit colour renders the inherited shade, which is a real state rather than a missing one.
 */
function projectPayload(v: Record<string, string | null>): Omit<ProjectCreate, 'artist_id'> {
  return { code: v.code ?? '', name: v.name ?? '', status: v.status, color: v.color };
}

/**
 * „Löschen" inside the edit dialog — the delete affordance for an artist or a project (WP-34).
 *
 * Not a 🗑 in the page header, and not for lack of room: this is the one delete in the app that
 * takes a whole page's worth of work out of sight, and a header button sits a stray click away
 * on the surface the user looks at most. Two deliberate acts get in front of it instead — open
 * „✎ Bearbeiten", then confirm — which is also where the app already keeps a destructive control
 * (the Profilbild's „Entfernen", in this very dialog). The cost is findability; if that ever
 * bites, the answer is a hint next to „✎ Bearbeiten", not moving the button back out.
 *
 * The confirm is a nested `Modal` — the case `ModalDepthCtx` exists for, so Escape and the
 * backdrop close the question and leave the form standing. `Modal`'s own „Änderungen verwerfen?"
 * overlay is deliberately not reused: it is wired to `dirty` and the Escape contract, and asking
 * about unsaved edits to a record on its way to the Papierkorb would be a question with no
 * meaningful answer.
 */
function DeleteRecordAction({
  kind,
  id,
  name,
  noun,
  redirectTo,
  onDone,
}: {
  kind: 'artist' | 'project';
  id: ID;
  name: string;
  /** „Künstler" / „Projekt", following the renameable heading where there is one. */
  noun: string;
  /** Where to land afterwards — staying on the page of a deleted row is what PGS-05 catches. */
  redirectTo: string;
  /** Closes the edit dialog this button sits in. */
  onDone: () => void;
}) {
  const del = useUndoableDelete();
  const navigate = useNavigate();
  const nouns = useTypeLabels();
  const [confirming, setConfirming] = useState(false);
  const res = kind === 'artist' ? api.artists : api.projects;
  // Fetched when the *confirm* opens, not when the edit dialog does: renaming someone is the
  // common case and it has no business asking the server what hangs off the row.
  const { data: dependents, isPending } = useQuery({
    queryKey: ['dependents', kind, id],
    queryFn: () => res.dependents(id),
    enabled: confirming,
  });

  const remove = () => {
    setConfirming(false);
    onDone();
    // Navigate *before* the delete, not after it. `useUndoableDelete` awaits its invalidate()
    // before returning, so the page underneath refetches its own row, 404s, and flashes the
    // LoadError panel on the way out. ToastProvider and UndoProvider sit above HashRouter
    // (main.tsx), so the toast and the Cmd+Z entry outlive this component either way — and a
    // failed delete still reports itself, with the row untouched.
    //
    // `replace` because the page we are leaving is about to stop existing. A push kept it on the
    // history stack, so Zurück walked straight back into the LoadError panel this redirect exists
    // to avoid (PGS-05) — the row is gone, so the refetch 404s and there is nothing to render. An
    // undo restores the row but not the entry, which is the same trade every other delete makes.
    //
    // It is a React Router transition either way, so this page can still be mounted when the
    // delete settles — `gone` is what keeps that from becoming an error toast. `flushSync` around
    // the navigate does *not* close the gap: it flushes the sync lane and the router's update is
    // not in it. See `useUndoableDelete`.
    navigate(redirectTo, { replace: true });
    void del({ label: `${noun} „${name}“`, gone: [kind, id], ...resourceUndo(res, id) });
  };

  return (
    <>
      <Btn variant="danger" onClick={() => setConfirming(true)}>
        <TrashIcon className="h-4 w-4" /> Löschen
      </Btn>
      {confirming && (
        <Modal
          title={`${noun} löschen`}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Btn autoFocus onClick={() => setConfirming(false)}>
                Abbrechen
              </Btn>
              <Btn variant="danger" onClick={remove}>
                In den Papierkorb
              </Btn>
            </>
          }
        >
          <p className="text-sm text-neutral-600">„{name}“ in den Papierkorb legen?</p>
          {/* The count is a promise about what disappears, never a gate: this delete takes
              exactly one row, so a slow or failed lookup must not stand between the user and
              the button. Said out loud while it runs, so the paragraph below doesn't appear
              out of nowhere a moment after the dialog settles.

              Three lines, and no more: what happens, what goes with it, how to get it back.

              **Do not explain soft delete here.** The user expects a deleted artist to take
              its projects, tasks and Termine with it, and from where they sit that is what
              happens — everything vanishes from every list and comes back together. Earlier
              drafts insisted on the mechanism instead („Gelöscht wird nur dieser Eintrag —
              die übrigen Daten bleiben erhalten") and it reads as a correction to a belief
              that was never wrong, in words („die übrigen Daten") that name nothing the user
              can see. „Mit dabei:" answers the question actually being asked.

              The line about an entry keeping its children from expiring in the Papierkorb
              („solange sie daran hängen" — daran woran?) is gone for a related reason: SDL-01
              protects the user whether or not they read it, and it is what makes the third
              line's „alles wiederherstellbar" true indefinitely rather than a caveat. */}
          {isPending ? (
            <p className="mt-2 text-sm text-neutral-400">Wird geprüft, was mitgeht …</p>
          ) : (
            dependents != null &&
            dependents.total > 0 && (
              <p className="mt-2 text-sm text-neutral-600">Mit dabei: {cascadeText(dependents, nouns)}.</p>
            )
          )}
          <p className="mt-2 text-sm text-neutral-500">
            Alles wiederherstellbar im Archiv unter „Gelöschte Einträge“.
          </p>
        </Modal>
      )}
    </>
  );
}

export function NewArtistButton() {
  const invalidate = useInvalidateAll();
  const [open, setOpen] = useState(false);
  // Follow the „Künstler" heading rename (WP-F) — this button sits under the dashboard's
  // `dash.artists` section, and that is now the app's one artist noun.
  const artistLabel = useArtistNoun();
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
            await api.artists.create(artistCreatePayload(v));
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
  const artistLabel = useArtistNoun();
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
              patch: artistUpdatePayload(v),
              label: `Änderung an ${artistLabel}`,
            });
          }}
          onClose={() => setOpen(false)}
          danger={
            <DeleteRecordAction
              kind="artist"
              id={artist.id}
              name={artist.name}
              noun={artistLabel}
              redirectTo="/dashboard"
              onDone={() => setOpen(false)}
            />
          }
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
            await api.projects.create({ ...projectPayload(v), artist_id: artistId });
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
              patch: projectPayload(v),
              label: 'Änderung am Projekt',
            });
          }}
          onClose={() => setOpen(false)}
          danger={
            <DeleteRecordAction
              kind="project"
              id={project.id}
              // The header shows „CODE · Name"; the dialog names the row the same way the trash
              // will, so the user recognises the entry they are about to look for there.
              name={project.code ? `${project.code} · ${project.name}` : project.name}
              noun="Projekt"
              redirectTo={`/artist/${project.artist_id}`}
              onDone={() => setOpen(false)}
            />
          }
        />
      )}
    </>
  );
}
