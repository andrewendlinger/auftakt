import type { CustomColumnOption } from '../api/types';

/**
 * Pastel palette shared by every "coloured options" editor (task columns, event types,
 * project statuses). New options cycle through it; it doubles as the deterministic fallback
 * for legacy string data below.
 */
export const OPTION_PALETTE = ['#fee2e2', '#fef3c7', '#dcfce7', '#e0f2fe', '#ede9fe', '#fce7f3', '#f1f5f9'];

/**
 * The event-type colours that used to be hardcoded client-side (`TYPE_COLORS` in EventList,
 * pre-WP-I), keyed by the German name. Kept so seasons still storing the plain-string form
 * render identically after the move to coloured options — no migration needed.
 */
const LEGACY_EVENT_COLORS: Record<string, string> = {
  Auftritt: '#fef3c7',
  Termin: '#e2e8f0',
  Anreise: '#e0f2fe',
  Deadline: '#fee2e2',
  Probe: '#ede9fe',
};

/** Deterministic palette index for a value, so the same legacy string gets the same colour
 *  at every call site without anything being persisted. */
function paletteFor(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0;
  return OPTION_PALETTE[Math.abs(h) % OPTION_PALETTE.length]!;
}

function colorForName(name: string): string {
  return LEGACY_EVENT_COLORS[name] ?? paletteFor(name);
}

/**
 * Normalise an `event_types` / `project_statuses` setting to coloured options. Existing seasons
 * store a plain `string[]`; new ones store `{ value, label, color }[]`. Read tolerantly so either
 * form parses — a bare string `s` becomes `{ value: s, label: s, color }`, and a malformed entry
 * is skipped rather than blanking the list.
 *
 * Also the normalisation behind `parseColumnOptions`, which is why `done` is carried through:
 * a task column's Status options add that one field over an event type's, and losing it would
 * silently break `doneValueOf` (CCL-07).
 */
export function normalizeSelectOptions(raw: unknown): CustomColumnOption[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomColumnOption[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const s = item.trim();
      if (s) out.push({ value: s, label: s, color: colorForName(s) });
    } else if (item && typeof item === 'object') {
      const o = item as Partial<CustomColumnOption>;
      const value = (typeof o.value === 'string' && o.value) || (typeof o.label === 'string' ? o.label : '');
      if (!value) continue;
      const label = (typeof o.label === 'string' && o.label) || value;
      const color = (typeof o.color === 'string' && o.color) || colorForName(value);
      out.push({ value, label, color, ...(o.done === true ? { done: true } : {}) });
    }
  }
  return out;
}

/** Look up an option by its stored value (events.type / projects.status). */
export function findOption(
  options: CustomColumnOption[],
  value: string | null | undefined,
): CustomColumnOption | undefined {
  if (!value) return undefined;
  return options.find((o) => o.value === value);
}
