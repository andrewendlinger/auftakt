import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readSeasonTerms } from '../../../electron/seasonTerms';

/**
 * The module under test lives in `electron/`, not here — same arrangement as `backupDir`,
 * `bootLog`, `cascade`, `exportName` and `windowBounds`: Vitest is installed in `client/` only,
 * and this is the only automated run that reaches Electron main-process code at all.
 *
 * Why it is worth a suite of its own: `readSeasonTerms` feeds three dialogs the customer sees at
 * his worst moments — the first-start backup prompt and the two backup failures — and two of
 * them are raised *because* something about the data directory went wrong. So the fallback path
 * matters more than the happy one: nothing in here may throw, whatever `seasons.json` contains,
 * and everything that is not a usable word has to land on „Saison“/„Saisons“.
 */

const dirs: string[] = [];

/** A throwaway data dir holding exactly this `seasons.json` (or none, for `null`). */
function dataDirWith(registry: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'auftakt-terms-'));
  dirs.push(dir);
  if (registry !== null) writeFileSync(join(dir, 'seasons.json'), registry, 'utf8');
  return dir;
}

const termsOf = (registry: string | null) => readSeasonTerms(dataDirWith(registry));

/** The shape the registry really has, trimmed to what this module reads. */
const registry = (terms: unknown): string =>
  JSON.stringify({ activeId: 1, seasons: [{ id: 1, label: 'Festival 2026', file: 'auftakt.db' }], terms });

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('readSeasonTerms', () => {
  it('reads the word the customer chose', () => {
    // The customer this was written for renamed „Saison“ to „Festival“ — the dialogs have to
    // follow, because one of them names the Einstellungen tab, whose label IS this word.
    expect(termsOf(registry({ season: 'Festival', seasonPlural: 'Festivals' }))).toEqual({
      singular: 'Festival',
      plural: 'Festivals',
    });
  });

  it('falls back per term, not as a pair', () => {
    // Renaming only the singular is an ordinary thing to do — Einstellungen keeps the two
    // fields apart — and it must not drag the plural back to the default *and* vice versa.
    expect(termsOf(registry({ season: 'Jahrgang' }))).toEqual({ singular: 'Jahrgang', plural: 'Saisons' });
    expect(termsOf(registry({ seasonPlural: 'Jahrgänge' }))).toEqual({ singular: 'Saison', plural: 'Jahrgänge' });
  });

  it('trims, and treats blank as unset — exactly as seasonTerms() in db.ts does', () => {
    expect(termsOf(registry({ season: '  Festival  ', seasonPlural: '\tFestivals\n' }))).toEqual({
      singular: 'Festival',
      plural: 'Festivals',
    });
    expect(termsOf(registry({ season: '   ', seasonPlural: '' }))).toEqual({ singular: 'Saison', plural: 'Saisons' });
  });

  it('defaults when no terms were ever set', () => {
    expect(termsOf(registry(undefined))).toEqual({ singular: 'Saison', plural: 'Saisons' });
    expect(termsOf('{}')).toEqual({ singular: 'Saison', plural: 'Saisons' });
  });

  it('survives every broken registry rather than throwing', () => {
    // Each of these is reachable: no data dir yet on a first launch, a half-written file after a
    // crash, a hand-edited one (seasons.json is documented as hand-editable), or a file whose
    // JSON is fine but whose shape is not. A throw here would replace the backup error dialog
    // with an unhandled rejection — the failure would then be reported by nothing at all.
    for (const broken of [null, '', '{ "terms": ', 'null', '[]', '"Festival"', '42']) {
      expect(termsOf(broken)).toEqual({ singular: 'Saison', plural: 'Saisons' });
    }
    // A path that is not a directory at all (nothing was created here).
    expect(readSeasonTerms(join(tmpdir(), 'auftakt-terms-does-not-exist'))).toEqual({
      singular: 'Saison',
      plural: 'Saisons',
    });
  });

  it('ignores terms that are not usable words', () => {
    // JSON can carry anything; only a non-empty string is a word a dialog can print.
    expect(termsOf(registry('Festival'))).toEqual({ singular: 'Saison', plural: 'Saisons' });
    expect(termsOf(registry({ season: 42, seasonPlural: ['Festivals'] }))).toEqual({
      singular: 'Saison',
      plural: 'Saisons',
    });
  });
});
