import { describe, expect, it } from 'vitest';
import { eventTimeProblem, fieldsFromEvent, whenFromFields, type EventFields } from './eventTime';
import { formatEventWhen } from './dates';

/**
 * WP-40 replaced the event dialog's two checkboxes with four date/time boxes, so the event's mode
 * is now derived rather than toggled. That derivation is the whole risk of the package: every
 * reader of `events` — the list, the dashboard, both print sheets, the global search — expects
 * `start_at`/`end_at` as NULL, ten characters or sixteen, and none of them were touched.
 *
 * `EventEditor` itself has no test (no browser-level coverage exists yet, issue #7), which is
 * precisely why the derivation lives in a module of its own instead of inside the component.
 *
 * Nothing here constructs a `Date`. That is the point — these are naive local strings and the
 * timezone gate (`check:dates`) never needs to see this code.
 */

const F = (
  startDate: string,
  startTime = '',
  endDate = '',
  endTime = '',
): EventFields => ({ startDate, startTime, endDate, endTime });

describe('fieldsFromEvent', () => {
  it('splits a timed event into date and time', () => {
    expect(fieldsFromEvent({ start_at: '2026-09-04T19:30', end_at: '2026-09-04T21:15' })).toEqual(
      F('2026-09-04', '19:30', '2026-09-04', '21:15'),
    );
  });

  it('leaves the time box empty for an all-day event', () => {
    // The old `withTime` widened a ten-character value with a hardcoded 09:00, so opening an
    // all-day event showed a clock time nobody had entered — and saving wrote it back.
    expect(fieldsFromEvent({ start_at: '2026-09-04', end_at: '2026-09-06' })).toEqual(
      F('2026-09-04', '', '2026-09-06', ''),
    );
  });

  it('gives „Datum offen" and a brand-new event four empty boxes', () => {
    expect(fieldsFromEvent({ start_at: null, end_at: null })).toEqual(F(''));
    expect(fieldsFromEvent(null)).toEqual(F(''));
  });

  it('reads each end independently — a start without an end is not an empty form', () => {
    expect(fieldsFromEvent({ start_at: '2026-09-04T19:30', end_at: null })).toEqual(
      F('2026-09-04', '19:30'),
    );
  });
});

