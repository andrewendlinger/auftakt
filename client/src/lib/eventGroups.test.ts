import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EVENT_WINDOW_DAYS, groupUpcomingEvents } from './eventGroups';
import { todayUtcMs, type EventLike } from './dates';

/**
 * A wrong block here is not a layout nit: an event the user typed in is missing from the page they
 * open every morning. That is the bug WP-33 exists to fix — the dashboard used to render „Danach"
 * only when the near list was empty, and dateless events not at all.
 *
 * Everything pins the clock, for the reason `taskStats.test.ts` states: `daysUntil` and
 * `todayUtcMs` read the real one, so an unpinned test passes today and fails on a date boundary
 * for reasons that have nothing to do with the code.
 */

const TODAY = '2026-08-06';
/** Local noon, so the pinned instant is the same calendar day in every timezone CI runs in. */
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 6, 12, 0, 0));
});
afterEach(() => vi.useRealTimers());

const ev = (title: string, start_at: string | null, end_at: string | null = null): EventLike &
  { title: string } => ({ title, start_at, end_at });
const titles = (rows: Array<{ title: string }>) => rows.map((r) => r.title);

describe('groupUpcomingEvents', () => {
  it('puts dateless events in their own block, wherever they sit in the input', () => {
    const g = groupUpcomingEvents(
      [ev('a', TODAY), ev('offen', null), ev('b', '2026-12-01')],
      DEFAULT_EVENT_WINDOW_DAYS,
    );
    expect(titles(g.undated)).toEqual(['offen']);
    expect(titles(g.within)).toEqual(['a']);
    expect(titles(g.beyond)).toEqual(['b']);
  });

  // The edge that decides which block a row renders in. Off by one and an event moves under a
  // heading that contradicts its date.
  it('includes today and the last day of the window, excludes the day after', () => {
    const g = groupUpcomingEvents(
      [ev('heute', TODAY), ev('rand', '2026-08-20'), ev('danach', '2026-08-21')],
      14,
    );
    expect(titles(g.within)).toEqual(['heute', 'rand']);
    expect(titles(g.beyond)).toEqual(['danach']);
  });

  // The case a `daysUntil >= 0` guard would silently delete.
  it('keeps a multi-day event that is running across today, in the near block', () => {
    const g = groupUpcomingEvents([ev('aufbau', '2026-08-05', '2026-08-09')], 14);
    expect(titles(g.within)).toEqual(['aufbau']);
    expect(g.beyond).toHaveLength(0);
  });

  it('never drops a row — even one the server would not have sent', () => {
    const g = groupUpcomingEvents([ev('vorbei', '2020-01-01')], 14);
    expect(titles(g.within)).toEqual(['vorbei']);
  });

  it('reads the window from its argument, not from the default', () => {
    const rows = [ev('a', '2026-08-08'), ev('b', '2027-06-02')];
    expect(titles(groupUpcomingEvents(rows, 1).beyond)).toEqual(['a', 'b']);
    expect(titles(groupUpcomingEvents(rows, 365).within)).toEqual(['a', 'b']);
  });

  // Proves the module does not sort: what the server ordered is what the page shows.
  it('preserves input order inside every block', () => {
    const g = groupUpcomingEvents(
      [ev('o1', null), ev('n2', '2026-08-10'), ev('o2', null), ev('n1', '2026-08-07'), ev('f', '2027-01-01')],
      14,
    );
    expect(titles(g.undated)).toEqual(['o1', 'o2']);
    expect(titles(g.within)).toEqual(['n2', 'n1']);
    expect(titles(g.beyond)).toEqual(['f']);
  });

  it('answers an empty list with three empty blocks', () => {
    expect(groupUpcomingEvents([], 14)).toEqual({ undated: [], within: [], beyond: [] });
  });

  // One clock for the whole pass: moving it moves every boundary by the same day.
  it('measures every row against the given fromUtcMs', () => {
    const tomorrow = todayUtcMs() + 86400000;
    const rows = [ev('rand', '2026-08-20'), ev('danach', '2026-08-21')];
    expect(titles(groupUpcomingEvents(rows, 14, tomorrow).within)).toEqual(['rand', 'danach']);
  });

  it('buckets a timed event by its calendar day, not by its clock time', () => {
    const g = groupUpcomingEvents([ev('spaet', '2026-08-20T23:00', '2026-08-21T01:00')], 14);
    expect(titles(g.within)).toEqual(['spaet']);
  });
});
