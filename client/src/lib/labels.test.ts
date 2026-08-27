import { describe, expect, it } from 'vitest';
import { LABEL_DEFAULTS, labelText, resolveLabels } from './labels';

/**
 * The precedence rule behind „rename it once". `dash.artists` and the retired `artist.kicker` both
 * rendered „Künstler" from separate rows, so a festival that renamed one kept reading the old word
 * on the other page. Joining them is only safe if a stored `artist.kicker` still resolves — that is
 * a customer's rename, and silently reverting it is the failure this file exists to catch.
 */
describe('resolveLabels', () => {
  it('renders the shipped default when nothing is stored', () => {
    expect(labelText(resolveLabels([]), 'dash.artists')).toBe('Künstler');
    expect(labelText(resolveLabels([]), 'artist.termine')).toBe(LABEL_DEFAULTS['artist.termine']);
  });

  it('prefers an override over the default', () => {
    const m = resolveLabels([{ key: 'dash.artists', label: 'Musiker' }]);
    expect(labelText(m, 'dash.artists')).toBe('Musiker');
  });

  it('resolves a retired id onto the one it was folded into', () => {
    const m = resolveLabels([{ key: 'artist.kicker', label: 'Musiker' }]);
    expect(labelText(m, 'dash.artists')).toBe('Musiker');
  });

  // Both rows present is the customer who renamed each page separately before they were joined.
  // The Übersicht's section title is the surviving id, so it wins — and it has to win whatever
  // order the rows sit in, because `useRenameLabel` appends and the array order is arbitrary.
  it('lets the surviving id win over the retired one, in either row order', () => {
    const rows = [
      { key: 'artist.kicker', label: 'Act' },
      { key: 'dash.artists', label: 'Acts' },
    ];
    expect(labelText(resolveLabels(rows), 'dash.artists')).toBe('Acts');
    expect(labelText(resolveLabels([...rows].reverse()), 'dash.artists')).toBe('Acts');
  });

  // Written by a newer build, or left behind by a section that no longer exists. Dropping it on
  // read is what lets a section be removed without a migration.
  it('ignores an id this build does not know', () => {
    const m = resolveLabels([{ key: 'dash.wasauchimmer', label: 'Etwas' }]);
    expect(m.size).toBe(0);
  });
});
