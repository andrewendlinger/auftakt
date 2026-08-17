import { describe, expect, it } from 'vitest';
import { announcementQueue, announcementTone, splitSignoff } from './announcement';
import {
  CATCH_UP_DAYS,
  dueAnnouncements,
  isDue,
  lastOccurrence,
  parseAnnouncements,
  type Announcement,
} from '../../../server/src/lib/announcements';

/**
 * The announcement mechanism's pure halves (WP-63): the date matcher, which lives on the server,
 * and the presentation rules, which live here.
 *
 * The matcher is reached across the tier boundary for the same reason `backupDir.test.ts` reaches
 * into `electron/`: Vitest is installed in `client/` only, the module imports nothing but
 * `shared/time`, and the four `check:*` scripts drive the *route* rather than the calendar. Every
 * property below is invisible to `npm run typecheck` and to `check:api` alike — an off-by-one
 * year in `lastOccurrence` would simply mean an announcement that never arrives, with nothing
 * anywhere to say so.
 *
 * Fixtures are deliberately neutral. Nothing here names a real person or a real date.
 */

const testfest: Announcement = {
  id: 'testfest',
  title: 'Testfest',
  body: 'Eine Zeile.\n\nGrüße',
  date: '03-14',
  celebrate: true,
};

describe('lastOccurrence', () => {
  it('takes this year for a yearly date that has already passed', () => {
    expect(lastOccurrence('03-14', '2027-03-14')).toBe('2027-03-14');
    expect(lastOccurrence('03-14', '2027-12-31')).toBe('2027-03-14');
  });

  it('takes last year for a yearly date still ahead', () => {
    expect(lastOccurrence('03-14', '2027-03-13')).toBe('2026-03-14');
    expect(lastOccurrence('03-14', '2027-01-01')).toBe('2026-03-14');
  });

  it('answers a one-off date only once it has passed', () => {
    expect(lastOccurrence('2027-03-14', '2027-03-14')).toBe('2027-03-14');
    expect(lastOccurrence('2027-03-14', '2028-06-01')).toBe('2027-03-14');
    expect(lastOccurrence('2027-03-14', '2027-03-13')).toBeNull();
  });

  it('answers null for anything malformed or missing', () => {
    for (const bad of [undefined, null, 42, '', '3-14', '2027-3-14', '13-01', '01-32', 'morgen']) {
      expect(lastOccurrence(bad, '2027-03-14')).toBeNull();
    }
  });
});

describe('isDue', () => {
  it('fires on the day itself', () => {
    expect(isDue(testfest, {}, '2027-03-14')).toBe(true);
  });

  it('still fires on the first start after a missed day', () => {
    // The whole reason the rule is „the day, or the first open after it": the app is not
    // necessarily opened on the day, and a greeting nobody was there for is no greeting.
    expect(isDue(testfest, {}, '2027-03-16')).toBe(true);
  });

  it('stops catching up once the day is well past', () => {
    // The two days below are 2027-03-14 plus exactly CATCH_UP_DAYS and one more, written out so
    // the fixture and the constant cannot drift apart silently.
    expect(CATCH_UP_DAYS).toBe(14);
    expect(isDue(testfest, {}, '2027-03-28')).toBe(true);
    // Without this bound the *latest* occurrence of a yearly date is always in the past, so a
    // payload installed at any point in the year would fire on the day it was installed rather
    // than on its own — the opposite of what a dated announcement is for.
    expect(isDue(testfest, {}, '2027-03-29')).toBe(false);
    expect(isDue(testfest, {}, '2027-08-01')).toBe(false);
  });

  it('does not fire twice on the same occurrence', () => {
    expect(isDue(testfest, { testfest: '2027-03-14' }, '2027-03-14')).toBe(false);
    // Confirmed a day late, on the catch-up open: the stored day is *after* the occurrence, so
    // the comparison has to be „older than", not „different from".
    expect(isDue(testfest, { testfest: '2027-03-16' }, '2027-03-17')).toBe(false);
  });

  it('repeats a yearly date the next year', () => {
    expect(isDue(testfest, { testfest: '2027-03-14' }, '2028-03-14')).toBe(true);
  });

  it('fires a one-off date in its own year and never again', () => {
    const once: Announcement = { ...testfest, date: '2027-03-14' };
    expect(isDue(once, {}, '2027-03-14')).toBe(true);
    expect(isDue(once, { testfest: '2027-03-14' }, '2028-03-14')).toBe(false);
    expect(isDue(once, {}, '2028-03-14')).toBe(false);
  });

  it('never fires without a usable date', () => {
    expect(isDue({ id: 'x', title: 'T', body: 'B' }, {}, '2027-03-14')).toBe(false);
    expect(isDue({ id: 'x', title: 'T', body: 'B', date: 'bald' }, {}, '2027-03-14')).toBe(false);
    // A `version` on a *stored* announcement triggers nothing: release notes come from
    // CHANGELOG.md, not from an array somebody would have to keep in step with it.
    expect(isDue({ id: 'x', title: 'T', body: 'B', version: '9.9.9' }, {}, '2027-03-14')).toBe(false);
  });
});

