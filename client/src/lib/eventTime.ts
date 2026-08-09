/**
 * The event dialog's four date/time boxes ⇄ the three stored columns.
 *
 * `EventEditor` used to hold one `<input type={allDay ? 'date' : 'datetime-local'}>` per end of
 * the event plus two checkboxes („Mit Uhrzeit", „Datum offen"), and the mode lived in those
 * checkboxes. It now holds a date and a time input per end, and the mode is *derived* from what
 * is in them — which is why this file exists: the derivation is the only new logic in WP-40, it
 * is pure string arithmetic, and unlike the component itself `check:unit` can reach it.
 *
 * The stored form is unchanged and must stay that way (`dates.ts`):
 *   start_at  NULL | "YYYY-MM-DD" | "YYYY-MM-DDTHH:mm"
 *   end_at    same
 *   all_day   1 for the date-only form, 0 for the timed one
 * `EventList`, `Dashboard`, `PrintSheet`, `GlobalSearch` and `formatEventWhen` all read it; this
 * package changed the form, not the data.
 *
 * No `Date` is constructed anywhere here, deliberately. Every value is a naive local string and
 * comparing/slicing them as strings is exactly right — a `Date` round-trip is how the convention
 * gets broken (see the header of `dates.ts` and `scripts/check-dates.mjs`).
 */

/** The four boxes, each `''` when empty. */
export interface EventFields {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

/** The three stored columns. */
export interface EventWhen {
  start_at: string | null;
  end_at: string | null;
  all_day: 0 | 1;
}

interface StoredWhen {
  start_at?: string | null;
  end_at?: string | null;
}

/** `"YYYY-MM-DD"` / `"YYYY-MM-DDTHH:mm"` → `[date, time]`; anything falsy → two empty strings. */
function split(stored: string | null | undefined): [string, string] {
  if (!stored) return ['', ''];
  return [stored.slice(0, 10), stored.slice(11, 16)];
}

/**
 * Stored form → the four boxes.
 *
 * The stored *length* is the authority, not `all_day`: a 10-character `start_at` has no clock
 * time, so its time box stays empty rather than being widened to an invented 09:00 the way the
 * old `withTime` did. A row whose `all_day` disagrees with its length (only reachable through a
 * direct API write) is read by its length and repaired on the next save.
 */
export function fieldsFromEvent(ev: StoredWhen | null | undefined): EventFields {
  const [startDate, startTime] = split(ev?.start_at);
  const [endDate, endTime] = split(ev?.end_at);
  return { startDate, startTime, endDate, endTime };
}

/**
 * The four boxes → the stored form. The rules, in the order they are applied:
 *
 *   no start date          → „Datum offen": everything NULL. A time typed without a date is
 *                            dropped, and `all_day` stays 1 so the dropped time cannot leak
 *                            into the flag. (`all_day` and a NULL `start_at` are orthogonal;
 *                            nothing reads the flag in that state.)
 *   no start time          → all-day, `start_at` ten characters.
 *   start time             → timed, `start_at` sixteen characters.
 *   end time, no end date  → the end inherits the start's date. This is 19:30–21:15 on the same
 *                            evening, which otherwise costs a second date entry for one event.
 *   no end at all          → `end_at` NULL. „timed, open end" is a shape `formatEventWhen`
 *                            already renders.
 *
 * The end always takes the same shape as the start, so a mixed pair (16-character start with a
 * 10-character end, which `formatEventWhen` would render as „19:30–00:00") cannot be produced.
 * `eventTimeProblem` blocks the input that would ask for one.
 */
export function whenFromFields(f: EventFields): EventWhen {
  if (!f.startDate) return { start_at: null, end_at: null, all_day: 1 };

  const allDay = !f.startTime;
  const start_at = allDay ? f.startDate : `${f.startDate}T${f.startTime}`;

  const endDate = f.endDate || (f.endTime ? f.startDate : '');
  const end_at = !endDate ? null : allDay ? endDate : `${endDate}T${f.endTime}`;

  return { start_at, end_at, all_day: allDay ? 1 : 0 };
}

/**
 * The blocking reason not to save, or null — the same role `missingTitle` plays for the title,
 * and shown through the same footer hint plus disabled „Speichern" (RTE-10).
 *
 * Only two things are refused, both of them states the old dialog could not express at all:
 *
 *  - **One clock time without the other.** The stored form offers `end_at` as NULL or sixteen
 *    characters and nothing in between, so an end date without an end time would have to either
 *    invent a time or silently discard the date the user just typed. Asking is better than both.
 *  - **An end before its start.** Separate date and time boxes plus the inherited end date make
 *    this much easier to produce than the old single control did, and every reader — the list,
 *    the dashboard, the print sheets — would render the nonsense faithfully.
 *
 * An end *equal* to its start is allowed: a zero-length appointment is a legitimate marker.
 */
export function eventTimeProblem(f: EventFields): string | null {
  if (!f.startDate) return null; // „Datum offen" — nothing else is stored, so nothing can clash.

  const hasEnd = !!(f.endDate || f.endTime);
  if (hasEnd && !f.startTime !== !f.endTime) {
    return 'Beginn und Ende brauchen beide eine Uhrzeit — oder beide keine.';
  }

  const { start_at, end_at } = whenFromFields(f);
  // Both are the same shape here, and that shape sorts chronologically as plain text.
  if (start_at && end_at && end_at < start_at) return 'Das Ende liegt vor dem Beginn.';

  return null;
}
