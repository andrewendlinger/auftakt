import type { LabelOverride } from '../api/types';

/**
 * Every renameable UI heading, keyed by a stable id that never changes even when the user
 * renames what it shows. The values here are the *defaults* — user overrides live in the
 * `labels` setting (a `LabelOverride[]`, resolved by `useLabel()`), so a fresh database
 * renders exactly these strings.
 *
 * Each default must stay in sync with what the app actually rendered before it became
 * renameable — not with the old `SECTION_LABELS` maps, which had drifted apart from the
 * visible headings (`termine` said "Termine" in the arrange strip but "Wichtige Termine" on
 * the page). This registry is now the single source for both.
 *
 * Adding a section to a page means adding its id here; a stored override whose id is absent
 * is dropped on read, so removing one needs no migration — unless the id was *retired into*
 * another, which is what LEGACY_LABEL_KEYS is for.
 */
export const LABEL_DEFAULTS = {
  'dash.artists': 'Künstler',
  // No day count in the default: the window is a setting now, and everything past it is still on
  // the page under „Danach" — a heading that states a number would contradict both (WP-33).
  'dash.events': 'Nächste Termine',
  'dash.tasks': 'Aufgaben',
  'dash.festival': 'Festival-Aufgaben',
  'dash.stats': 'Aufgaben-Statistiken',
  'dash.aufmerksamkeit': 'Braucht Aufmerksamkeit',
  // The editable season-level lists (WP-48) — `dash.termine` is the editable twin next to the
  // read-only `dash.events` roll-up, hence the „Saison-" prefix that tells them apart.
  'dash.termine': 'Saison-Termine',
  'dash.kontakte': 'Saison-Kontakte',
  'dash.links': 'Dokumente & Links',

  // No `artist.kicker`: the line above the artist H1 names the same thing as the Übersicht's
  // section box, and two ids that shared a default drifted the moment either was renamed — see
  // LEGACY_LABEL_KEYS below. It renders `dash.artists` and has no ✎ of its own.
  'artist.termine': 'Wichtige Termine',
  'artist.projekte': 'Projekte',
  'artist.stats': 'Aufgaben-Statistiken',
  'artist.aufmerksamkeit': 'Braucht Aufmerksamkeit',
  'artist.kontakte': 'Künstler-Kontakte',
  'artist.links': 'Dokumente & Links',
  'artist.aufgaben': 'Allgemeine Aufgaben',
  // PDF-only: the one-pager lists project tasks under their own heading. There is no artist-page
  // section for it (the app shows project tasks as card stats), so it has no in-app ✎ — renaming
  // „Allgemeine Aufgaben" still flows to both app and PDF via the key above.
  'artist.projektaufgaben': 'Projekt-Aufgaben',

  'project.kicker': 'Projekt',
  'project.termine': 'Wichtige Termine',
  'project.kontakte': 'Projekt-Kontakte',
  'project.links': 'Dokumente & Links',
  'project.stats': 'Aufgaben-Statistiken',
  'project.aufmerksamkeit': 'Braucht Aufmerksamkeit',
  'project.aufgaben': 'Aufgaben',

  // Landing-page sections. Overrides live in per-season settings while the landing's
  // layout and content are cross-season (seasons.json) — an accepted asymmetry.
  'landing.notizen': 'Notizen',
  'landing.dokumente': 'Dokumente',
} as const;

export type LabelKey = keyof typeof LABEL_DEFAULTS;

export function isLabelKey(k: string): k is LabelKey {
  return k in LABEL_DEFAULTS;
}

/**
 * Ids that were retired into another id, rather than simply removed.
 *
 * `artist.kicker` and `dash.artists` both rendered „Künstler" and were stored independently, so a
 * festival that renamed one still read the old word on the other page — and could not tell which
 * of the two pencils was the one that „worked". They are one id now, renamed on the Übersicht.
 *
 * A stored override under a legacy key still resolves, onto its target and only while the target
 * has no override of its own, so a customer who renamed the kicker before the two were joined
 * keeps that word instead of silently reverting to the default. Nothing writes a legacy key any
 * more: `useRenameLabel` always writes the target, and `parseLabelOverrides` keeps the stale row
 * around harmlessly. A read-side alias rather than a migration — there is one `labels` array per
 * season, and rewriting every season's settings to save one lookup is the worse trade.
 */
export const LEGACY_LABEL_KEYS: Record<string, LabelKey> = {
  'artist.kicker': 'dash.artists',
};

/**
 * Stored override rows resolved to text, legacy ids folded in. Own overrides are applied *after*
 * the aliases, so „the target wins" holds whatever order the rows happen to sit in — the array is
 * appended to by `useRenameLabel`, so that order is arbitrary.
 *
 * Pure, and here rather than in `hooks.ts`, so `check:unit` can reach the precedence rule without
 * pulling React into the test run (the `sectionSpecs.ts` precedent).
 */
export function resolveLabels(rows: LabelOverride[]): Map<LabelKey, string> {
  const out = new Map<LabelKey, string>();
  for (const { key, label } of rows) {
    const target = LEGACY_LABEL_KEYS[key];
    if (target) out.set(target, label);
  }
  for (const { key, label } of rows) {
    if (isLabelKey(key)) out.set(key, label);
  }
  return out;
}

/** The text an id renders: the user's override if there is one, else the shipped default. */
export function labelText(overrides: Map<LabelKey, string>, key: LabelKey): string {
  return overrides.get(key) ?? LABEL_DEFAULTS[key];
}
