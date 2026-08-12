import { describe, expect, it } from 'vitest';
import { exportFileName, labelSlug } from '../../../electron/exportName';

/**
 * Same arrangement as backupDir.test.ts and bootLog.test.ts: the module lives in `electron/`,
 * imports nothing from `electron`, and this suite is the only automated run that reaches it.
 *
 * Why it is worth pinning: the season label reaching this function is free text the user typed
 * into „Saison umbenennen", and its output goes into a save dialog's `defaultPath`. „Festival
 * 25/26" is an entirely ordinary German festival name and contains a path separator — left in,
 * it points the dialog at a directory instead of proposing a file. The other half (that the
 * dialog really opens on that name) stays manual, docs/BACKUP-TESTING.md case 6.
 */

describe('labelSlug', () => {
  it('keeps letters and digits and joins the rest with single dashes', () => {
    expect(labelSlug('Festival 2026')).toBe('Festival-2026');
    expect(labelSlug('Saison 2025 — Sommer')).toBe('Saison-2025-Sommer');
  });

  it('removes path separators, so a label cannot redirect the save dialog', () => {
    // The reason this function exists. Both separators, because Windows takes either.
    expect(labelSlug('Festival 25/26')).toBe('Festival-25-26');
    expect(labelSlug('Festival 25\\26')).toBe('Festival-25-26');
    expect(labelSlug('../../etc')).toBe('etc');
  });

  it('removes the rest of Windows reserved characters and control chars', () => {
    expect(labelSlug('Was: "jetzt"? <hier>|dort*')).toBe('Was-jetzt-hier-dort');
    expect(labelSlug('Zeile\nZwei\tDrei')).toBe('Zeile-Zwei-Drei');
  });

  it('keeps umlauts and ß — both platforms take them', () => {
    // The customer's own labels are German; stripping them would be the wrong kind of safe.
    expect(labelSlug('Frühjahr Öffnung Straße')).toBe('Frühjahr-Öffnung-Straße');
  });

  it('caps the length without leaving a trailing dash', () => {
    const slug = labelSlug('a'.repeat(38) + ' bcdefghij');
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('gives back nothing when nothing usable is left', () => {
    expect(labelSlug('')).toBe('');
    expect(labelSlug('   ')).toBe('');
    expect(labelSlug('///')).toBe('');
  });
});

describe('exportFileName', () => {
  it('names the season between the prefix and the stamp', () => {
    expect(exportFileName('Festival 2026', '2026-08-12-1430')).toBe(
      'auftakt-Festival-2026-2026-08-12-1430.db',
    );
  });

  it('falls back to the plain name when there is no usable label', () => {
    // The pre-PR50-03 name. Reached when seasonLabel() could not resolve one at all.
    expect(exportFileName('', '2026-08-12-1430')).toBe('auftakt-2026-08-12-1430.db');
    expect(exportFileName('%%%', '2026-08-12-1430')).toBe('auftakt-2026-08-12-1430.db');
  });
});
