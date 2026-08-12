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
 * is dropped on read, so removing one needs no migration.
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

  /** The kicker above the artist H1, not the page title (which is the artist's name). */
  'artist.kicker': 'Künstler',
  'artist.termine': 'Wichtige Termine',
  'artist.projekte': 'Projekte',
  'artist.stats': 'Aufgaben-Statistiken',
  'artist.aufmerksamkeit': 'Braucht Aufmerksamkeit',
  'artist.kontakte': 'Künstler-Kontakte',
  // Its own section here, unlike the project page, where the same list sits inside `kontakte`
  // (docs/DECISIONS.md, WP-36) — so this id names a section rather than a second heading.
  'artist.links': 'Dokumente & Links',
  'artist.aufgaben': 'Allgemeine Aufgaben',
  // PDF-only: the one-pager lists project tasks under their own heading. There is no artist-page
  // section for it (the app shows project tasks as card stats), so it has no in-app ✎ — renaming
  // „Allgemeine Aufgaben" still flows to both app and PDF via the key above.
  'artist.projektaufgaben': 'Projekt-Aufgaben',

  'project.kicker': 'Projekt',
  'project.termine': 'Wichtige Termine',
  // The project page's `kontakte` section renders two lists side by side, so it owns two
  // ids — renaming one leaves the other alone.
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
