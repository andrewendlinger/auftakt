/**
 * Dated announcements: which one is due today (WP-63).
 *
 * The whole of the date half of the announcement mechanism, and deliberately the *only* place
 * that knows what a `date` on an announcement means. The client has no date logic at all — it
 * asks `GET /api/announcements` and renders what comes back — which is what keeps the
 * naive-local convention (`shared/time.ts`, docs/ARCHITECTURE.md) in one place instead of
 * growing a second, subtly different calendar in the renderer.
 *
 * Pure by construction: nothing here opens a database, reads a file or imports `better-sqlite3`,
 * so `client/src/lib/announcement.test.ts` can drive it from the client Vitest suite the way
 * `backupDir.test.ts` reaches into `electron/`. `npm run check:unit` is the only automated run
 * this logic gets — the API check drives the *route*, not the calendar.
 */

import { localDay } from '../../../shared/time';

/**
 * One announcement, whatever triggered it.
 *
 * `id` is the dedupe key: it is what „schon gesehen" is recorded against, so changing it on a
 * payload that has already been confirmed shows it again.
 *
 * `date` is the trigger this module owns — `MM-DD` repeats every year, `YYYY-MM-DD` fires in its
 * own year and never again. `version` exists because the same shape carries the „Was ist neu"
 * card the client builds out of `CHANGELOG.md`; it is **never set on a stored announcement**, and
 * `parseOne` strips it if the file carries one. The repo's own release announcements come from the
 * changelog, not from an array somebody would have to keep in step with it — so on this side of
 * the boundary `version === undefined` is an invariant the client is entitled to rely on.
 *
 * `celebrate` hangs off the announcement, not off the trigger: a release may set it just as a
 * dated one may leave it off.
 */
export interface Announcement {
  id: string;
  title: string;
  /** Markdown, rendered through the client's existing `Markdown` component. */
  body: string;
  celebrate?: boolean;
  version?: string;
  /** `MM-DD` (yearly) or `YYYY-MM-DD` (once). */
  date?: string;
}

/**
 * How long after its day an announcement may still catch up.
 *
 * „On the day, or on the first start after it" needs a bound, and the bound is not cosmetic. The
 * latest occurrence of a yearly `MM-DD` is *always* in the past — eleven months in the past for
 * most of the year — so without one, an announcement installed at any point after its day would
 * fire on the day it was installed rather than on its own. That is the opposite of what a dated
 * announcement is for, and for the first payload this mechanism carries it would also be
 * irreversible: the greeting is meant to arrive once, unannounced, on its date.
 *
 * Two weeks covers the case the rule exists for — the app not opened on the day itself, over a
 * weekend or a short holiday — and nothing beyond it. Past that the occurrence is simply not due,
 * and the next year's is.
 */
export const CATCH_UP_DAYS = 14;

const YEARLY = /^(\d{2})-(\d{2})$/;
const ONCE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * What an announcement id may look like — an ASCII slug, and nothing else.
 *
 * The id is not decoration: „schon gesehen" is a map keyed by it, so it ends up as a **property
 * name written from a value that reached the server over HTTP**. `{ ['__proto__']: day }` does
 * not actually pollute a prototype and a day is a string either way, so this is not an
 * exploitable hole — but „the key of a write is remote input" is a shape that only stays safe by
 * accident, and one refactor of the map into a plain assignment would end that. A shape the
 * caller cannot leave is cheaper than an argument about which of the two spellings is safe.
 *
 * It is enforced *here*, in the parse, rather than at the write: `seasons.json` is hand-edited,
 * so an id nobody can use is the same kind of mistake as a missing title, and it should drop the
 * entry rather than produce an announcement that can never be dismissed.
 */
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

