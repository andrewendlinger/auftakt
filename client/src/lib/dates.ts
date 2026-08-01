/**
 * Every date the app stores is a naive local string — local meaning this machine's clock:
 *   timed        → "YYYY-MM-DDTHH:mm"
 *   all-day      → "YYYY-MM-DD"
 *   machine stamp→ "YYYY-MM-DD HH:mm:ss"   (created_at, updated_at, deleted_at, erledigt_am)
 *
 * That includes the server-generated stamps: they are written through shared/time.ts and
 * SQLite's `'localtime'` modifier precisely so this module needs one parser rather than two
 * (FIX-06). We parse the components directly (no Date/UTC round-trip) to avoid timezone
 * shifts, and format German-style DD.MM.YYYY.
 */

interface Parts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  hasTime: boolean;
}

export function parseLocal(iso: string | null | undefined): Parts | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso);
  if (!m) return null;
  return {
    y: Number(m[1]),
    mo: Number(m[2]),
    d: Number(m[3]),
    h: m[4] ? Number(m[4]) : 0,
    mi: m[5] ? Number(m[5]) : 0,
    hasTime: m[4] !== undefined,
  };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** "04.09.2026" */
export function formatDate(iso: string | null | undefined): string {
  const p = parseLocal(iso);
  return p ? `${pad(p.d)}.${pad(p.mo)}.${p.y}` : '';
}

/** "04.09.2026" without year when it matches `refYear` — used inside ranges. */
function formatDayMonth(p: Parts, withYear: boolean): string {
  return withYear ? `${pad(p.d)}.${pad(p.mo)}.${p.y}` : `${pad(p.d)}.${pad(p.mo)}.`;
}

/** "22:00" */
export function formatTime(iso: string | null | undefined): string {
  const p = parseLocal(iso);
  return p ? `${pad(p.h)}:${pad(p.mi)}` : '';
}

/** "04.09.2026, 22:00" */
export function formatDateTime(iso: string | null | undefined): string {
  const p = parseLocal(iso);
  if (!p) return '';
  return p.hasTime ? `${formatDate(iso)}, ${pad(p.h)}:${pad(p.mi)}` : formatDate(iso);
}

export interface EventLike {
  start_at: string | null;
  end_at?: string | null;
  all_day?: number | boolean;
}

/**
 * Human-friendly "when" for an event:
 *   all-day single      → "31.08.2026"
 *   all-day multi-day   → "31.08.–03.09.2026"
 *   timed same day      → "04.09.2026, 22:00–23:00"
 *   timed, open end     → "04.09.2026, 22:00"
 *   timed across days   → "03.09.2026, 23:25 – 04.09.2026, 01:00"
 */
export function formatEventWhen(ev: EventLike): string {
  const s = parseLocal(ev.start_at);
  if (!s) return '';
  const e = parseLocal(ev.end_at);
  const allDay = ev.all_day === 1 || ev.all_day === true;
  const sameDay = e && s.y === e.y && s.mo === e.mo && s.d === e.d;

  if (allDay) {
    if (!e || sameDay) return formatDayMonth(s, true);
    const sameYear = s.y === e.y;
    return `${formatDayMonth(s, !sameYear)}–${formatDayMonth(e, true)}`;
  }

  const startStr = `${formatDayMonth(s, true)}, ${pad(s.h)}:${pad(s.mi)}`;
  if (!e) return startStr;
  if (sameDay) return `${startStr}–${pad(e.h)}:${pad(e.mi)}`;
  return `${startStr} – ${formatDayMonth(e, true)}, ${pad(e.h)}:${pad(e.mi)}`;
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** "Mo" — weekday abbreviation (weeks start Monday in the UI, but this just labels a date). */
export function weekdayShort(iso: string | null | undefined): string {
  const p = parseLocal(iso);
  if (!p) return '';
  const dow = new Date(p.y, p.mo - 1, p.d).getDay();
  return WEEKDAYS[dow] ?? '';
}

/** Days from today (local) to the given date; negative = past. */
export function daysUntil(iso: string | null | undefined): number | null {
  const p = parseLocal(iso);
  if (!p) return null;
  const today = new Date();
  const a = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const b = Date.UTC(p.y, p.mo - 1, p.d);
  return Math.round((b - a) / 86400000);
}
