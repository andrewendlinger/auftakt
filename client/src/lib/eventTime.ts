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
 *   all_day   1 for the date-only form, 0 for the timed one and for a row with no date at all
 * `EventList`, `Dashboard`, `PrintSheet`, `GlobalSearch` and `formatEventWhen` all read it; this
 * package changed the form, not the data.
 *
 * These functions describe what the *boxes* mean, which is not everything the table can hold: a
 * CSV import can leave seconds on a timestamp, and `seed.ts` derives `all_day` from the start
 * cell alone, so an imported start and end can disagree about carrying a clock time. A row whose
 * boxes were never touched is therefore written back verbatim rather than derived over, which is
 * `untouchedWhen`'s job below.
 *
 * No `Date` is constructed anywhere here, deliberately — `nextDay` included. Every value is a
 * naive local string and comparing/slicing them as strings is exactly right; a `Date` round-trip
 * is how the convention gets broken (see the header of `dates.ts` and `scripts/check-dates.mjs`).
 */

import type { EventLike } from './dates';

/** The four boxes, each `''` when empty. */
export interface EventFields {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

const FIELD_KEYS = ['startDate', 'startTime', 'endDate', 'endTime'] as const;

/**
 * The three stored columns, narrowed to what this module writes.
 *
 * `extends EventLike` is the compiler-checked half of „the summary cannot describe something
 * other than what gets stored": `EventEditor` renders the very object it is about to send
 * through `formatEventWhen`, and that only stays true while the payload is one of these.
 */
export interface EventWhen extends EventLike {
  start_at: string | null;
  end_at: string | null;
  all_day: 0 | 1;
}

/** `"YYYY-MM-DD"` / `"YYYY-MM-DDTHH:mm"` → `[date, time]`; anything falsy → two empty strings. */
function split(stored: string | null | undefined): [string, string] {
  if (!stored) return ['', ''];
  return [stored.slice(0, 10), stored.slice(11, 16)];
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * `"YYYY-MM-DD"` + one calendar day.
 *
 * Integer arithmetic on the three components, not `new Date(...).setDate(+1)`: this file's whole
 * premise is that a naive local date never becomes a `Date`, and a calendar day is small enough
 * to add by hand. Only reached for the inherited end date below, where the input is a date the
 * browser's own picker produced.
 */
function nextDay(date: string): string {
  let y = Number(date.slice(0, 4));
  let mo = Number(date.slice(5, 7));
  let d = Number(date.slice(8, 10)) + 1;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const last = mo === 2 && leap ? 29 : (DAYS_IN_MONTH[mo - 1] ?? 31);
  if (d > last) {
    d = 1;
    mo += 1;
  }
  if (mo > 12) {
    mo = 1;
    y += 1;
  }
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/**
 * Stored form → the four boxes.
 *
 * The stored *length* is the authority, not `all_day`: a 10-character `start_at` has no clock
 * time, so its time box stays empty rather than being widened to an invented 09:00 the way the
 * old `withTime` did. A row whose `all_day` disagrees with its length (only reachable through a
 * direct API write) is read by its length and repaired on the next save.
 */
export function fieldsFromEvent(ev: EventLike | null | undefined): EventFields {
  const [startDate, startTime] = split(ev?.start_at);
  const [endDate, endTime] = split(ev?.end_at);
  return { startDate, startTime, endDate, endTime };
}

/** True once any of the four boxes differs from the ones it is compared against. */
export function fieldsTouched(f: EventFields, baseline: EventFields): boolean {
  return FIELD_KEYS.some((k) => f[k] !== baseline[k]);
}

/**
 * The stored columns of a row whose four boxes were never touched — written back exactly as they
 * were read — or null when the boxes decide, which is every new event and every edited one.
 *
 * The boxes cannot express everything the table holds: the CSV importer leaves the seconds on
 * `2026-09-04T19:30:45` and derives `all_day` from the start cell alone, so an imported start and
 * end can disagree about carrying a clock time, and `all_day` is unconstrained on a row with no
 * date at all. Deriving over such a row rewrites data the user never touched — and refusing it
 * (`eventTimeProblem`) would lock them out of the title and the notes too, for a shape they did
 * not create and cannot see. Nothing read back unchanged can be wrong, so there is also nothing
 * left to refuse: a non-null answer here is both the payload *and* „skip the checks".
 *
 * The baseline is derived from the same row the values come from, for the reason `EventEditor`'s
 * `initial` exists (TTU-17): a comparison and a value read from two sources drift apart.
 */
export function untouchedWhen(
  ev: EventLike | null | undefined,
  f: EventFields,
): EventWhen | null {
  if (!ev || fieldsTouched(f, fieldsFromEvent(ev))) return null;
  return { start_at: ev.start_at, end_at: ev.end_at ?? null, all_day: ev.all_day ? 1 : 0 };
}

/**
 * The four boxes with „Beginn — Datum" set to `startDate`, carrying an end date the *dialog*
 * derived rather than the user typed.
 *
 * Moving the start used to leave the end where it was, which the create path never produces: a
 * 23:00–01:00 evening is stored with the next day in `end_at`, so reopening that event and moving
 * it one day forward left an end before its start — „Speichern" then refused, over an end box the
 * user had not touched, a shape it had accepted a minute earlier when the box was still empty.
 *
 * Only the two spans this dialog derives follow the start: an end on the start's own day, and one
 * rolled over midnight. A range dated by hand on both ends (10.09.–12.09.) is the user's, so it
 * stays put — moving its start past its end is the ordinary „Ende liegt vor dem Beginn" refusal,
 * with both dates on screen to correct.
 */
export function withStartDate(f: EventFields, startDate: string): EventFields {
  if (!startDate || !f.startDate || !f.endDate) return { ...f, startDate };
  if (f.endDate === f.startDate) return { ...f, startDate, endDate: startDate };
  if (f.endDate === nextDay(f.startDate)) return { ...f, startDate, endDate: nextDay(startDate) };
  return { ...f, startDate };
}

/**
 * The four boxes → the stored form. The rules, in the order they are applied:
 *
 *   no start date          → „Datum offen": everything NULL. Nothing else can be stored without
 *                            it, which is why `eventTimeProblem` refuses to save the other boxes
 *                            with something in them rather than dropping it here.
 *   no start time          → all-day, `start_at` ten characters.
 *   start time             → timed, `start_at` sixteen characters.
 *   end time, no end date  → the end inherits the start's date — the *next* day when the end is
 *                            earlier in the clock than the start, because 23:00–01:00 is one
 *                            evening and not an end before its beginning. This is the common
 *                            case (19:30–21:15) and otherwise costs a second date entry.
 *   no end at all          → `end_at` NULL. „timed, open end" is a shape `formatEventWhen`
 *                            already renders.
 *
 * Each end takes the shape of its own boxes, so a value is always NULL, ten characters or
 * sixteen — never the eleven-character stub a missing end time used to produce. A *mixed* pair
 * (16-character start, 10-character end) is well-formed but means „19:30–00:00" to
 * `formatEventWhen`, so `eventTimeProblem` refuses to let one be typed; the only mixed pairs in
 * the table came from the CSV importer, and `untouchedWhen` writes those back as they were.
 *
 * `all_day` is derived from the start alone, as everywhere else in the app.
 */
export function whenFromFields(f: EventFields): EventWhen {
  // `all_day` is unconstrained with no date — nothing reads the flag while `start_at` is NULL —
  // so it takes the 0 that `demo.ts` and the CSV importer already write for a date-less row.
  // A 1 here would fork every such row on the first save that touched anything else.
  if (!f.startDate) return { start_at: null, end_at: null, all_day: 0 };

  const start_at = f.startTime ? `${f.startDate}T${f.startTime}` : f.startDate;

  const inherited = f.endTime && f.endTime < f.startTime ? nextDay(f.startDate) : f.startDate;
  const endDate = f.endDate || (f.endTime ? inherited : '');
  const end_at = !endDate ? null : f.endTime ? `${endDate}T${f.endTime}` : endDate;

  return { start_at, end_at, all_day: f.startTime ? 0 : 1 };
}

/**
 * The blocking reason not to save, or null — the same role `missingTitle` plays for the title,
 * and shown through the same footer hint plus disabled „Speichern" (RTE-10).
 *
 * Three things are refused, all of them states the old dialog could not express at all. Each one
 * is input that would otherwise be *thrown away* on save with the boxes still showing it:
 *
 *  - **Anything without a start date.** „Datum offen" stores NULL and nothing else, so an end —
 *    or a start time — typed next to an empty start date does not survive Speichern.
 *  - **One clock time without the other.** The stored form offers `end_at` as NULL or sixteen
 *    characters and nothing in between, so an end date without an end time would have to either
 *    invent a time or silently discard the date the user just typed. Asking is better than both.
 *  - **An end before its start.** Separate date and time boxes make this much easier to produce
 *    than the old single control did, and every reader — the list, the dashboard, the print
 *    sheets — would render the nonsense faithfully. An end time that is merely earlier in the
 *    *clock* than the start is not this case: it rolls over midnight, see `whenFromFields`.
 *
 * An end *equal* to its start is allowed: a zero-length appointment is a legitimate marker.
 *
 * Only ever ask this about boxes the user has touched. Data that was merely *read* can hold
 * shapes the boxes cannot express, and refusing those locks the user out of the title and the
 * notes as well — ask `untouchedWhen` first and skip this entirely when it answers.
 */
export function eventTimeProblem(f: EventFields): string | null {
  if (!f.startDate) {
    // Both name the way out. „Datum offen" is no longer a checkbox that leaves the other boxes
    // filled — it is the *empty* boxes — so a user who cleared the start date to say it was
    // otherwise told only that an untouched end box was in the way (WP-40).
    if (f.endDate || f.endTime) {
      return 'Ein Ende ohne Beginn kann nicht gespeichert werden — Beginn setzen oder „Datum offen" wählen.';
    }
    if (f.startTime) {
      return 'Eine Uhrzeit ohne Datum kann nicht gespeichert werden — Datum setzen oder „Datum offen" wählen.';
    }
    return null; // „Datum offen" — nothing is stored, so nothing can clash.
  }

  const hasEnd = !!(f.endDate || f.endTime);
  if (hasEnd && !f.startTime !== !f.endTime) {
    return 'Beginn und Ende brauchen beide eine Uhrzeit — oder beide keine.';
  }

  const { start_at, end_at } = whenFromFields(f);
  // Both are the same shape here, and that shape sorts chronologically as plain text.
  if (start_at && end_at && end_at < start_at) return 'Das Ende liegt vor dem Beginn.';

  return null;
}