describe('whenFromFields', () => {
  it('stores an all-day event as ten characters with all_day 1', () => {
    expect(whenFromFields(F('2026-09-04'))).toEqual({
      start_at: '2026-09-04',
      end_at: null,
      all_day: 1,
    });
  });

  it('stores a timed event as sixteen characters with all_day 0', () => {
    expect(whenFromFields(F('2026-09-04', '19:30', '', '21:15'))).toEqual({
      start_at: '2026-09-04T19:30',
      end_at: '2026-09-04T21:15',
      all_day: 0,
    });
  });

  it('lets the end inherit the start date when only a time is given', () => {
    // 19:30–21:15 on the same evening is the common case; without this it costs a second date.
    expect(whenFromFields(F('2026-09-04', '19:30', '', '21:15')).end_at).toBe('2026-09-04T21:15');
  });

  it('keeps an explicit end date across midnight', () => {
    expect(whenFromFields(F('2026-09-04', '23:25', '2026-09-05', '01:00')).end_at).toBe(
      '2026-09-05T01:00',
    );
  });

  it('rolls the inherited end date over midnight when the end is earlier in the clock', () => {
    // 23:00–01:00 with no second date is one evening. Inheriting the *start's* date instead made
    // the commonest late-night shape unsaveable: it came back as „Das Ende liegt vor dem Beginn."
    expect(whenFromFields(F('2026-09-04', '23:00', '', '01:00')).end_at).toBe('2026-09-05T01:00');
    expect(eventTimeProblem(F('2026-09-04', '23:00', '', '01:00'))).toBeNull();
  });

  it('rolls over month, year and leap-day boundaries', () => {
    const endOf = (startDate: string) => whenFromFields(F(startDate, '23:00', '', '01:00')).end_at;
    expect(endOf('2026-08-31')).toBe('2026-09-01T01:00');
    expect(endOf('2026-12-31')).toBe('2027-01-01T01:00');
    expect(endOf('2026-02-28')).toBe('2026-03-01T01:00');
    expect(endOf('2028-02-28')).toBe('2028-02-29T01:00'); // 2028 is a leap year
    expect(endOf('2100-02-28')).toBe('2100-03-01T01:00'); // …2100 is not
  });

  it('leaves an equal end time on the start date rather than a day later', () => {
    // Only *earlier* rolls over; equal is the zero-length marker `eventTimeProblem` allows.
    expect(whenFromFields(F('2026-09-04', '19:30', '', '19:30')).end_at).toBe('2026-09-04T19:30');
  });

  it('stores a multi-day all-day range as two ten-character values', () => {
    expect(whenFromFields(F('2026-09-04', '', '2026-09-06'))).toEqual({
      start_at: '2026-09-04',
      end_at: '2026-09-06',
      all_day: 1,
    });
  });

  it('stores nothing at all without a start date, with the all_day the rest of the app writes', () => {
    // Nobody reads `all_day` while `start_at` is NULL, so the value is free — and it has to be
    // the 0 that `demo.ts` and the CSV importer write, or every „Datum offen" row in the
    // database would flip the first time anything else in the dialog was saved.
    expect(whenFromFields(F('', '19:30', '2026-09-04', '21:15'))).toEqual({
      start_at: null,
      end_at: null,
      all_day: 0,
    });
    // The boxes are not silently emptied on the way, though — this input is refused.
    expect(eventTimeProblem(F('', '19:30', '2026-09-04', '21:15'))).not.toBeNull();
  });

  it('gives each end the shape of its own boxes rather than an eleven-character stub', () => {
    // Refused input (`eventTimeProblem` blocks a mixed pair), but the function is exported on its
    // own: an end date without an end time used to come back as the unparseable '2026-09-05T'.
    expect(whenFromFields(F('2026-09-04', '19:30', '2026-09-05')).end_at).toBe('2026-09-05');
    expect(whenFromFields(F('2026-09-04', '', '2026-09-05', '21:15')).end_at).toBe(
      '2026-09-05T21:15',
    );
  });

  it('leaves the end open when no end is given', () => {
    expect(whenFromFields(F('2026-09-04', '19:30')).end_at).toBeNull();
  });

  it('only ever writes NULL, ten characters or sixteen', () => {
    // Refused shapes included: the guarantee is the function's own, not one `EventEditor` grants
    // it by checking `eventTimeProblem` first.
    const inputs = [
      F(''),
      F('', '19:30'),
      F('', '', '2026-09-04', '21:15'),
      F('2026-09-04'),
      F('2026-09-04', '19:30'),
      F('2026-09-04', '', '2026-09-06'),
      F('2026-09-04', '19:30', '', '21:15'),
      F('2026-09-04', '19:30', '', '01:00'),
      F('2026-09-04', '19:30', '2026-09-05', '01:00'),
      F('2026-09-04', '19:30', '2026-09-05'),
      F('2026-09-04', '', '2026-09-05', '21:15'),
    ];
    for (const f of inputs) {
      const w = whenFromFields(f);
      for (const v of [w.start_at, w.end_at]) {
        expect(v === null || v.length === 10 || v.length === 16, JSON.stringify({ f, v })).toBe(true);
      }
      expect(w.all_day === 0 || w.all_day === 1).toBe(true);
    }
  });
});

