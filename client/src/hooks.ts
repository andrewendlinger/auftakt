import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api/client';
import type { ID, LabelOverride, Settings } from './api/types';
import { LABEL_DEFAULTS, isLabelKey, type LabelKey } from './lib/labels';
import { useToast } from './components/Toast';

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
