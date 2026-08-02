import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api/client';
import type {
  CustomColumnOption,
  ID,
  LabelOverride,
  OptionUsage,
  Settings,
  TaskSortRule,
} from './api/types';
import { doneValueOf } from './api/types';
import { errorMessage } from './lib/errors';
import { LABEL_DEFAULTS, isLabelKey, type LabelKey } from './lib/labels';
import { normalizeSelectOptions } from './lib/selectOptions';
import {
  ALL_METRICS,
  DEFAULT_ATTENTION_DAYS,
  DEFAULT_METRICS,
  type TaskMetric,
} from './lib/taskStats';
import { useToast } from './components/Toast';
import { useUndo } from './components/UndoProvider';

/** The dataset is tiny and local, so invalidating everything on write is simplest and instant. */
export function useInvalidateAll(): () => Promise<void> {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

/**
 * Report a rejected call as a German toast. `errorMessage` decides the wording — the German
 * sentence leads, an ApiError's server text follows in parentheses.
 */
export function useErrorToast(): (err: unknown, fallback: string) => void {
  const toast = useToast();
  return (err, fallback) => toast.show({ message: errorMessage(err, fallback) });
}

/**
 * Run a write and report a rejection instead of letting it vanish. **The designated catch →
 * toast path for every write in the client** — reach for this rather than a hand-written
 * try/catch, so the wording and the "did it actually happen" question stay answered in one
 * place.
 *
 * Returns whether the call resolved, because "report it" is rarely the whole job: a caller
 * that closes a dialog, clears a draft or shows a success toast has to do that *only* on the
 * resolved path, or a failure still reads as success (PGS-07, PGS-09).
 *
 *     const guard = useGuardedAction();
 *     if (await guard('Speichern fehlgeschlagen.', () => api.tasks.update(id, patch))) close();
 */
export function useGuardedAction(): (
  fallback: string,
  run: () => Promise<unknown>,
) => Promise<boolean> {
  const report = useErrorToast();
  return async (fallback, run) => {
    try {
      await run();
      return true;
    } catch (err) {
      report(err, fallback);
      return false;
    }
  };
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
}

/**
 * The active season's name, read from the seasons.json registry — the one place a rename
 * always lands. The per-season `settings.saison` row is *not* it: renaming a season on the
 * landing page while it is inactive updates the registry only (updateSeason can write the
 * setting solely for the season it has open), so that row keeps the old name and every
 * consumer here — the season-scope label in the task table, the kicker on the printed
 * one-pagers — disagreed with the switcher and the landing card, with no in-app way to
 * repair it (CCL-06). The setting stays as the file's own self-description (seed/demo).
 *
 * Rides on the ['seasons'] query the header switcher already fetches on every page.
 */
export function useSaison(): string {
  const { data } = useQuery({ queryKey: ['seasons'], queryFn: api.seasons });
  return data?.seasons.find((s) => s.id === data.activeId)?.label ?? 'Auftakt';
}

/**
 * The user-renameable word for a season („Saison"/„Saisons" by default, e.g. „Jahr"/
 * „Jahre"). Stored in the seasons.json registry — app-global, not per season — and
 * rides on the ['seasons'] query the header switcher already fetches on every page.
 */
export function useSeasonTerm(): { singular: string; plural: string } {
  const { data } = useQuery({ queryKey: ['seasons'], queryFn: api.seasons });
  return {
    singular: data?.terms?.season?.trim() || 'Saison',
    plural: data?.terms?.seasonPlural?.trim() || 'Saisons',
  };
}

/**
 * The event-type / project-status options as coloured `{ value, label, color }[]`, normalising
 * the legacy plain-string form so every read site gets the same shape. This is the single
 * boundary where the two settings are parsed — consumers never touch the raw setting.
 */
export function useEventTypeOptions(): CustomColumnOption[] {
  const { data } = useSettings();
  return useMemo(() => normalizeSelectOptions(data?.event_types), [data?.event_types]);
}

export function useProjectStatusOptions(): CustomColumnOption[] {
  const { data } = useSettings();
  return useMemo(() => normalizeSelectOptions(data?.project_statuses), [data?.project_statuses]);
}

/**
 * The Status column's „done" value — what drives gray-out, sink-to-bottom, the open/done split
 * in the stats and the archive. The single derivation, replacing the copy that sat on five
 * pages and was then prop-threaded into TaskStatChips, AttentionList, ArtistCard and
 * ProjectCard: changing how done-ness resolves used to mean touching five pages and every prop
 * signature, and any site missed silently kept the old semantics (PGS-27).
 *
 * Global columns are the whole answer — built-ins are inserted with `scope: 'global'`, so a
 * project page's merged global+project list can never resolve a different Status column.
 */
export function useDoneValue(): string {
  const { data = [] } = useQuery({
    queryKey: ['customColumns', 'global'],
    queryFn: () => api.customColumns.list({ scope: 'global' }),
  });
  return useMemo(() => doneValueOf(data), [data]);
}

/**
 * How many rows still hold each option value. The single boundary for the "still in use" delete
 * guards, replacing the per-page tallies built from live-only lists — those could not see
 * soft-deleted rows (PGS-02) or tasks moved out of a project (TTU-10), which is exactly the data
 * a delete would orphan. `ready` is false while the query is in flight so callers can gate the
 * save rather than let an empty map read as "unused".
 */
export function useOptionUsage(): { usage: OptionUsage | undefined; ready: boolean } {
  const { data, isSuccess } = useQuery({ queryKey: ['usage'], queryFn: api.usage });
  return { usage: data, ready: isSuccess };
}

/** Link categories (WP-P). Unset parses to `[]` — the LinkList then renders flat, no groups. */
export function useLinkCategoryOptions(): CustomColumnOption[] {
  const { data } = useSettings();
  return useMemo(() => normalizeSelectOptions(data?.link_categories), [data?.link_categories]);
}

/**
 * The task-insight preferences as a resolved `{ metrics, windowDays }` — the single boundary where
 * `task_stats` / `attention_window_days` are parsed. An unset `task_stats` falls back to the
 * defaults; an explicitly empty array is honoured (the user turned every metric off). The window
 * is stored as a scalar string and coerced/clamped here so callers never touch the raw setting.
 */
export function useTaskStatsConfig(): { metrics: TaskMetric[]; windowDays: number } {
  const { data } = useSettings();
  return useMemo(() => {
    const raw = data?.task_stats;
    const valid = new Set<string>(ALL_METRICS.map((m) => m.key));
    const metrics = Array.isArray(raw)
      ? (raw as unknown[]).filter((k): k is TaskMetric => typeof k === 'string' && valid.has(k))
      : DEFAULT_METRICS;
    const n = Number(data?.attention_window_days);
    const windowDays = Number.isFinite(n) && n >= 1 ? Math.min(Math.round(n), 365) : DEFAULT_ATTENTION_DAYS;
    return { metrics, windowDays };
  }, [data?.task_stats, data?.attention_window_days]);
}

/**
 * The configured automatic sort hierarchy. The single boundary where `task_sort` is read —
 * consumers never touch the raw setting.
 *
 * It was the one array-valued setting read with a bare `?? []`, while `useTaskStatsConfig`,
 * `useLabel` and `SectionArranger` all test `Array.isArray` first. A non-array value —
 * settings.ts stores any non-array as `String(v)` and `safeParse` hands the raw string back —
 * therefore survived the guard (`"status" ?? []` is `"status"`) and reached `value.some(…)`,
 * throwing a TypeError mid-render. That blanked the Aufgaben tab *and* every task table, with
 * no way left to repair the setting from the UI (PGS-15).
 */
export function useTaskSortRules(): TaskSortRule[] {
  const { data } = useSettings();
  const raw = data?.task_sort;
  return useMemo(() => {
    if (!Array.isArray(raw)) return [];
    const out: TaskSortRule[] = [];
    for (const row of raw as unknown[]) {
      if (!row || typeof row !== 'object') continue;
      const { id, dir } = row as TaskSortRule;
      if (typeof id === 'string' && id) out.push({ id, dir: dir === 'desc' ? 'desc' : 'asc' });
    }
    return out;
  }, [raw]);
}

/**
 * Resolves a heading id to its text: the user's override if there is one, else the default
 * from `LABEL_DEFAULTS`. Read defensively — a hand-edited or legacy setting must never blank
 * out a heading, so anything that isn't a well-formed override row is skipped.
 */
export function useLabel(): (key: LabelKey) => string {
  const { data } = useSettings();
  const raw = data?.labels;
  const overrides = useMemo(() => {
    const map = new Map<string, string>();
    if (!Array.isArray(raw)) return map;
    for (const row of raw as unknown[]) {
      if (!row || typeof row !== 'object') continue;
      const { key, label } = row as LabelOverride;
      if (typeof key === 'string' && typeof label === 'string' && label && isLabelKey(key)) {
        map.set(key, label);
      }
    }
    return map;
  }, [raw]);
  return (key) => overrides.get(key) ?? LABEL_DEFAULTS[key];
}

/**
 * Renames a heading. Passing an empty string — or the default text — drops the override row
 * instead of storing a redundant one, which is what makes clearing the field a reset.
 */
export function useRenameLabel(): (key: LabelKey, label: string) => Promise<void> {
  const { data } = useSettings();
  const invalidate = useInvalidateAll();
  return async (key, label) => {
    const trimmed = label.trim();
    const stored = Array.isArray(data?.labels) ? (data.labels as LabelOverride[]) : [];
    const rest = stored.filter((r) => r && typeof r === 'object' && r.key !== key);
    const next =
      !trimmed || trimmed === LABEL_DEFAULTS[key] ? rest : [...rest, { key, label: trimmed }];
    await api.patchSettings({ labels: next });
    await invalidate();
  };
}

/**
 * Columns the server derives, so the inverse has to carry them even though the forward patch
 * never named them — keyed by the resource they belong to.
 *
 * Only `tasks` has one: `erledigt_am` is stamped from `status`, and the server cannot
 * reconstruct the old value, so undoing a status flip without it re-stamps today's date and
 * silently un-archives a task that had aged past ARCHIVE_AFTER_DAYS. That knowledge used to sit
 * in an `extraKeys` argument every caller had to remember; nothing in the types warned a new
 * „als erledigt markieren" button that it was missing it (CCL-30).
 */
const DERIVED_INVERSE_KEYS = new Map<unknown, string[]>([[api.tasks, ['erledigt_am']]]);

export interface UndoablePatchArgs<T extends { id: ID }> {
  /** Any `resource()` from api/client.ts. */
  res: { update: (id: ID, data: Partial<T>) => Promise<unknown> };
  /** The row as it was *before* the edit — the inverse is picked off it. */
  row: T;
  patch: Partial<T>;
  /** German, names the change: „Statusänderung". */
  label: string;
}

/**
 * Apply a field edit and record its inverse on the undo stack.
 *
 * PATCH is column-set semantics server-side (only supplied columns reach the SET clause), so the
 * inverse of `update(id, patch)` is just the same keys picked off the pre-edit row — no per-field
 * code. That also handles `tasks.custom_values`: the row holds the raw JSON *string* and the
 * server passes strings through untouched, so putting it back verbatim restores the whole blob.
 * Rebuilding a single key instead would wipe the task's other custom columns.
 */
export function useUndoablePatch(): <T extends { id: ID }>(
  args: UndoablePatchArgs<T>,
) => Promise<void> {
  const { push } = useUndo();
  const invalidate = useInvalidateAll();
  return async ({ res, row, patch, label }) => {
    type T = typeof row;
    const patchKeys = Object.keys(patch) as (keyof T & string)[];
    const derived = (DERIVED_INVERSE_KEYS.get(res) ?? []).filter(
      (k) => k in row,
    ) as (keyof T & string)[];
    const inverse: Partial<T> = {};
    for (const k of [...new Set([...patchKeys, ...derived])]) inverse[k] = row[k];

    const apply = async () => {
      await res.update(row.id, patch);
      await invalidate();
    };
    const revert = async () => {
      await res.update(row.id, inverse);
      await invalidate();
    };

    await apply();
    // Saving a dialog without touching anything shouldn't consume an undo step.
    if (patchKeys.some((k) => !Object.is(row[k], patch[k]))) push({ label, apply, revert });
  };
}

export interface UndoableDeleteArgs {
  label: string;
  remove: () => Promise<unknown>;
  restore: () => Promise<unknown>;
}

/**
 * Soft-delete something, record it on the shared undo stack and surface an undo toast — both
 * wired to the same entry, so Cmd+Z and the toast's „Rückgängig" revert the same operation.
 *
 * The stack half is what makes a delete behave like every other edit (CCL-02): before, a
 * deletion left `undoStack` untouched, so the reflex Cmd+Z after a mis-click silently reverted
 * whatever the user had edited *before* — the deleted row stayed gone and an edit they meant to
 * keep was rolled back. The failure arm of the restore lives in `UndoProvider` now, next to the
 * one the keyboard path already had.
 *
 * Returns whether the row is actually gone, mirroring `useGuardedAction` — a failed or empty
 * delete gets a German toast and no undo affordance, never the „gelöscht" one (CCL-03).
 */
export function useUndoableDelete(): (args: UndoableDeleteArgs) => Promise<boolean> {
  const { pushWithToast } = useUndo();
  const toast = useToast();
  const report = useErrorToast();
  const invalidate = useInvalidateAll();
  return async ({ label, remove, restore }) => {
    let result: unknown;
    try {
      result = await remove();
    } catch (err) {
      // Every call site floats this promise, so without the catch a failed DELETE — a
      // restarting server, a 500 mid-backup — surfaced as nothing at all: the row stayed on
      // screen, no toast appeared, and the click read as missed (CCL-03).
      report(err, `${label} konnte nicht gelöscht werden.`);
      await invalidate();
      return false;
    }
    await invalidate();
    if (nothingDeleted(result)) {
      toast.show({ message: `${label} war bereits gelöscht` });
      return false;
    }
    pushWithToast(
      {
        label: `Löschen von ${label}`,
        // Redo re-deletes; both halves refresh even when the call fails, so a list can never
        // keep showing a row the server no longer has.
        apply: async () => {
          try {
            await remove();
          } finally {
            await invalidate();
          }
        },
        revert: async () => {
          try {
            await restore();
          } finally {
            await invalidate();
          }
        },
      },
      `${label} gelöscht`,
    );
    return true;
  };
}

/**
 * Whether the server reports that it deleted nothing. `crudRouter`'s DELETE never 404s — it
 * answers 200 with `{ deleted: false }` when the row was already gone — so a list still showing
 * a row deleted seconds ago in another view (`staleTime: 5_000`, no refetch on focus) would
 * otherwise produce a „… gelöscht" toast plus a „Rückgängig" for a delete that never happened;
 * pressing it then 404s on `/restore` and contradicts the first toast.
 *
 * Both shapes count: one response, or the `Promise.all([…])` of a task plus its subtasks.
 * Delete paths that answer with something else entirely (the landing snapshot patches) have no
 * `deleted` key and are never mistaken for an empty delete.
 */
function nothingDeleted(result: unknown): boolean {
  const rows = Array.isArray(result) ? result : [result];
  return (
    rows.length > 0 &&
    rows.every(
      (r) => typeof r === 'object' && r !== null && (r as { deleted?: unknown }).deleted === false,
    )
  );
}

/** Small helper to build the delete/restore pair for a resource id. */
export function resourceUndo(
  res: { remove: (id: ID) => Promise<unknown>; restore: (id: ID) => Promise<unknown> },
  id: ID,
): Pick<UndoableDeleteArgs, 'remove' | 'restore'> {
  return { remove: () => res.remove(id), restore: () => res.restore(id) };
}

export type { Settings };
