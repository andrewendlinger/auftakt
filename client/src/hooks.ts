import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api/client';
import type {
  CustomColumn,
  CustomColumnOption,
  ID,
  LabelOverride,
  LandingContent,
  LandingDocInput,
  LandingPatch,
  OptionUsage,
  Settings,
  SettingsArrayKey,
  SettingsArrayValue,
  Task,
  TaskSortRule,
  WritableSettings,
} from './api/types';
import { doneValueOf } from './api/types';
import { errorMessage } from './lib/errors';
import { LABEL_DEFAULTS, isLabelKey, type LabelKey } from './lib/labels';
import { normalizeEventTypeOptions, normalizeSelectOptions } from './lib/selectOptions';
import {
  ALL_METRICS,
  DEFAULT_ATTENTION_DAYS,
  DEFAULT_METRICS,
  type TaskMetric,
} from './lib/taskStats';
import { useToast } from './components/Toast';
import { useUndo } from './components/UndoProvider';

/**
 * Every hook in this file that hands back a *function* wraps it in `useCallback`.
 *
 * That is a correctness requirement, not a micro-optimisation. A fresh arrow per render
 * propagates: `TaskTable`'s `commit`/`commitCustom`/`requestDelete` are `useCallback`s that
 * depend on these, so an unstable value here invalidates them, which invalidates the `columns`
 * memo, which hands TanStack's `flexRender` a new component *type* — and React answers that by
 * unmounting and remounting every cell subtree in the table. Measured on the demo season: one
 * „＋ Unteraufgabe" click, which changes no data at all, remounted all 60 data cells, and a
 * background refetch destroyed an open Titel editor together with the text being typed into it
 * (removing a focused node fires no blur, so nothing committed it) — TTU-12, TTU-38.
 *
 * The consumers do their half (`useCallback`/`useMemo` with honest dep lists); this file has to
 * do the other half or theirs is inert.
 */

/** The dataset is tiny and local, so invalidating everything on write is simplest and instant. */
export function useInvalidateAll(): () => Promise<void> {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries(), [qc]);
}

/**
 * Report a rejected call as a German toast. `errorMessage` decides the wording — the German
 * sentence leads, an ApiError's server text follows in parentheses.
 */
export function useErrorToast(): (err: unknown, fallback: string) => void {
  const toast = useToast();
  return useCallback(
    (err: unknown, fallback: string) => toast.show({ message: errorMessage(err, fallback) }),
    [toast],
  );
}

/**
 * Commit an open inline editor when it is unmounted.
 *
 * `onBlur` cannot carry this on its own. React delegates focus events at the root container, and
 * a node that is already detached never reaches the component's handler — the native `blur` does
 * fire on the removed element, but `onBlur` does not run, so anything that unmounts an editor
 * mid-edit discarded whatever had been typed, silently and with no way back (TTU-38). Verified
 * both ways on the demo season: with the editor open and text typed, a history-back navigation
 * lost it before this hook and persists it after.
 *
 * Stabilising the task table's column defs (TTU-12) removed the everyday cause — a re-render no
 * longer remounts the cell — but a column being disabled, the row leaving the list or a
 * navigation still unmount it, and those are exactly the moments a user has text in flight. The
 * same exposure applies to every inline editor on a page, which is why this lives here rather
 * than inside `TaskTable`.
 *
 * `active` is the editor's own „am I open" flag, and blur closes the editor before this can run,
 * so the two paths can never both write. Under StrictMode the mount-time cleanup finds
 * `active === false` and does nothing.
 */
