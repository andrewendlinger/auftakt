import type { ReactNode } from 'react';
import type { LabelKey } from './labels';
import type { SectionGroup } from './sections';

/**
 * The section catalog: one spec per built-in section of a page, replacing the five parallel
 * maps/arrays `SectionArranger` takes (`sections`, `labelKeys`, `mandatoryKeys`,
 * `defaultHidden`, `fullWidthKeys`) plus the per-page `SECTION_GROUPS` picker table. Before
 * this, a section was described in up to six places, and a key missing from the groups table
 * silently dropped out of the „+ Bereich" picker (PGS-28).
 *
 * The derivation lives here rather than in `SectionCatalog.tsx` so `check:unit` can reach it
 * without pulling React and the API client into a node test run (the `layoutEntries.ts`
 * precedent — `import type` is erased at compile time).
 */

/**
 * One built-in section, in default order: spec order IS the fresh-layout order, because
 * `arrangerConfig` builds the `sections` object in array order and the arranger appends
 * unknown keys to a stored layout in that object's insertion order.
 *
 * The union makes "removable but ungroupable" unrepresentable: a mandatory section never
 * appears in the picker (it cannot be removed), everything else must say which picker group
 * offers it back — so the PGS-28 class dies at the type level.
 */
export type SectionSpec = {
  key: string;
  labelKey: LabelKey;
  node: ReactNode;
  /** Can't be set to half width (always full, no width toggle) — e.g. the task table. */
  fullWidth?: boolean;
  /** Starts hidden: appended as a tombstone when absent from the stored layout. */
  defaultHidden?: boolean;
  /** Width a fresh layout entry gets on first append (WP-D mechanism; default 'full'). */
  defaultWidth?: 'half';
} & (
  | { mandatory: true; group?: never }
  | { mandatory?: false; group: SectionGroup }
);

/** `SectionArranger`'s per-section props, derived from one spec list. */
export interface ArrangerConfig {
  sections: Record<string, ReactNode>;
  labelKeys: Record<string, LabelKey>;
  mandatoryKeys: string[];
  defaultHidden: string[];
  fullWidthKeys: string[];
  /** Only the deviations from 'full' — {} while no spec sets `defaultWidth`. */
  defaultWidths: Record<string, 'half'>;
}

export function arrangerConfig(specs: SectionSpec[]): ArrangerConfig {
  const cfg: ArrangerConfig = {
    sections: {},
    labelKeys: {},
    mandatoryKeys: [],
    defaultHidden: [],
    fullWidthKeys: [],
    defaultWidths: {},
  };
  for (const s of specs) {
    cfg.sections[s.key] = s.node;
    cfg.labelKeys[s.key] = s.labelKey;
    if (s.mandatory) cfg.mandatoryKeys.push(s.key);
    if (s.defaultHidden) cfg.defaultHidden.push(s.key);
    if (s.fullWidth) cfg.fullWidthKeys.push(s.key);
    if (s.defaultWidth) cfg.defaultWidths[s.key] = s.defaultWidth;
  }
  return cfg;
}

/** A hidden built-in section the „+ Bereich" picker can re-add. */
export interface HiddenBuiltin {
  key: string;
  labelKey: LabelKey;
  group: SectionGroup;
}

/**
 * The picker rows for a page's hidden built-ins, in `hiddenKeys` order (stored-layout order).
 * A key without a spec is dropped rather than asserted: `hiddenKeys` comes from the stored
 * layout, which can carry a key this page does not know. Mandatory specs are skipped
 * defensively — the arranger's read pass already strips `hidden` from mandatory keys, so they
 * cannot normally appear here.
 */
export function pickerBuiltins(specs: SectionSpec[], hiddenKeys: string[]): HiddenBuiltin[] {
  const rows: HiddenBuiltin[] = [];
  for (const key of hiddenKeys) {
    const spec = specs.find((s) => s.key === key);
    if (spec && !spec.mandatory && spec.group)
      rows.push({ key, labelKey: spec.labelKey, group: spec.group });
  }
  return rows;
}
