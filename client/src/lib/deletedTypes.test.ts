import { describe, expect, it } from 'vitest';
import { cascadeText, TYPE_LABELS } from './deletedTypes';

/**
 * `cascadeText` writes the only sentence standing between a click and a delete — in the archive
 * it describes rows that are about to be destroyed for good. A wrong number or a plural that
 * reads like a different quantity is not a typo there, so the cases below are the ones a user
 * actually meets: one row, two rows, and the three-way list where German wants „und" last.
 */
describe('cascadeText', () => {
  it('is empty when nothing depends on the row', () => {
    expect(cascadeText({ total: 0, byType: {} })).toBe('');
  });

  it('uses the singular for exactly one', () => {
    expect(cascadeText({ total: 1, byType: { event: 1 } })).toBe('1 Termin');
  });

  it('uses the plural above one', () => {
    expect(cascadeText({ total: 3, byType: { event: 3 } })).toBe('3 Termine');
  });

  it('joins two with „und", not a comma', () => {
    expect(cascadeText({ total: 4, byType: { task: 3, event: 1 } })).toBe('3 Aufgaben und 1 Termin');
  });

  it('separates the head with commas and only the last with „und"', () => {
    const text = cascadeText({ total: 6, byType: { task: 3, event: 1, link: 2 } });
    expect(text).toBe('3 Aufgaben, 1 Termin und 2 Dokumente');
  });

  // The server omits a type it counted none of, but nothing in the wire format promises that,
  // and „0 Dokumente" inside a warning sentence reads as a bug in the warning.
  it('drops zero counts rather than printing them', () => {
    expect(cascadeText({ total: 1, byType: { task: 1, link: 0 } })).toBe('1 Aufgabe');
  });

  // „Künstler" is the same word either way — the one entry where a naive „+n" plural would lie.
  it('leaves an unchanging plural alone', () => {
    expect(TYPE_LABELS.artist.one).toBe(TYPE_LABELS.artist.many);
    expect(cascadeText({ total: 2, byType: { artist: 2 } })).toBe('2 Künstler');
  });
});