export function useCommitOnUnmount(active: boolean, commit: () => void): void {
  const latest = useRef({ active, commit });
  latest.current = { active, commit };
  useEffect(
    () => () => {
      if (latest.current.active) latest.current.commit();
    },
    [],
  );
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
  return useCallback(
    async (fallback: string, run: () => Promise<unknown>) => {
      try {
        await run();
        return true;
      } catch (err) {
        report(err, fallback);
        return false;
      }
    },
    [report],
  );
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
 *
 * Empty until the registry answers, and empty for good if it never does. The old `'Auftakt'`
 * fallback is not a name the server can ever store — every season overwrites it with its registry
 * label — so it was a placeholder that a failed `GET /api/seasons` left on screen indefinitely,
 * including as the kicker of a printed one-pager. Consumers drop the fragment instead (CCL-33).
 */
export function useSaison(): string {
  const { data } = useQuery({ queryKey: ['seasons'], queryFn: api.seasons });
  return data?.seasons.find((s) => s.id === data.activeId)?.label ?? '';
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
  return useMemo(() => normalizeEventTypeOptions(data?.event_types), [data?.event_types]);
}

export function useProjectStatusOptions(): CustomColumnOption[] {
  const { data } = useSettings();
  return useMemo(() => normalizeSelectOptions(data?.project_statuses), [data?.project_statuses]);
}

/**
 * The global column rows — every built-in plus the season-wide custom ones. Built-ins are
 * inserted with `scope: 'global'`, so this list is the whole answer for anything keyed off a
 * built-in: their `key`, their user-editable `name`, their options and their `enabled` flag.
 */
export function useGlobalColumns(): CustomColumn[] {
  const { data = [] } = useQuery({
    queryKey: ['customColumns', 'global'],
    queryFn: () => api.customColumns.list({ scope: 'global' }),
  });
  return data;
}

/**
 * The Status column's „done" value — what drives gray-out, sink-to-bottom, the open/done split
 * in the stats and the archive. The single derivation, replacing the copy that sat on five
 * pages and was then prop-threaded into TaskStatChips, AttentionList, ArtistCard and
 * ProjectCard: changing how done-ness resolves used to mean touching five pages and every prop
 * signature, and any site missed silently kept the old semantics (PGS-27).
 *
 * A project page's merged global+project list can never resolve a different Status column, because
 * `useGlobalColumns` is where the built-ins live.
 */
export function useDoneValue(): string {
  const columns = useGlobalColumns();
  return useMemo(() => doneValueOf(columns), [columns]);
}

/**
 * Every task in the season, live **and** archived (`scope: 'all'`; soft-deleted rows are excluded
 * server-side) — the single boundary for everything that must not stop at the archive edge.
 *
 * Two kinds of consumer need it. The subtask tree (`TaskTable`, `MoveTaskDialog`) does, because a
 * child done longer ago than `ARCHIVE_AFTER_DAYS` is missing from a page's `scope: 'live'` list and
 * a subtree operation derived from that list would strand it (TTU-05). And the „Fortschritt"
 * statistics do: the live list is what the server has already stripped of done tasks older than
 * `ARCHIVE_AFTER_DAYS`, so `computeStats` fed that array reported a *falling* completion percentage
 * as work was finished and aged out — a project whose 12 tasks were all completed six weeks ago
 * rendered „0 %, 0/0" instead of „100 %, 12/12" (CCL-04, PGS-01, TTU-08).
 *
 * The other three metrics are indifferent: an archived task is done by definition, so it can never
 * add to „offen"/„überfällig"/„bald fällig". Only `done`/`total`/`pct` were ever wrong.
 *
 * One query key for one request — every page that renders a `TaskTable` already pays for this
 * fetch, so the statistics come for free.
 */
export function useAllTasks(): { tasks: Task[]; loaded: boolean } {
  const { data = [], isSuccess } = useQuery({
    queryKey: ['tasks', 'scope-all'],
    queryFn: () => api.tasks.list({ scope: 'all' }),
  });
  return { tasks: data, loaded: isSuccess };
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
 * An array-valued setting plus the write that replaces it — for the editors that save on every
 * interaction rather than behind a „Speichern" button.
 *
 * Those editors all shared one defect: the next value is computed from the array the component
 * was rendered with, and that array is only refreshed by the invalidate → refetch round trip the
 * previous write started. A second edit issued inside that window is therefore built on the
 * pre-first-edit snapshot and silently overwrites it — rename two headings quickly and the first
 * reverts to its default (CCL-21); delete two sort rules quickly and the first one comes back
 * while the second disappears, leaving every task table ordered by something the user did not
 * choose (PGS-10). Neither reports anything: the write succeeded, it just wrote the wrong array.
 *
 * The fix is to publish the new value to the `['settings']` cache *before* awaiting the request,
 * so every reader — including a second editor the user clicks 200 ms later, in a different
 * component — computes from it. The response then replaces it with the server's own answer, and
 * a failure falls back to `invalidate()`, which refetches the truth under the toast
 * `useGuardedAction` has already shown (PGS-09).
 *
 * `parse` must be module-level (it is a dep), and must read defensively: any settings value can
 * be a hand-edited or legacy shape, and a throw here blanks the page (PGS-15).
 */
export function useSettingsArray<K extends SettingsArrayKey>(
  key: K,
  parse: (raw: unknown) => SettingsArrayValue<K>,
): { value: SettingsArrayValue<K>; write: (next: SettingsArrayValue<K>) => Promise<boolean> } {
  const qc = useQueryClient();
  const { data } = useSettings();
  const guard = useGuardedAction();
  const invalidate = useInvalidateAll();
  const raw = data?.[key];
  const value = useMemo(() => parse(raw), [raw, parse]);
  const write = useCallback(
    async (next: SettingsArrayValue<K>) => {
      // `{ [key]: next }` with a generic key infers a string index signature, not
      // `Pick<WritableSettings, K>` — and an index signature satisfies an all-optional target
      // vacuously, so it would compile whatever `key` held. The guarantee comes from the
      // `K extends SettingsArrayKey` constraint; the assertion is what states that shape and
      // what breaks if `Settings[K]` and `next` ever stop agreeing.
      const patch = { [key]: next } as Pick<WritableSettings, K>;
      qc.setQueryData<Settings>(['settings'], (old) => (old ? { ...old, ...patch } : old));
      const ok = await guard('Einstellung konnte nicht gespeichert werden.', async () => {
        qc.setQueryData<Settings>(['settings'], await api.patchSettings(patch));
      });
      await invalidate();
      return ok;
    },
    [qc, key, guard, invalidate],
  );
  return { value, write };
}

/**
 * The cross-season landing content and the write that saves it — the `['landing']` twin of
 * `useSettingsArray`, for the same reason.
 *
 * Landing content is one blob in `seasons.json` and every key of a PATCH replaces its whole
 * array, so each write has to compute that array from somewhere. Computing it from the copy the
 * component rendered with is a lost update: that copy is only refreshed by the invalidate →
 * refetch the *previous* write started, so anything done inside that window is built on a
 * pre-edit snapshot and silently overwrites it.
 *
 * Undo made it worse than a race. `restore` used to post the captured pre-delete array back
 * verbatim, so one „Rückgängig" six seconds later rolled back every landing edit made since the
 * delete — a document added, another renamed, a second one deleted — and unlike a soft-deleted
 * row there is no Papierkorb to get any of it back from (SHL-01, SHL-02).
 *
 * `current()` is the answer for a closure that runs later: read the list as it is *now*.
 * `patch` publishes its own value into the cache before awaiting, so an edit issued inside the
 * round trip composes with the pending one instead of replacing it.
 *
 * Unlike `useSettingsArray` this **throws** instead of guarding: `useUndoableDelete`,
 * `RecordFormModal`, `InlineNotes` and `EditableText` all own a catch → German toast already,
 * and swallowing the rejection here would raise a „Rückgängig" toast for a delete that never
 * happened.
 */
export function useLanding(): {
  data: LandingContent | undefined;
  /** The content as it is now, not as it was when the caller rendered. */
  current: () => LandingContent | undefined;
  patch: (next: LandingPatch) => Promise<LandingContent>;
} {
  const qc = useQueryClient();
  const invalidate = useInvalidateAll();
  const { data } = useQuery({ queryKey: ['landing'], queryFn: api.landing.get });
  const current = useCallback(() => qc.getQueryData<LandingContent>(['landing']), [qc]);
  const patch = useCallback(
    async (next: LandingPatch) => {
      // Publish before awaiting so the next reader — including an editor the user clicks 200 ms
      // later — computes from this value. Skipped when the patch adds a row: ids are the
      // server's to assign, and rendering an id-less row would break the list keys (and the
      // ✎/🗑 that address rows by id) for the length of one request. The response below covers
      // that case a few milliseconds later.
      if (rowsAllHaveIds(next)) {
        qc.setQueryData<LandingContent>(['landing'], (old) =>
          old ? ({ ...old, ...next } as LandingContent) : old,
        );
      }
      try {
        const res = await api.landing.patch(next);
        qc.setQueryData<LandingContent>(['landing'], res);
        return res;
      } finally {
        // Also on the failure path: the optimistic value above must not outlive a rejected write.
        await invalidate();
      }
    },
    [qc, invalidate],
  );
  return { data, current, patch };
}

/** Whether every row this patch carries already has a server-assigned id. */
function rowsAllHaveIds(patch: LandingPatch): boolean {
  const docs = (list?: LandingDocInput[]) => (list ?? []).every((d) => d.id != null);
  return docs(patch.documents) && (patch.sections ?? []).every((s) => s.id != null && docs(s.documents));
}

/**
 * Read defensively — settings.ts stores any non-array as `String(v)` and `safeParse` hands the
 * raw string back, so `?? []` is not a guard (`"status" ?? []` is `"status"`), and the value then
 * reached `value.some(…)` and threw a TypeError mid-render. That blanked the Aufgaben tab *and*
 * every task table, with no way left to repair the setting from the UI (PGS-15).
 */
function parseSortRules(raw: unknown): TaskSortRule[] {
  if (!Array.isArray(raw)) return [];
  const out: TaskSortRule[] = [];
  for (const row of raw as unknown[]) {
    if (!row || typeof row !== 'object') continue;
    const { id, dir } = row as TaskSortRule;
    if (typeof id === 'string' && id) out.push({ id, dir: dir === 'desc' ? 'desc' : 'asc' });
  }
  return out;
}

/**
 * Every well-formed override row, *including* keys this build does not know: an override written
 * by a newer version must survive a rename here rather than being dropped on the next write.
 * `useLabel` is where unknown keys stop mattering.
 */
function parseLabelOverrides(raw: unknown): LabelOverride[] {
  if (!Array.isArray(raw)) return [];
  const out: LabelOverride[] = [];
  for (const row of raw as unknown[]) {
    if (!row || typeof row !== 'object') continue;
    const { key, label } = row as LabelOverride;
    if (typeof key === 'string' && key && typeof label === 'string' && label) out.push({ key, label });
  }
  return out;
}

/**
 * The configured automatic sort hierarchy, and the write behind Settings → Automatische
 * Sortierung. The single boundary where `task_sort` is read — consumers never touch the raw
 * setting.
 */
export function useTaskSort(): { value: TaskSortRule[]; write: (next: TaskSortRule[]) => Promise<boolean> } {
  return useSettingsArray('task_sort', parseSortRules);
}

/** Read-only view of the same hierarchy, for the tables that only apply it. */
export function useTaskSortRules(): TaskSortRule[] {
  return useTaskSort().value;
}

/**
 * Resolves a heading id to its text: the user's override if there is one, else the default
 * from `LABEL_DEFAULTS`. A key this build does not know is ignored rather than rendered.
 */
export function useLabel(): (key: LabelKey) => string {
  const { value } = useSettingsArray('labels', parseLabelOverrides);
  const overrides = useMemo(
    () => new Map(value.filter((r) => isLabelKey(r.key)).map((r) => [r.key, r.label])),
    [value],
  );
  return useCallback((key: LabelKey) => overrides.get(key) ?? LABEL_DEFAULTS[key], [overrides]);
}

/**
 * Renames a heading. Passing an empty string — or the default text — drops the override row
 * instead of storing a redundant one, which is what makes clearing the field a reset.
 */
export function useRenameLabel(): (key: LabelKey, label: string) => Promise<void> {
  const { value, write } = useSettingsArray('labels', parseLabelOverrides);
  return useCallback(
    async (key: LabelKey, label: string) => {
      const trimmed = label.trim();
      const rest = value.filter((r) => r.key !== key);
      await write(!trimmed || trimmed === LABEL_DEFAULTS[key] ? rest : [...rest, { key, label: trimmed }]);
    },
    [value, write],
  );
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

export interface UndoablePatchArgs<T extends { id: ID }, U> {
  /** Any `resource()` from api/client.ts — `U` is its write type, inferred from `update`. */
  res: { update: (id: ID, data: U) => Promise<unknown> };
  /** The row as it was *before* the edit — the inverse is picked off it. */
  row: T;
  /**
   * `NoInfer` so the resource decides `U`, not the patch: the payload is then checked against
   * the server's `writable` allowlist for that table rather than bidding for a type of its own
   * (CCL-24).
   */
  patch: NoInfer<U>;
  /** German, names the change: „Statusänderung“. */
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
export function useUndoablePatch(): <T extends { id: ID }, U>(
  args: UndoablePatchArgs<T, U>,
) => Promise<void> {
  const { push } = useUndo();
  const invalidate = useInvalidateAll();
  return useCallback(
    async <T extends { id: ID }, U>({ res, row, patch, label }: UndoablePatchArgs<T, U>) => {
      // The walk is by key, which no generic signature can follow — `Object.keys` is `string[]`
      // and the row is only as typed as the row. Three untyped views over objects this function
      // never constructs, and one assertion on the result. Sound because every `…Update` type
      // widens its row type (api/types.ts), so a set of raw row values is always a legal patch
      // for that resource — the invariant to preserve when editing those types.
      const before = row as Record<string, unknown>;
      const after = patch as Record<string, unknown>;
      const patchKeys = Object.keys(after);
      const derived = (DERIVED_INVERSE_KEYS.get(res) ?? []).filter((k) => k in row);
      const inverse: Record<string, unknown> = {};
      for (const k of [...new Set([...patchKeys, ...derived])]) inverse[k] = before[k];

      const apply = async () => {
        await res.update(row.id, patch);
        await invalidate();
      };
      const revert = async () => {
        await res.update(row.id, inverse as U);
        await invalidate();
      };

      await apply();
      // Saving a dialog without touching anything shouldn't consume an undo step.
      if (patchKeys.some((k) => !Object.is(before[k], after[k]))) push({ label, apply, revert });
    },
    [push, invalidate],
  );
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
  return useCallback(
    async ({ label, remove, restore }: UndoableDeleteArgs) => {
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
    },
    [pushWithToast, toast, report, invalidate],
  );
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