/** Is this a usable announcement id? The one definition — parse and write both ask it. */
export function isAnnouncementId(id: unknown): id is string {
  return typeof id === 'string' && ID.test(id);
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * Does `MM-DD` exist in *some* year? February takes 29 — see `occurrenceIn`.
 *
 * A real calendar and not a range check, because a range check does not fail safe here. `02-31`
 * is not simply „never matched": `Date.UTC(y, 1, 31)` rolls it forward to 3 March, so a typo'd
 * `02-31` used to fire on a day the payload never named — inside the catch-up window, and looking
 * for all the world like a working announcement on the wrong date. Same for `04-31`, `06-31`,
 * `09-31` and `11-31`. A hand-edited typo must produce **no** announcement, not one three days out.
 */
function validMonthDay(month: string, day: string): boolean {
  const m = Number(month);
  const d = Number(day);
  return m >= 1 && m <= 12 && d >= 1 && d <= (DAYS_IN_MONTH[m - 1] ?? 0);
}

/** Does this exact day exist in this exact year? The leap-aware half of the check above. */
function existsIn(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= (month === 2 && !isLeapYear(year) ? 28 : DAYS_IN_MONTH[month - 1]!);
}

/**
 * `MM-DD` in `year`, as a day that really exists.
 *
 * **`02-29` in a common year falls forward to 1 March**, and that is a decision rather than an
 * accident of arithmetic. A yearly date is meant to come round every year; refusing `02-29`
 * outright would mean a payload that fires in 2028 and 2032 and is silently absent in between,
 * which is not what „jährlich" promises. Falling forward is also the convention people use for a
 * 29 February anniversary. It is one line and it is spelled out here because the alternative —
 * letting `Date.UTC` normalise it downstream — is what made `02-31` fire on 3 March.
 *
 * `02-29` is the only input that can reach the second branch: every other `MM-DD` that exists in
 * one year exists in all of them, and `validMonthDay` has already dropped the ones that exist in
 * none.
 */
function occurrenceIn(year: number, monthDay: string): string {
  const month = Number(monthDay.slice(0, 2));
  const day = Number(monthDay.slice(3, 5));
  return existsIn(year, month, day) ? `${year}-${monthDay}` : `${year}-03-01`;
}

/**
 * Calendar days between two `YYYY-MM-DD` strings, `to` minus `from`.
 *
 * `Date.UTC` on the three components is arithmetic on a calendar, not a conversion of a moment:
 * both operands are already local days, and building them in UTC is what keeps a DST boundary
 * between them from turning 14 days into 13.96 and rounding the wrong way. It never produces a
 * stamp, so the „never build a stamp from `toISOString()`" rule is untouched.
 */
function daysBetween(from: string, to: string): number {
  const at = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((at(to) - at(from)) / 86_400_000);
}

/**
 * The most recent day this `date` fell on, at or before `today` — or `null` when there is none
 * and for anything malformed.
 *
 * A yearly `MM-DD` has one occurrence per year, so the answer is this year's if it has already
 * happened and last year's otherwise. A `YYYY-MM-DD` has exactly one ever, so it is the answer
 * once it has passed and `null` before.
 *
 * **The answer is always a day that exists.** Nothing downstream re-checks it, and a returned
 * `2027-02-31` would be handed to `Date.UTC` and quietly become 3 March.
 */
export function lastOccurrence(date: unknown, today: string): string | null {
  if (typeof date !== 'string' || !ONCE.test(today)) return null;

  const once = ONCE.exec(date);
  if (once) {
    // A one-off names one specific day in one specific year, so it can be checked exactly — and
    // if that day does not exist (`2027-02-29`, `2027-06-31`) it is a typo. A typo has to produce
    // nothing at all; producing something on a neighbouring day is the worse of the two failures.
    if (!existsIn(Number(once[1]), Number(once[2]), Number(once[3]))) return null;
    return date <= today ? date : null;
  }

  const yearly = YEARLY.exec(date);
  if (!yearly || !validMonthDay(yearly[1]!, yearly[2]!)) return null;
  const year = Number(today.slice(0, 4));
  // String compare, not Date compare: both sides are fixed-width `YYYY-MM-DD`, where
  // lexicographic order *is* chronological order. That is the property the whole convention buys.
  // Compared on the raw `MM-DD` and resolved afterwards: the only date where the two spellings
  // differ is `02-29`, and `YYYY-02-29` sorts exactly where 29 February would if it existed.
  return `${year}-${date}` <= today ? occurrenceIn(year, date) : occurrenceIn(year - 1, date);
}

/**
 * One stored entry, or `null` when it is not shaped like an announcement.
 *
 * **A stored announcement never comes back carrying `version`, whatever the file says.** That
 * field marks the card the client builds out of `CHANGELOG.md`, and every branch downstream reads
 * it as „this is release notes": the tone, the sign-off suppression, and — the one that bites —
 * which marker gets written on confirm (`{ version }` rather than `{ id }`). A hand-edited entry
 * carrying both `date` and `version` therefore fired on its date, presented itself as „Was ist
 * neu", and on confirm wrote its `version` string into the version marker instead of stamping its
 * id: the card came back on every start for the whole catch-up window, and the marker now held a
 * version nothing would ever be newer than. Dropping the field here is what makes „stored ⇒ dated"
 * true by construction rather than by everyone downstream remembering it.
 */
function parseOne(raw: unknown): Announcement | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const title = typeof r.title === 'string' ? r.title.trim() : '';
  const body = typeof r.body === 'string' ? r.body : '';
  if (!isAnnouncementId(id) || !title || !body) return null;
  return {
    id,
    title,
    body,
    ...(r.celebrate === true ? { celebrate: true } : {}),
    ...(typeof r.date === 'string' && r.date ? { date: r.date } : {}),
  };
}

/**
 * The stored array, cleaned.
 *
 * `seasons.json` is hand-edited by design — there is no UI that writes announcements — so a
 * missing key, a typo'd shape or a value of the wrong type is the *expected* input, not an
 * exceptional one. Anything unusable drops out silently and the rest still works; nothing here
 * throws, because a throw would take a route down over a file the user is allowed to get wrong.
 * The first entry wins a duplicated id, so „schon gesehen" cannot be recorded against two rows.
 */
export function parseAnnouncements(raw: unknown): Announcement[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Announcement[] = [];
  for (const entry of raw) {
    const parsed = parseOne(entry);
    if (!parsed || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    out.push(parsed);
  }
  return out;
}

/**
 * Is this announcement due?
 *
 * Its latest occurrence has to have happened, to be recent enough to still be catching up, and
 * to be newer than the day this id was last confirmed. The last of those three is what makes a
 * yearly `MM-DD` repeat correctly: a confirmation stamped in one year is older than the *next*
 * year's occurrence and older than nothing else, so next year's shows and this year's does not.
 * Confirming late is covered by the same comparison — a day *after* the occurrence is not older
 * than it.
 */
export function isDue(a: Announcement, seen: Record<string, string>, today: string): boolean {
  const occurrence = lastOccurrence(a.date, today);
  if (occurrence === null) return false;
  if (daysBetween(occurrence, today) > CATCH_UP_DAYS) return false;
  const confirmed = seen[a.id];
  return typeof confirmed !== 'string' || confirmed < occurrence;
}

/** Every stored announcement due today, in stored order. `today` is injectable for the tests. */
export function dueAnnouncements(
  raw: unknown,
  seen: Record<string, string>,
  today: string = localDay(),
): Announcement[] {
  return parseAnnouncements(raw).filter((a) => isDue(a, seen, today));
}
