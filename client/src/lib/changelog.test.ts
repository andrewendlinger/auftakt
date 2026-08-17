import { describe, expect, it } from 'vitest';
import {
  APP_VERSION,
  changelogAnnouncement,
  changelogSince,
  parseChangelog,
} from './changelog';
import CHANGELOG_MD from '../../../CHANGELOG.md?raw';

/**
 * „Was ist neu" (WP-63) — the half of the announcement mechanism that lives in the client,
 * because the text is `CHANGELOG.md` and the text is bundled.
 *
 * The split anchor is a contract, not a convenience: `docs/DECISIONS.md` records that `## X.Y.Z`
 * is written as a bare version number *so that this parse is possible*. The last test here is
 * what makes that contract enforceable — it reads the real file through the real `?raw` import,
 * so a changed heading style, a moved file or a broken bundling path fails a check rather than
 * quietly showing the customer nothing after an update.
 */

const FIXTURE = `# Änderungen

Ein Vorspann, der zu keinem Eintrag gehört.

## 0.11.0 — 1. September 2026

- **Etwas Neues** — und wofür es gut ist.

## 0.10.0 — 16. August 2026

Ein Satz über diese Version.

- Ein Punkt.

## 0.9.2 — 1. August 2026

Nur eine Zeile.
`;

describe('parseChangelog', () => {
  it('splits on the bare version headings, newest first', () => {
    expect(parseChangelog(FIXTURE).map((e) => e.version)).toEqual(['0.11.0', '0.10.0', '0.9.2']);
  });

  it('keeps the whole heading, and drops the intro above the first entry', () => {
    const [first] = parseChangelog(FIXTURE);
    expect(first?.heading).toBe('0.11.0 — 1. September 2026');
    // The prose under „# Änderungen" belongs to no version and must never end up in a card.
    expect(JSON.stringify(parseChangelog(FIXTURE))).not.toContain('Vorspann');
  });

  it('trims blank lines off an entry body but leaves its Markdown alone', () => {
    const entry = parseChangelog(FIXTURE).find((e) => e.version === '0.10.0');
    expect(entry?.body).toBe('Ein Satz über diese Version.\n\n- Ein Punkt.');
  });

  it('ignores a `##` heading that is not a version', () => {
    const md = '## 1.0.0 — heute\n\n## Nicht eine Version\n\nText.\n';
    const entries = parseChangelog(md);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.body).toContain('## Nicht eine Version');
  });

  it('answers an empty list for a file with no entries', () => {
    expect(parseChangelog('# Änderungen\n\nNoch nichts.\n')).toEqual([]);
  });
});

describe('changelogSince', () => {
  const entries = parseChangelog(FIXTURE);

  it('takes everything above the version last seen', () => {
    expect(changelogSince(entries, '0.9.2', '0.11.0').map((e) => e.version)).toEqual([
      '0.11.0',
      '0.10.0',
    ]);
  });

  it('caps at the running build — a downgrade must not show notes it does not have', () => {
    expect(changelogSince(entries, '0.9.2', '0.10.0').map((e) => e.version)).toEqual(['0.10.0']);
  });

  it('is empty when nothing has moved', () => {
    expect(changelogSince(entries, '0.11.0', '0.11.0')).toEqual([]);
  });
});

describe('changelogAnnouncement', () => {
  it('says nothing on a first start, whatever the changelog holds', () => {
    // `null` is „no start has ever recorded a version" — a fresh install, and the state every
    // demo database and every `check:browser` run is in. The overlay must stay inert there.
    expect(changelogAnnouncement('0.11.0', null, FIXTURE)).toBeNull();
  });

  it('says nothing when the version has not moved, or has moved backwards', () => {
    expect(changelogAnnouncement('0.11.0', '0.11.0', FIXTURE)).toBeNull();
    expect(changelogAnnouncement('0.10.0', '0.11.0', FIXTURE)).toBeNull();
  });

  it('carries one entry without repeating its heading', () => {
    const a = changelogAnnouncement('0.11.0', '0.10.0', FIXTURE);
    expect(a?.title).toBe('Auftakt 0.11.0');
    expect(a?.version).toBe('0.11.0');
    expect(a?.id).toBe('version:0.11.0');
    // The card's own title already names the version.
    expect(a?.body).toBe('- **Etwas Neues** — und wofür es gut ist.');
  });

  it('heads each entry when several were skipped', () => {
    const a = changelogAnnouncement('0.11.0', '0.9.2', FIXTURE);
    expect(a?.body).toContain('### 0.11.0 — 1. September 2026');
    expect(a?.body).toContain('### 0.10.0 — 16. August 2026');
    expect(a?.body.indexOf('0.11.0')).toBeLessThan(a?.body.indexOf('0.10.0') ?? -1);
  });

  it('says nothing for a release whose changelog says nothing', () => {
    // A version bump with no entry — the file the older build shipped simply does not know it.
    expect(changelogAnnouncement('0.12.0', '0.11.0', FIXTURE)).toBeNull();
  });
});

describe('the real CHANGELOG.md', () => {
  it('is bundled and parses into entries', () => {
    // Guards the `?raw` import as much as the parse: if the file stopped reaching the bundle,
    // every „Was ist neu" card would silently be empty and nothing else would notice.
    const entries = parseChangelog(CHANGELOG_MD);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => /^\d+\.\d+\.\d+$/.test(e.version))).toBe(true);
    expect(entries.every((e) => e.body.trim() !== '')).toBe(true);
  });

  it('has an app version to compare against', () => {
    // `__APP_VERSION__` is replaced at build time from the root package.json (vite.config.ts).
    // An unreplaced constant would be a ReferenceError here rather than a mystery at runtime.
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
