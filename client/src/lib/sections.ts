/**
 * The two kinds of section a user can add, and their German names.
 *
 * Shared because there are two pickers for the same choice — `AddSectionModal` creates a
 * per-season `custom_sections` row, `AddLandingSectionButton` a cross-season registry section —
 * and the list sat in both files. Adding a third type, or renaming „Dokumente & Links" in one
 * picker but not the other, is exactly the kind of drift nothing here would catch: there is no
 * linter and no test framework (SHL-29).
 *
 * Both section tables use the same two type values, so one list serves both.
 */
export type SectionType = 'text' | 'links';

export const SECTION_TYPES: Array<{ type: SectionType; label: string }> = [
  { type: 'text', label: 'Textfeld' },
  { type: 'links', label: 'Dokumente & Links' },
];

/**
 * Which group of the add picker a built-in section belongs to: „Eingabe" for sections the user
 * fills, „Einblicke" for computed views. Lives here rather than in `CustomSections.tsx` so
 * `lib/sectionSpecs.ts` can use it without a node test run importing a React component file.
 */
export type SectionGroup = 'eingabe' | 'einblicke';
