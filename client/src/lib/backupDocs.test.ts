import { describe, expect, it } from 'vitest';
import {
  manifestText,
  readmeText,
  type DocPlatform,
  type ReadmeOptions,
} from '../../../server/src/lib/backupDocs';

/**
 * The module under test lives in `server/`, not here — the same odd import `backupDir.test.ts`
 * makes into `electron/`, and for the same reason: vitest is installed in `client/` only.
 *
 * Why it needs covering at all, when `npm run check:backup` already drives the real backup run:
 * since WP-68 the README is written for the platform it runs on, and that run therefore renders
 * exactly one of the two — the macOS one on Andre's machine, the macOS one in Linux CI. The text
 * the customer actually receives is the Windows one, and nothing else in the repo ever produces
 * it. These assertions are the only place it exists before it exists in his Google Drive.
 *
 * What they cannot check is whether the prose is understandable, which is the whole point of the
 * file; `docs/BACKUP-TESTING.md` case 3c and case 7 are where a human reads it cold.
 */

const OPTS: ReadmeOptions = {
  platform: 'mac',
  dataDir: '/Users/kunde/Library/Application Support/auftakt',
  terms: { singular: 'Saison', plural: 'Saisons' },
  keep: 30,
  pointsDir: 'backups',
  preImportDir: 'pre-import',
  hasLegacyFlatFiles: false,
};

const WIN: ReadmeOptions = {
  ...OPTS,
  platform: 'windows',
  dataDir: 'C:\\Users\\Kunde\\AppData\\Roaming\\auftakt',
};

const PLATFORMS: DocPlatform[] = ['windows', 'mac'];

describe.each(PLATFORMS)('readmeText — %s', (platform) => {
  const opts = platform === 'windows' ? WIN : OPTS;
  const text = readmeText(opts);

  /**
   * The three encoding assertions `check:backup`'s windowsDoc() makes, applied to *both*
   * renderings: the folder is opened in Notepad out of Google Drive, and without the BOM or
   * with a bare LF the customer gets mojibake or one endless line — the state WP-41 fixed.
   */
  it('is a Windows text file: BOM, CRLF only, umlauts intact', () => {
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('\r\n');
    expect(text).not.toMatch(/[^\r]\n/);
    expect(text).toMatch(/[äöü]/);
  });

  it('names this machine’s data directory and the portable spelling of it', () => {
    expect(text).toContain(opts.dataDir);
    expect(text).toContain(
      platform === 'windows' ? '%APPDATA%\\auftakt' : '~/Library/Application Support/auftakt',
    );
  });

  /**
   * `check:backup` asserts /%APPDATA%/ on whatever machine it runs on — a Mac or Linux CI, i.e.
   * against the macOS rendering. It holds there only because the closing section names the other
   * platform's folder, so this pins that section rather than leaving the gate depending on it by
   * accident.
   */
  it('closes with the other platform’s two differences', () => {
    const other = platform === 'windows' ? 'Mac' : 'Windows-Rechner';
    expect(text).toContain(`Wenn du an einem ${other} sitzt`);
    expect(text).toContain(
      platform === 'windows' ? '~/Library/Application Support/auftakt' : '%APPDATA%\\auftakt',
    );
  });

  /** The sidecar trap: a `-wal` from the previous database is replayed into the restored one. */
  it('tells the reader to delete the -wal and -shm files', () => {
    expect(text).toContain('.db-wal');
    expect(text).toContain('.db-shm');
  });

  /** Quitting is the one step that genuinely differs, and the reason the text is split at all. */
  it('describes quitting the way this platform really works', () => {
    if (platform === 'windows') expect(text).toContain('Schließe alle Auftakt-Fenster');
    else expect(text).toContain('„Auftakt beenden“');
  });

  it('speaks of Backups, never of Sicherungen or Zurückspielen', () => {
    expect(text).not.toMatch(/Sicherung|zurückspiel|Zurückspiel/i);
    expect(text).toContain('Ein Backup laden');
  });

  /**
   * Paired with `check:backup`'s two assertions (:269 and :540): the paragraph about the flat
   * files older versions wrote must appear only in a folder that has some.
   */
  it('mentions the flat legacy files only when there are some', () => {
    expect(text).not.toContain('auftakt-<Zeitstempel>.db');
    expect(readmeText({ ...opts, hasLegacyFlatFiles: true })).toContain('auftakt-<Zeitstempel>.db');
  });
});

describe('the customer’s own word for a season', () => {
  const terms = { singular: 'Festival', plural: 'Festivals' };
  const text = readmeText({ ...WIN, terms, hasLegacyFlatFiles: true });

  it('replaces „Saison" everywhere in the README', () => {
    expect(text).toContain('je Festival');
    expect(text).toContain('aller Festivals');
    expect(text).toContain('„Festival & Daten“');
    expect(text).not.toMatch(/Saison/);
  });

  /**
   * The word has an unknowable grammatical gender, so no article or inflected determiner may
   * precede it — „ein Backup einer einzelnen Festival" is what that produces. This is the cheap
   * guard against the next edit reintroducing one.
   */
  it('never puts an article in front of it', () => {
    expect(text).not.toMatch(/\b(der|die|das|dem|den|des|eine[rmns]?|ein)\s+(einzelnen\s+)?Festival/i);
  });

  it('replaces „Saison" in the MANIFEST too', () => {
    const m = manifestText({
      at: new Date(2026, 7, 18, 9, 14),
      version: '0.11.0',
      seasons: [{ file: 'auftakt.db', label: 'Festival 2026' }],
      registryFile: 'seasons.json',
      terms,
    });
    expect(m).toContain('Diese Festivals sind gesichert:');
    expect(m).not.toMatch(/Saison/);
  });
});

describe('manifestText', () => {
  const at = new Date(2026, 7, 18, 9, 14);
  const terms = { singular: 'Saison', plural: 'Saisons' };
  const seasons = [
    { file: 'auftakt.db', label: 'Festival 2026' },
    { file: 'season-2.db', label: 'Festival 2027' },
  ];

  /** The shape `check:backup` parses: the label last on its line, behind `=` and two spaces. */
  it('names every season by its label, in the shape the gate reads', () => {
    const m = manifestText({ at, version: '0.11.0', seasons, registryFile: 'seasons.json', terms });
    for (const s of seasons) {
      const line = m.split('\r\n').find((l) => l.includes(s.file));
      expect(line).toContain(`=  ${s.label}`);
    }
    expect(m).toMatch(/App-Version: \S+/);
  });

  /**
   * The registry line is conditional and labels may be umlaut-free, so the file could lose its
   * last umlaut — and with it the assertion that proves the BOM survived. It must carry one on
   * its own.
   */
  it('keeps a BOM, CRLF and an umlaut even with no registry and plain labels', () => {
    const m = manifestText({
      at,
      version: 'unbekannt',
      seasons: [{ file: 'auftakt.db', label: 'Test 2026' }],
      registryFile: null,
      terms,
    });
    expect(m.charCodeAt(0)).toBe(0xfeff);
    expect(m).not.toMatch(/[^\r]\n/);
    expect(m).toMatch(/[äöü]/);
    expect(m).not.toContain('seasons.json');
  });
});
