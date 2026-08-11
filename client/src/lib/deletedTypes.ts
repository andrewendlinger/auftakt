import type { DependentCounts, DeletedType } from '../api/types';

/**
 * The German noun for each row type, and the sentence that counts a set of them.
 *
 * Shared by the two surfaces that put a number in front of a delete: the archive's „Endgültig
 * löschen" (what the cascade destroys) and the artist/project „Löschen" confirmation (what a soft
 * delete hides, WP-34). They mean different things — see `DependentCounts` — but they say them in
 * the same words, and a second copy of this table is how the two would start disagreeing about
 * „Dokument" vs „Link" on the same row.
 */
export const TYPE_LABELS: Record<DeletedType, { one: string; many: string }> = {
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
 */
export function cascadeText(dep: DependentCounts): string {
  const parts = (Object.entries(dep.byType) as Array<[DeletedType, number]>)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${n} ${n === 1 ? TYPE_LABELS[t].one : TYPE_LABELS[t].many}`);
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}`;
}
