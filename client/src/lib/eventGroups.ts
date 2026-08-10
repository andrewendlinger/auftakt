/**
 * How the dashboard cuts its event list into the three blocks it renders: „Datum offen", the
 * near window, and „Danach".
 *
 * **This module only partitions.** It never drops a row and never re-sorts one. The server decides
 * what is past (`upcomingEvents`, server/src/lib/queries.ts) and its `ORDER BY e.start_at ASC,
 * e.id ASC` decides the order — dateless first, then chronological. Everything here is a cut
 * through that already-correct sequence, which is why the blocks read in the same order as the
 * „Termine" list on the artist and project pages.
 *
 * It lives in `lib/` rather than in `Dashboard.tsx` so `npm run check:unit` can reach it: the page
 * has no coverage at all (issue #7), and putting an event in the wrong block means an event the
 * user entered is missing from the screen they check every morning — the exact complaint WP-33
 * exists to answer.
 */
import { daysUntil, todayUtcMs, type EventLike } from './dates';

/**
 * How far „Nächste Termine" looks ahead before „Danach" begins, when `event_window_days` is unset.
 * The number the section heading used to state; it is a divider now, not a filter — nothing is
 * hidden on either side of it.
 */
export const DEFAULT_EVENT_WINDOW_DAYS = 14;

export interface UpcomingGroups<T> {
  /** No `start_at` — „Datum offen". Window-independent, and rendered above the chronology. */
  undated: T[];
  /** Starts within the window, or started before it and is still running. */
  within: T[];
  /** Starts after the window. */
  beyond: T[];
}

/**
 * Split the dashboard's event list into its three blocks. Input order is preserved inside each.
 *
 * „Within" is „starts no later than today + `windowDays`" — a *running* multi-day event has a
 * negative `daysUntil` and therefore lands there, which is what it should do and needs no special
 * case. Note what is deliberately absent: a `daysUntil >= 0` guard. It looks like the obvious
 * companion to the upper bound and would delete every running event, which is precisely why the
 * server query tests `COALESCE(end_at, start_at)` instead of `start_at`. `beyond` can never hold
 * a running event — its start is strictly in the future.
 *
 * `fromUtcMs` is resolved once and threaded through every comparison (CCL-31): a clock read per row
 * can straddle midnight and put two rows on opposite sides of one boundary. Passing it explicitly
 * is also how the tests pin the day.
 */
export function groupUpcomingEvents<T extends EventLike>(
  events: T[],
  windowDays: number,
  fromUtcMs: number = todayUtcMs(),
): UpcomingGroups<T> {
  const groups: UpcomingGroups<T> = { undated: [], within: [], beyond: [] };
  for (const ev of events) {
    if (!ev.start_at) {
      groups.undated.push(ev);
      continue;
    }
    const d = daysUntil(ev.start_at, fromUtcMs);
    // An unparseable date is not a reason to hide a row; it reads as „now" and stays visible.
    if (d != null && d > windowDays) groups.beyond.push(ev);
    else groups.within.push(ev);
  }
  return groups;
}
