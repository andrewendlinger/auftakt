import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api/client';
import type { CustomColumnOption, ID, LabelOverride, Settings } from './api/types';
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

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
}

export function useSaison(): string {
  const { data } = useSettings();
  return (data?.saison as string) ?? 'Auftakt';
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

export interface UndoablePatchArgs<T extends { id: ID }> {
  /** Any `resource()` from api/client.ts. */
  res: { update: (id: ID, data: Partial<T>) => Promise<unknown> };
  /** The row as it was *before* the edit — the inverse is picked off it. */
  row: T;
  patch: Partial<T>;
  /** German, names the change: „Statusänderung". */
  label: string;
  /**
   * Extra columns to carry in the inverse that the forward patch didn't touch, because the
   * server derives them. Only `tasks` needs it, for `erledigt_am` alongside `status`.
   */
  extraKeys?: (keyof T & string)[];
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
  return async ({ res, row, patch, label, extraKeys = [] }) => {
    type T = typeof row;
    const patchKeys = Object.keys(patch) as (keyof T & string)[];
    const inverse: Partial<T> = {};
    for (const k of [...new Set([...patchKeys, ...extraKeys])]) inverse[k] = row[k];

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

/** Soft-delete something and surface an undo toast that restores it. */
export function useUndoableDelete(): (args: UndoableDeleteArgs) => Promise<void> {
  const toast = useToast();
  const invalidate = useInvalidateAll();
  return async ({ label, remove, restore }) => {
    await remove();
    await invalidate();
    toast.show({
      message: `${label} gelöscht`,
      actionLabel: 'Rückgängig',
      onAction: async () => {
        await restore();
        await invalidate();
      },
    });
  };
}

/** Small helper to build the delete/restore pair for a resource id. */
export function resourceUndo(
  res: { remove: (id: ID) => Promise<unknown>; restore: (id: ID) => Promise<unknown> },
  id: ID,
): Pick<UndoableDeleteArgs, 'remove' | 'restore'> {
  return { remove: () => res.remove(id), restore: () => res.restore(id) };
}

export type { Settings };