describe('round-trip', () => {
  // The three shapes the demo ships (events 1, 2 and 8 in `server/src/demo.ts`) plus a
  // multi-day range: opening an event and saving it untouched must be a byte-for-byte no-op,
  // which is the whole „the package changes the form, not the data" claim.
  const stored = [
    { start_at: '2026-09-04T19:30', end_at: '2026-09-04T21:15', all_day: 0 as const },
    { start_at: '2026-08-25', end_at: null, all_day: 1 as const },
    // Demo event 8, byte for byte: `all_day` is 0 on a date-less row, both there and out of the
    // CSV importer. This fixture said 1 and passed while the shape that actually ships did not.
    { start_at: null, end_at: null, all_day: 0 as const },
    { start_at: '2026-08-31', end_at: '2026-09-02', all_day: 1 as const },
  ];

  it('reproduces every stored shape exactly', () => {
    for (const ev of stored) {
      expect(whenFromFields(fieldsFromEvent(ev))).toEqual(ev);
    }
  });

  it('reproduces a start and end whose shapes disagree', () => {
    // Not producible in the dialog — `eventTimeProblem` refuses to let one be typed — but the
    // CSV importer writes them: `seed.ts` reads all_day off the start cell and passes the end
    // through under that same branch. Editing such an event must not rewrite its times.
    for (const ev of [
      { start_at: '2026-09-04T19:30', end_at: '2026-09-06', all_day: 0 as const },
      { start_at: '2026-09-04', end_at: '2026-09-06T22:00', all_day: 1 as const },
    ]) {
      expect(whenFromFields(fieldsFromEvent(ev))).toEqual(ev);
    }
  });

  it('cannot reproduce seconds, which is why an untouched row is not derived over', () => {
    // `toIsoLocal` (server/src/seed.ts) only swaps the space for a T, so an imported cell can be
    // nineteen characters. The boxes hold HH:mm and nothing finer, so deriving truncates —
    // `EventEditor` writes the stored value back verbatim when the boxes were never touched.
    const ev = { start_at: '2026-09-04T19:30:45', end_at: null, all_day: 0 as const };
    expect(whenFromFields(fieldsFromEvent(ev)).start_at).toBe('2026-09-04T19:30');
  });

  it('keeps what the list, dashboard and print sheets render', () => {
    for (const ev of stored) {
      expect(formatEventWhen(whenFromFields(fieldsFromEvent(ev)))).toBe(formatEventWhen(ev));
    }
  });
});

describe('eventTimeProblem', () => {
  it('accepts an event with no date at all', () => {
    expect(eventTimeProblem(F(''))).toBeNull();
  });

  it('refuses the other boxes when the start date is empty', () => {
    // „Datum offen" stores NULL and nothing else, so these are thrown away on save — with the
    // dialog still showing them, and with no way to get them back.
    expect(eventTimeProblem(F('', '', '2026-09-05', '21:15'))).toMatch(/Ende ohne Beginn/);
    expect(eventTimeProblem(F('', '', '2026-09-05'))).toMatch(/Ende ohne Beginn/);
    expect(eventTimeProblem(F('', '19:30'))).toMatch(/Uhrzeit ohne Datum/);
  });

  it('accepts the four well-formed shapes', () => {
    expect(eventTimeProblem(F('2026-09-04'))).toBeNull();
    expect(eventTimeProblem(F('2026-09-04', '19:30'))).toBeNull(); // timed, open end
    expect(eventTimeProblem(F('2026-09-04', '19:30', '', '21:15'))).toBeNull();
    expect(eventTimeProblem(F('2026-09-04', '', '2026-09-06'))).toBeNull();
  });

  it('refuses one clock time without the other', () => {
    // `end_at` is NULL or sixteen characters and nothing in between, so an end date without an
    // end time would mean inventing a time or discarding the date the user just typed.
    expect(eventTimeProblem(F('2026-09-04', '19:30', '2026-09-05'))).toMatch(/beide eine Uhrzeit/);
    expect(eventTimeProblem(F('2026-09-04', '', '2026-09-05', '21:15'))).toMatch(/beide eine Uhrzeit/);
  });

  it('refuses an end before its start', () => {
    expect(eventTimeProblem(F('2026-09-04', '', '2026-09-03'))).toMatch(/vor dem Beginn/);
    expect(eventTimeProblem(F('2026-09-04', '19:30', '2026-09-03', '21:15'))).toMatch(/vor dem Beginn/);
    // Only with a date to compare: an end time alone that is earlier in the clock is the
    // overnight case, and rolls to the next day instead of being refused.
    expect(eventTimeProblem(F('2026-09-04', '19:30', '2026-09-04', '18:00'))).toMatch(
      /vor dem Beginn/,
    );
    expect(eventTimeProblem(F('2026-09-04', '19:30', '', '18:00'))).toBeNull();
  });

  it('allows an end equal to its start', () => {
    // A zero-length appointment is a marker, not a mistake.
    expect(eventTimeProblem(F('2026-09-04', '19:30', '2026-09-04', '19:30'))).toBeNull();
    expect(eventTimeProblem(F('2026-09-04', '', '2026-09-04'))).toBeNull();
  });
});
