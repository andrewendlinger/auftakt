import { describe, expect, it } from 'vitest';
import { arrangerConfig, pickerBuiltins, type SectionSpec } from './sectionSpecs';

/**
 * The catalog's one load-bearing invariant is ORDER: `arrangerConfig` builds the `sections`
 * object in spec-array order, and that insertion order is what the arranger appends to a
 * stored layout — reorder the keys and every fresh page changes. The rest is exact flag
 * derivation, plus `pickerBuiltins`' guard against keys a stored layout carries but the page
 * does not know (the PGS-28 family: those used to become unnamed picker rows or crashes).
 */

const specs: SectionSpec[] = [
  { key: 'artists', labelKey: 'dash.artists', mandatory: true, node: null },
  { key: 'events', labelKey: 'dash.events', group: 'einblicke', node: null },
  { key: 'stats', labelKey: 'dash.stats', group: 'einblicke', defaultHidden: true, node: null },
  { key: 'tasks', labelKey: 'dash.tasks', mandatory: true, fullWidth: true, node: null },
  {
    key: 'aufmerksamkeit',
    labelKey: 'dash.aufmerksamkeit',
    group: 'einblicke',
    fullWidth: true,
    node: null,
  },
];

describe('arrangerConfig', () => {
  it('preserves spec order as the sections-object insertion order', () => {
    expect(Object.keys(arrangerConfig(specs).sections)).toEqual([
      'artists',
      'events',
      'stats',
      'tasks',
      'aufmerksamkeit',
    ]);
  });

  it('maps every spec key to its labelKey and nothing else', () => {
    expect(arrangerConfig(specs).labelKeys).toEqual({
      artists: 'dash.artists',
      events: 'dash.events',
      stats: 'dash.stats',
      tasks: 'dash.tasks',
      aufmerksamkeit: 'dash.aufmerksamkeit',
    });
  });

  it('derives exactly the flagged keys, in spec order', () => {
    const cfg = arrangerConfig(specs);
    expect(cfg.mandatoryKeys).toEqual(['artists', 'tasks']);
    expect(cfg.defaultHidden).toEqual(['stats']);
    expect(cfg.fullWidthKeys).toEqual(['tasks', 'aufmerksamkeit']);
  });

  it('leaves defaultWidths empty while no spec deviates', () => {
    expect(arrangerConfig(specs).defaultWidths).toEqual({});
  });

  it('carries a half defaultWidth through — the dormant WP-D mechanism', () => {
    const withHalf: SectionSpec[] = [
      ...specs,
      { key: 'kontakte', labelKey: 'dash.artists', group: 'eingabe', defaultWidth: 'half', node: null },
    ];
    expect(arrangerConfig(withHalf).defaultWidths).toEqual({ kontakte: 'half' });
  });
});

describe('pickerBuiltins', () => {
  it('returns hidden removable sections in hiddenKeys order', () => {
    expect(pickerBuiltins(specs, ['aufmerksamkeit', 'stats'])).toEqual([
      { key: 'aufmerksamkeit', labelKey: 'dash.aufmerksamkeit', group: 'einblicke' },
      { key: 'stats', labelKey: 'dash.stats', group: 'einblicke' },
    ]);
  });

  it('drops a key the page does not know instead of throwing', () => {
    expect(pickerBuiltins(specs, ['foreign', 'stats'])).toEqual([
      { key: 'stats', labelKey: 'dash.stats', group: 'einblicke' },
    ]);
  });

  it('skips a mandatory key even if a stale layout claims it hidden', () => {
    expect(pickerBuiltins(specs, ['tasks'])).toEqual([]);
  });
});