describe('parseAnnouncements', () => {
  it('answers an empty list for anything that is not an array', () => {
    // `seasons.json` is hand-edited by design, so a missing or mistyped key is ordinary input.
    for (const bad of [undefined, null, {}, 'nope', 7]) expect(parseAnnouncements(bad)).toEqual([]);
  });

  it('drops entries missing an id, a title or a body', () => {
    const raw = [
      { title: 'Ohne id', body: 'x' },
      { id: 'ohne-titel', body: 'x' },
      { id: 'ohne-text', title: 'T' },
      { id: ' ', title: 'T', body: 'x' },
      testfest,
    ];
    expect(parseAnnouncements(raw).map((a) => a.id)).toEqual(['testfest']);
  });

  it('keeps the first of two entries sharing an id', () => {
    const raw = [testfest, { ...testfest, title: 'Zweites' }];
    expect(parseAnnouncements(raw)).toHaveLength(1);
    expect(parseAnnouncements(raw)[0]?.title).toBe('Testfest');
  });

  it('drops a celebrate that is not literally true', () => {
    expect(parseAnnouncements([{ ...testfest, celebrate: 'ja' }])[0]?.celebrate).toBeUndefined();
  });
});

describe('dueAnnouncements', () => {
  it('is empty when nothing is stored — the state of every installation without a payload', () => {
    expect(dueAnnouncements(undefined, {}, '2027-03-14')).toEqual([]);
    expect(dueAnnouncements([], {}, '2027-03-14')).toEqual([]);
  });

  it('returns the due ones in stored order', () => {
    const other: Announcement = { id: 'zweites', title: 'Zweites', body: 'x', date: '03-14' };
    const list = dueAnnouncements([testfest, other], { testfest: '2027-03-14' }, '2027-03-14');
    expect(list.map((a) => a.id)).toEqual(['zweites']);
  });
});

describe('splitSignoff', () => {
  it('sets the last paragraph of a dated announcement apart', () => {
    expect(splitSignoff(testfest)).toEqual({ lead: 'Eine Zeile.', signoff: 'Grüße' });
  });

  it('leaves a single paragraph whole', () => {
    expect(splitSignoff({ ...testfest, body: 'Nur ein Satz.' })).toEqual({
      lead: 'Nur ein Satz.',
      signoff: null,
    });
  });

  it('never touches a changelog body', () => {
    // A release entry ends in a bullet or in „_Außerdem:_ …", and a stray gold line under every
    // set of release notes is exactly what the `version` test prevents.
    const release: Announcement = {
      id: 'version:1.0.0',
      version: '1.0.0',
      title: 'Auftakt 1.0.0',
      body: '- Erster Punkt\n\n_Außerdem:_ Kleinigkeiten.',
    };
    expect(splitSignoff(release).signoff).toBeNull();
    expect(splitSignoff(release).lead).toContain('Außerdem');
  });

  it('keeps single newlines inside a paragraph — Markdown renders them as <br>', () => {
    const a: Announcement = { ...testfest, body: 'Zeile eins\nZeile zwei\n\nGrüße' };
    expect(splitSignoff(a).lead).toBe('Zeile eins\nZeile zwei');
  });
});

describe('announcementTone', () => {
  it('gives a release card the eyebrow and a dated one the centred message', () => {
    expect(announcementTone({ id: 'v', title: 'T', body: 'B', version: '1.0.0' })).toEqual({
      eyebrow: 'Was ist neu',
      centered: false,
      confirm: 'Alles klar',
    });
    expect(announcementTone(testfest)).toEqual({
      eyebrow: null,
      centered: true,
      confirm: 'Danke!',
    });
  });
});

describe('announcementQueue', () => {
  const CHANGELOG = '# Änderungen\n\n## 1.1.0 — heute\n\n- Etwas Neues.\n';

  it('is empty before the feed has arrived — the overlay renders null', () => {
    expect(announcementQueue(undefined, '1.1.0', new Set(), CHANGELOG)).toEqual([]);
  });

  it('is empty on a first start, even with a changelog to show', () => {
    expect(announcementQueue({ version: null, dated: [] }, '1.1.0', new Set(), CHANGELOG)).toEqual([]);
  });

  it('puts a dated announcement ahead of the release notes', () => {
    // A dated card stops being right when its day is over; release notes are as true tomorrow.
    const queue = announcementQueue(
      { version: '1.0.0', dated: [testfest] },
      '1.1.0',
      new Set(),
      CHANGELOG,
    );
    expect(queue.map((a) => a.id)).toEqual(['testfest', 'version:1.1.0']);
  });

  it('drops what this window has already confirmed', () => {
    const queue = announcementQueue(
      { version: '1.0.0', dated: [testfest] },
      '1.1.0',
      new Set(['testfest']),
      CHANGELOG,
    );
    expect(queue.map((a) => a.id)).toEqual(['version:1.1.0']);
  });
});
