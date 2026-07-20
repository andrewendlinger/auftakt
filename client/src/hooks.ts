import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api/client';
import type { ID, Settings } from './api/types';
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
