/**
 * The section catalog's import surface for pages: the spec type and derivation live in
 * `lib/sectionSpecs.ts` so `check:unit` reaches them without React (the `layoutEntries.ts`
 * precedent); this file re-exports them and holds the shared section bodies.
 */
export { arrangerConfig, pickerBuiltins } from '../lib/sectionSpecs';
export type { SectionSpec, ArrangerConfig, HiddenBuiltin } from '../lib/sectionSpecs';
