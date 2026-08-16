import type { ColumnOverrides, CustomColumn } from '../api/types';
import { compareColumns } from '../api/types';

/**
 * Column identity and per-page visibility. Pure — no React, no DOM — so `check:unit` reaches it,
 * and so `lib/taskSort.ts` can build the „a column you cannot see does not order the table" rule
 * on top of it without either file importing the other twice.
 */

/**
 * Stable column id: built-ins use their `key`, custom columns `custom:<id>`.
 *
 * The delimiter is the point. With customs encoded as `c<id>` the two namespaces overlapped —
 * `BUILTIN_COLUMNS` holds `comment` and `created` — so the built-in Kommentar key decoded as
 * "custom column number `omment`": `Number('omment')` is NaN, `customValueOf` returns '', and
 * that level of the sort hierarchy silently compared every task equal. Only `comment`'s absence
 * from SORTABLE_TASK_COLUMNS kept it unreachable, and a hand-edited or imported `task_sort` does
 * not respect that list (TTU-31). `:` cannot appear in a built-in key.
 */
const CUSTOM_PREFIX = 'custom:';

export function colId(col: CustomColumn): string {
  return col.kind === 'builtin' && col.key ? col.key : `${CUSTOM_PREFIX}${col.id}`;
}

/** The inverse of `colId` — the custom column's id, or null for a built-in key. */
export function customColId(id: string): number | null {
  if (!id.startsWith(CUSTOM_PREFIX)) return null;
  const n = Number(id.slice(CUSTOM_PREFIX.length));
  return Number.isInteger(n) ? n : null;
}

/**
 * **The one visibility rule.** `custom_columns.enabled` is the season default; a page may depart
 * from it per column (WP-59), and a column the page's map does not name follows the default.
 *
 * Every reader of „does this column render here" goes through this: the task table's column set,
 * the sort rules that are in effect, the print sheet and the .xlsx export. A second spelling
 * anywhere is a surface that shows a column the page next to it hides.
 */
export function columnVisible(col: CustomColumn, overrides: ColumnOverrides = {}): boolean {
  return overrides[colId(col)] ?? col.enabled !== 0;
}

/** The columns a page renders, in display order (`compareColumns`). Never mutates its input. */
export function visibleColumns(
  columns: CustomColumn[],
  overrides: ColumnOverrides = {},
): CustomColumn[] {
  return columns.filter((c) => columnVisible(c, overrides)).sort(compareColumns);
}

/**
 * Read the stored `artists.task_columns` / `projects.task_columns` text, which arrives unparsed
 * like every JSON-in-TEXT column (the crud factory has no read transform).
 *
 * Defensive in the same way `parseEntityLayout` is: `null`, a hand-edited value, a foreign shape
 * and a non-boolean entry all read as „no override" rather than throwing mid-render, so the single
 * failure mode is a page showing the season default instead of a blank screen (PGS-15).
 */
export function parseColumnOverrides(raw: unknown): ColumnOverrides {
  if (typeof raw !== 'string' || !raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: ColumnOverrides = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (key && typeof value === 'boolean') out[key] = value;
  }
  return out;
}

/**
 * The next map after showing or hiding one column on one page — or `null`, meaning „this page
 * follows the season default again".
 *
 * **An override that agrees with the default is dropped**, and an emptied map becomes `null`.
 * That is what makes toggling a column back the way back: without the prune a page that had been
 * set and unset would keep a `task_columns` of its own, look untouched, and quietly stop following
 * a later change in Einstellungen — the same trap `useEntityLayout`'s removal undo answers with
 * `resetToDefault()` rather than writing the standard back as an arrangement.
 */
export function withColumnVisible(
  overrides: ColumnOverrides,
  col: CustomColumn,
  visible: boolean,
): ColumnOverrides | null {
  const next = { ...overrides };
  if (visible === (col.enabled !== 0)) delete next[colId(col)];
  else next[colId(col)] = visible;
  return Object.keys(next).length > 0 ? next : null;
}
