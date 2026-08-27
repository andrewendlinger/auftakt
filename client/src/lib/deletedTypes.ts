import type { DependentCounts, DeletedType } from '../api/types';

/** One row type's noun, singular and plural. */
export type TypeLabels = Record<DeletedType, { one: string; many: string }>;

/**
 * The German noun for each row type, and the sentence that counts a set of them.
 *
 * Shared by the two surfaces that put a number in front of a delete: the archive's „Endgültig
 * löschen" (what the cascade destroys) and the artist/project „Löschen" confirmation (what a soft
 * delete hides, WP-34). They mean different things — see `DependentCounts` — but they say them in
 * the same words, and a second copy of this table is how the two would start disagreeing about
 * „Dokument" vs „Link" on the same row.
 *
 * These are the *defaults*: `artist` is renameable (`dash.artists`), so React callers go through
 * `useTypeLabels()` rather than reading this table directly.
 */
export const TYPE_LABELS: TypeLabels = {
  task: { one: 'Aufgabe', many: 'Aufgaben' },
  event: { one: 'Termin', many: 'Termine' },
  artist: { one: 'Künstler', many: 'Künstler' },
  project: { one: 'Projekt', many: 'Projekte' },
  contact: { one: 'Kontakt', many: 'Kontakte' },
  link: { one: 'Dokument', many: 'Dokumente' },
  section: { one: 'Bereich', many: 'Bereiche' },
  column: { one: 'Spalte', many: 'Spalten' },
};

/**
 * "3 Aufgaben, 1 Termin und 2 Dokumente" from the dependents map — German list punctuation, so
 * the last separator is „und" and never a comma. An empty map is the empty string, which every
 * caller renders by leaving the sentence out entirely rather than printing „und nichts".
 *
 * Zero counts are dropped rather than printed: the server omits a type it found none of, but a
 * `{link: 0}` from any future caller would otherwise become „0 Dokumente" in the middle of a
 * sentence that is supposed to read as a warning.
 *
 * `labels` defaults to the shipped table so the non-React callers — and the tests — stay a
 * one-argument call; a page that has resolved a rename passes `useTypeLabels()` instead.
 */
export function cascadeText(dep: DependentCounts, labels: TypeLabels = TYPE_LABELS): string {
  const parts = (Object.entries(dep.byType) as Array<[DeletedType, number]>)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${n} ${n === 1 ? labels[t].one : labels[t].many}`);
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}`;
}

/**
 * The table with the renameable nouns applied — today only `artist`, which follows the Übersicht's
 * `dash.artists` heading.
 *
 * One word serves both forms, exactly as the German default does („ein Künstler", „drei Künstler").
 * A festival that renames to „Act" therefore reads „3 Act"; deriving a plural would mean guessing
 * at a noun the app has never seen, and a second id to hold it is the split this whole change
 * removed.
 */
export function typeLabels(artist: string): TypeLabels {
  if (artist === TYPE_LABELS.artist.one) return TYPE_LABELS;
  return { ...TYPE_LABELS, artist: { one: artist, many: artist } };
}
