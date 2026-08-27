import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { api } from './api/client';
import type {
  Artist,
  ColumnOverrides,
  CustomColumn,
  CustomColumnOption,
  ID,
  LabelOverride,
  LandingContent,
  LandingDocInput,
  LandingPatch,
  OptionUsage,
  Project,
  Settings,
  SettingsArrayKey,
  SettingsArrayValue,
  Task,
  TaskSortRule,
  WritableSettings,
} from './api/types';
import { doneValueOf } from './api/types';
import { postBroadcast } from './lib/broadcast';
import { retryOnConflict } from './lib/conflict';
import { errorMessage } from './lib/errors';
import { pendingKey, queueWrite, settlePending, trackPending } from './lib/pending';
import { DEFAULT_EVENT_WINDOW_DAYS } from './lib/eventGroups';
import { LABEL_DEFAULTS, isLabelKey, type LabelKey } from './lib/labels';
import { getWindowSeason } from './lib/season';
import { normalizeEventTypeOptions, normalizeSelectOptions } from './lib/selectOptions';
import { parseColumnOverrides, withColumnVisible } from './lib/taskColumns';
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
 * memo, which hands React a new component *type* for every cell — and React answers that by
 * unmounting and remounting every cell subtree in the table. Measured on the demo season: one
 * „＋ Unteraufgabe" click, which changes no data at all, remounted all 60 data cells, and a
 * background refetch destroyed an open Titel editor together with the text being typed into it
 * (removing a focused node fires no blur, so nothing committed it) — TTU-12, TTU-38.
 *
 * The consumers do their half (`useCallback`/`useMemo` with honest dep lists); this file has to
 * do the other half or theirs is inert.
 */

/**
 * The dataset is tiny and local, so invalidating everything on write is simplest and instant.
 * The write is also broadcast to every other window (the listener in main.tsx invalidates
 * there) — a write path that bypasses this hook opts out of cross-window freshness, which is
 * the second reason every write goes through it.
 */
export function useInvalidateAll(): () => Promise<void> {
  const qc = useQueryClient();
  return useCallback(() => {
    postBroadcast({ v: 1, type: 'invalidate' });
    return qc.invalidateQueries();
  }, [qc]);
}

/**
 * A refresh that actually goes to the server. **Reach for this, not `ensureQueryData`, wherever a
 * store is about to be read and then written back.**
 *
 * `ensureQueryData` hands back whatever is cached whenever an entry exists — `revalidateIfStale`
 * is off by default and `staleTime` does not enter into it. That is enough for the hole it was
 * added for (react-query drops a query `gcTime` after its last observer unmounts, five minutes,
 * and an undo pressed from another screen then reads the miss as an empty store), but it cannot
 * see what another *window* wrote, and the landing content is on `#/` in every one of them. Two
 * windows computing an array from the same cached read overwrote each other silently, with no
 * Papierkorb behind seasons.json (WP-53).
 *
 * `staleTime: 0` overrides the client-wide five seconds for this call only, so the request is
 * unconditional rather than „unless it looks recent enough".
 *
 * It also **rejects** where a warm-cache `ensureQueryData` could not, and that is wanted: the
 * throw lands before anything is written, so a failed refresh leaves the store untouched. An undo
 * that reports a failure beats one that writes a stale array over the truth.
 *
 * The `settlePending` wait is the other half of asking for real. A GET is authoritative about
 * other windows and *behind* on this one: `useSettingsArray.write` publishes its array before
 * awaiting the PATCH, so a refresh fired inside that gap would read the pre-write state over the
 * optimistic value — and `removalUndoEntry.revert` refreshes and then looks for the tombstone it
 * just wrote. See `lib/pending.ts`; the landing needs none of this, since its generation makes
 * the server authoritative about every window including this one.
 */
export function refetchNow<T>(
  qc: QueryClient,
  queryKey: QueryKey,
  queryFn: () => Promise<T>,
): Promise<T> {
  return settlePending(pendingKey(queryKey as readonly unknown[])).then(() =>
    qc.fetchQuery({ queryKey, queryFn, staleTime: 0 }),
  );
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
 * The seasons.json registry — the season list, which one is active, and the renameable term.
 *
 * The single reader of `['seasons']`, the way `useSettings` is the single reader of
 * `['settings']`. The same `useQuery` literal used to be written out in six places, so giving
 * the query a `staleTime`, a `select` or a `placeholderData` — to stop the switcher flashing
 * during season activation, say — meant finding and editing all six, and missing one left that
 * component on the old behaviour (CCL-28). Returns the whole result, since the landing page
 * needs `isLoading`/`isError`/`refetch` and not just the data.
 */
export function useSeasons() {
  return useQuery({ queryKey: ['seasons'], queryFn: api.seasons });
}

/**
 * The season THIS WINDOW shows: the sessionStorage pin, with the registry default as the
 * pre-pin fallback (a fresh window's requests resolve the default until the first response
 * echo pins it, so the fallback names the same season). The pin only ever changes together
 * with a full document reload (switchSeason, seasonGone), so reading it during render
 * cannot go stale.
 */
export function useCurrentSeasonId(): number | undefined {
  const { data } = useSeasons();
  return getWindowSeason() ?? data?.activeId;
}

/**
 * The window's season's name, read from the seasons.json registry — the one place a rename
 * always lands. The per-season `settings.saison` row is *not* it: it is a mirror the rename
 * writes best-effort into the season's own file, after the registry save and without failing
 * the rename if it does not land. Reading that row instead left the season-scope label in the
 * task table and the kicker on the printed one-pagers disagreeing with the switcher and the
 * landing card, with no in-app way to repair it (CCL-06). The setting stays as the file's own
 * self-description (seed/demo).
 *
 * Rides on the ['seasons'] query the header switcher already fetches on every page.
 *
 * Empty until the registry answers, and empty for good if it never does. The old `'Auftakt'`
 * fallback is not a name the server can ever store — every season overwrites it with its registry
 * label — so it was a placeholder that a failed `GET /api/seasons` left on screen indefinitely,
 * including as the kicker of a printed one-pager. Consumers drop the fragment instead (CCL-33).
 */
export function useSaison(): string {
  const { data } = useSeasons();
  // useCurrentSeasonId owns the pin-with-default rule; spelling it out a second time here left
  // the header chip and this label free to disagree the moment the rule changed (PR50-11).
  const current = useCurrentSeasonId();
  return data?.seasons.find((s) => s.id === current)?.label ?? '';
}

/**
 * The user-renameable word for a season („Saison"/„Saisons" by default, e.g. „Jahr"/
 * „Jahre"). Stored in the seasons.json registry — app-global, not per season — and
 * rides on the ['seasons'] query the header switcher already fetches on every page.
 */
export function useSeasonTerm(): { singular: string; plural: string } {
  const { data } = useSeasons();
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

/** The owner of a scoped column set — an artist page or a project page (WP-51). */
export type ColumnOwner = { scope: 'artist'; id: ID } | { scope: 'project'; id: ID };

/**
 * One entity page's task columns: the global set plus that page's own, in `compareColumns` order.
 *
 * Both entity pages go through here rather than each writing the query out, because the two
 * halves have to agree on three things at once — the scope sent, the parent id sent with it (the
 * server 400s a scoped list without one), and that the globals lead the merged list. A second
 * copy of that is a second place for the artist page and the project page to drift apart.
 *
 * The merged list is the whole return value. `CustomColumnManager` takes it as-is and re-derives
 * the group it manages by scope, so the page's own columns are never threaded as a second list
 * that could disagree with the first about what is in it.
 */
export function useScopedColumns(owner: ColumnOwner, enabled = true): CustomColumn[] {
  const globals = useGlobalColumns();
  const { data: scoped = [] } = useQuery({
    queryKey: ['customColumns', owner.scope, owner.id],
    queryFn: () =>
      api.customColumns.list(
        owner.scope === 'artist'
          ? { scope: 'artist', artist_id: owner.id }
          : { scope: 'project', project_id: owner.id },
      ),
    enabled,
  });
  return useMemo(() => [...globals, ...scoped], [globals, scoped]);
}

/** One page's task-column visibility, plus the two ways to change it (WP-59). */
export interface EntityColumnsStore {
  /** This page's departures from the season default; `{}` means it follows it outright. */
  overrides: ColumnOverrides;
  /** Whether anything is stored — what „Auf Saison-Vorgabe zurücksetzen" is offered for. */
  hasOwn: boolean;
  /** Show or hide one column **on this page**. Returns whether the write landed. */
  setVisible: (col: CustomColumn, visible: boolean) => Promise<boolean>;
  /** Back to `NULL` — the page follows the season default again. */
  reset: () => Promise<boolean>;
}

/**
 * One artist's or one project's own task-column visibility (WP-59), the same „per entity, with a
 * season-wide template" shape `useEntityLayout` has for sections: `NULL` means „never configured"
 * and reads as `custom_columns.enabled`, so a database from before the column renders exactly as
 * it did. What is stored is a *sparse* map, so a column added in Einstellungen afterwards still
 * reaches a page that has been configured — see `ColumnOverrides` for why that is the safe default.
 *
 * The `[kind, id]` cache is published **before** the request is awaited, for the reason
 * `useEntityLayout` and `useSettingsArray` do it: the natural way to use this dialog is to toggle
 * three columns in a row, and each write persists the whole map, so a second toggle computed from
 * the pre-first-toggle value would silently undo it (SHL-10).
 *
 * `pending` closes the other half of the same race, which the layout store answers with
 * `trackPending`: `invalidate()` refetches this entity, and a refetch issued after write *n* can
 * land while write *n+1* is still out — republishing the older map over the newer one. The next
 * toggle would then be computed from it. Holding the last intent in a ref until the write it
 * belongs to has settled makes the composition true for the whole burst, not just within one
 * round trip.
 *
 * Both of those are about what this window *computes*. `queueWrite` closes the third one, which is
 * about what the **server** ends up with: composed or not, three toggles inside one round trip are
 * three PATCHes carrying a one-, a two- and a three-key map, and nothing orders them — the map
 * that survives is whichever arrives last. Sending them one at a time is what makes the last map
 * stored the last map asked for (WP-82; `lib/pending.ts` has the measurement).
 */
export function useEntityColumns(
  kind: 'artist' | 'project',
  row: Artist | Project | undefined,
): EntityColumnsStore {
  const qc = useQueryClient();
  const guard = useGuardedAction();
  const invalidate = useInvalidateAll();
  const id = row?.id;
  const raw = row?.task_columns;
  const overrides = useMemo(() => parseColumnOverrides(raw), [raw]);
  const pending = useRef<ColumnOverrides | null>(null);

  const patch = useCallback(
    async (next: ColumnOverrides | null, fallback: string) => {
      if (id == null) return false;
      pending.current = next ?? {};
      const mine = pending.current;
      qc.setQueryData([kind, id], (old: unknown) =>
        old && typeof old === 'object'
          ? { ...(old as object), task_columns: next && JSON.stringify(next) }
          : old,
      );
      const res = kind === 'artist' ? api.artists : api.projects;
      // Queued on the *field*, not just the row: what may not overtake this write is another write
      // of the same whole map, and a layout write to the same row rewrites a different column.
      return queueWrite(pendingKey([kind, id, 'task_columns']), async () => {
        const okay = await guard(fallback, () => res.update(id, { task_columns: next }));
        await invalidate();
        // Only the last write clears the latch; an earlier one settling must not hand the next
        // toggle back to whatever the refetch above published.
        if (pending.current === mine) pending.current = null;
        return okay;
      });
    },
    [qc, kind, id, guard, invalidate],
  );

  const setVisible = useCallback(
    (col: CustomColumn, visible: boolean) =>
      patch(
        withColumnVisible(pending.current ?? overrides, col, visible),
        'Die Spalte konnte nicht geändert werden.',
      ),
    [patch, overrides],
  );
  const reset = useCallback(
    () => patch(null, 'Die Spalten konnten nicht zurückgesetzt werden.'),
    [patch],
  );

  return {
    overrides,
    hasOwn: Object.keys(overrides).length > 0,
    setVisible,
    reset,
  };
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
    return { metrics, windowDays: windowDaysOr(data?.attention_window_days, DEFAULT_ATTENTION_DAYS) };
  }, [data?.task_stats, data?.attention_window_days]);
}

/**
 * A „Zeitfenster" setting → a usable number. Both windows are stored as scalar strings and both
 * are clamped to [1, 365] here, so a hand-edited row or a value from an older build cannot escape
 * at either end. Unset falls back — the server stores no default for either (`Number(undefined)`
 * is NaN, which takes the same branch).
 */
function windowDaysOr(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.round(n), 365) : fallback;
}

/**
 * How far „Nächste Termine" looks ahead before the rest collapses under „Danach" — the single
 * boundary where `event_window_days` is parsed. It decides where the divider falls, not what the
 * dashboard fetches: nothing is hidden past it (WP-33). Separate from `useTaskStatsConfig` on
 * purpose — that hook's subject is the task prefs, and the two windows are independent.
 */
export function useEventWindowDays(): number {
  const { data } = useSettings();
  return useMemo(
    () => windowDaysOr(data?.event_window_days, DEFAULT_EVENT_WINDOW_DAYS),
    [data?.event_window_days],
  );
}

/**
 * Fallbacks for the render before `['settings']` first resolves. They match server/src/db.ts
 * and exist only so the copy never says „nach undefined Tagen" for one frame — the values the
 * user sees come from the server (PGS-24).
 */
const RETENTION_FALLBACK = { archive: 30, purge: 30 };

/**
 * How long the server keeps things, in days — `ARCHIVE_AFTER_DAYS` (a done task leaves the live
 * views) and `PURGE_AFTER_DAYS` (a trashed row is hard-deleted), spliced into the settings
 * response. The single boundary for both, so no German string states a retention policy the app
 * does not follow (PGS-24).
 */
export function useRetention(): { archiveAfterDays: number; purgeAfterDays: number } {
  const { data } = useSettings();
  return {
    archiveAfterDays: data?.archive_after_days ?? RETENTION_FALLBACK.archive,
    purgeAfterDays: data?.purge_after_days ?? RETENTION_FALLBACK.purge,
  };
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
 *
 * **Two writes, and which one a caller takes is the whole cross-window story** (WP-R5).
 * `update(fn)` computes from what the server holds and sends the generation it read, so a
 * concurrent write is merged instead of destroyed; `write(next)` posts a snapshot
 * unconditionally, last writer wins. Take `update` whenever the change is a function of the
 * stored array — which is what makes it retryable — and `write` only where the next array is
 * assembled somewhere this hook cannot re-run (a controlled editor's `onChange`).
 */
export function useSettingsArray<K extends SettingsArrayKey>(
  key: K,
  parse: (raw: unknown) => SettingsArrayValue<K>,
): {
  value: SettingsArrayValue<K>;
  /** The array as it is now, not as it was when the caller rendered — the `useLanding` twin. */
  current: () => SettingsArrayValue<K>;
  /** Re-read `['settings']` from the server first, so `current()` reads neither an eviction nor
   *  another window's leftovers. */
  refresh: () => Promise<void>;
  /**
   * Compute the next array from the one the **server** holds, and refuse to overwrite a newer
   * generation — `useLanding().update` for settings (WP-R5). Reach for this wherever the change
   * is expressible as a function of the stored array; `write` is for the editors that hand over
   * an array assembled somewhere else. `null` means „nothing to write" and skips the request.
   */
  update: (
    fn: (cur: SettingsArrayValue<K>) => SettingsArrayValue<K> | null,
  ) => Promise<boolean>;
  write: (next: SettingsArrayValue<K>) => Promise<boolean>;
} {
  const qc = useQueryClient();
  const { data } = useSettings();
  const guard = useGuardedAction();
  const invalidate = useInvalidateAll();
  const raw = data?.[key];
  const value = useMemo(() => parse(raw), [raw, parse]);
  // Same reasoning as `useLanding.current()`: an undo runs up to six seconds after the render
  // that created it, by which time `value` names an array the user has since edited. Reading
  // the cache instead is what keeps the two composable — `write` publishes there before it
  // awaits, so this also sees a write that is still in flight.
  const current = useCallback(
    () => parse(qc.getQueryData<Settings>(['settings'])?.[key]),
    [qc, key, parse],
  );
  // …and the other half of that: react-query drops a query `gcTime` after its last observer
  // unmounts (five minutes, the default — `main.tsx` sets only `staleTime`), and `current()`
  // then reads the miss as an empty array. A closure that outlives its page — the section
  // removal undo, pressed from the keyboard elsewhere in the app — awaits this first.
  //
  // **This shrinks the two-window race; `update` is what closes it** (WP-53 → WP-R5). The
  // `settings` table carries a generation since WP-R5, so a write that names it is refused
  // rather than allowed to replace a newer array — but only `update` names it. `write` still
  // posts a whole array computed by its caller, so two windows can still each replace the
  // other's `dashboard_layout`; that stays the deliberate stop it was, because an array
  // assembled in an editor is not an intent a retry could re-apply, and a lost configuration
  // edit is on screen and one gesture from being redone.
  const refresh = useCallback(async () => {
    await refetchNow(qc, ['settings'], api.getSettings);
  }, [qc]);
  const write = useCallback(
    async (next: SettingsArrayValue<K>) => {
      // `{ [key]: next }` with a generic key infers a string index signature, not
      // `Pick<WritableSettings, K>` — and an index signature satisfies an all-optional target
      // vacuously, so it would compile whatever `key` held. The guarantee comes from the
      // `K extends SettingsArrayKey` constraint; the assertion is what states that shape and
      // what breaks if `Settings[K]` and `next` ever stop agreeing.
      const patch = { [key]: next } as Pick<WritableSettings, K>;
      qc.setQueryData<Settings>(['settings'], (old) => (old ? { ...old, ...patch } : old));
      // Registered while it is in flight, so a `refresh()` issued inside this round trip — an
      // undo pressed straight after the click that started it — waits rather than reading the
      // pre-write server state over the value published above (lib/pending.ts).
      return trackPending(
        pendingKey(['settings']),
        (async () => {
          const ok = await guard('Einstellung konnte nicht gespeichert werden.', async () => {
            qc.setQueryData<Settings>(['settings'], await api.patchSettings(patch));
          });
          await invalidate();
          return ok;
        })(),
      );
    },
    [qc, key, guard, invalidate],
  );
  const update = useCallback(
    (fn: (cur: SettingsArrayValue<K>) => SettingsArrayValue<K> | null) =>
      trackPending(
        pendingKey(['settings']),
        (async () => {
          const ok = await guard('Einstellung konnte nicht gespeichert werden.', () =>
            retryOnConflict(async (conflict) => {
              // The 409 carries the settings the write lost to, so a retry costs no extra GET.
              // `fetchQuery`, not `refetchNow`: this call *is* the pending write on
              // `['settings']`, and waiting for itself to settle would never return.
              const cur =
                conflictSettings(conflict) ??
                (await qc.fetchQuery<Settings>({
                  queryKey: ['settings'],
                  queryFn: api.getSettings,
                  staleTime: 0,
                }));
              const next = fn(parse(cur[key]));
              // A mutation that turns out to be a no-op writes nothing rather than storing the
              // array as itself: that would bump the generation for no reason and could refuse
              // another window's in-flight write over a change nobody made.
              if (next === null) return;
              const patch = { [key]: next } as Pick<WritableSettings, K>;
              // Published before awaiting for the same reason `write` does it (SHL-10) — though
              // here it is cosmetic, since every write reads for itself.
              qc.setQueryData<Settings>(['settings'], (old) => (old ? { ...old, ...patch } : old));
              qc.setQueryData<Settings>(['settings'], await api.patchSettings(patch, cur.rev));
            }),
          );
          // Also on the failure path: the optimistic value must not outlive a refused write.
          await invalidate();
          return ok;
        })(),
      ),
    [qc, key, parse, guard, invalidate],
  );
  return { value, current, refresh, update, write };
}

/**
 * The settings a refused write lost to, off the 409 the server answered with. `undefined` for
 * anything else, including a 409 without a body — the caller then falls back to a plain read, so
 * a server that stops sending it costs a round trip rather than correctness.
 */
function conflictSettings(err: unknown): Settings | undefined {
  return (err as { body?: { settings?: Settings } } | undefined)?.body?.settings;
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
 *
 * **`update` is the only way to write, and it takes a function, not an array** (WP-53). Per
 * attempt it re-reads the blob from the server, hands that to `fn`, and sends the resulting patch
 * stamped with the generation it read. If another window has written in between, the server
 * refuses with 409 and the whole thing runs again against what is actually stored — so a
 * concurrent write is merged rather than destroyed, and after `MAX_CONFLICT_ATTEMPTS` it is
 * reported rather than lost. Taking an array instead would defeat that: the retry can only
 * re-apply an *intent*, and every mutation on the landing page is already written as one
 * (`now.filter(…)`, `[...now, added]`, `arrayMoveTo(now, …)`).
 *
 * That the read is authoritative also retires a whole class rather than guarding against it: an
 * evicted `['landing']` used to read as „no documents" and then get *written back*, which is what
 * SHL-01/02/03 were, and no closure has to remember to `refresh()` first any more.
 *
 * Unlike `useSettingsArray` this **throws** instead of guarding: `useUndoableDelete`,
 * `RecordFormModal`, `InlineNotes` and `EditableText` all own a catch → German toast already,
 * and swallowing the rejection here would raise a „Rückgängig" toast for a delete that never
 * happened. An exhausted retry budget arrives there as the server's own German sentence.
 */
export function useLanding(): {
  data: LandingContent | undefined;
  /** The content as it is now, not as it was when the caller rendered. */
  current: () => LandingContent | undefined;
  /** Re-read `['landing']` from the server, so `current()` reads neither an eviction nor another
   *  window's leftovers. `update` does this itself — this is for the `LayoutStore` contract,
   *  whose undo arms read through `current()`. */
  refresh: () => Promise<void>;
  /** Compute the patch from the content as the server has it. See the note above. `null` means
   *  „nothing to write" and skips the request — a refused drag is the caller for it. */
  update: (fn: (cur: LandingContent) => LandingPatch | null) => Promise<LandingContent>;
} {
  const qc = useQueryClient();
  const invalidate = useInvalidateAll();
  const { data } = useQuery({ queryKey: ['landing'], queryFn: api.landing.get });
  const current = useCallback(() => qc.getQueryData<LandingContent>(['landing']), [qc]);
  // The `useSettingsArray.refresh` twin, and the landing needs it more: `current()` answering
  // `undefined` is not merely a refused undo there — the arranger's store adapter falls back to
  // `DEFAULT_LANDING_LAYOUT`, so a redo computed from an evicted cache would write that default
  // over the arrangement the user actually has.
  const refresh = useCallback(async () => {
    await refetchNow(qc, ['landing'], api.landing.get);
  }, [qc]);
  const update = useCallback(
    (fn: (cur: LandingContent) => LandingPatch | null) =>
      // Registered for the length of the write, so the layout store's `refresh()` — which
      // `removalUndoEntry.revert` runs before looking for the tombstone it just wrote — waits
      // instead of reading pre-write server state over the optimistic publish below. The
      // generation guard keeps the *write* safe; this keeps a concurrent *read* honest.
      trackPending(pendingKey(['landing']), landingUpdate(qc, invalidate, fn)),
    [qc, invalidate],
  );
  return { data, current, refresh, update };
}

async function landingUpdate(
  qc: QueryClient,
  invalidate: () => Promise<void>,
  fn: (cur: LandingContent) => LandingPatch | null,
): Promise<LandingContent> {
  try {
    return await retryOnConflict(async (conflict) => {
      // The 409 already carries what the write lost to, so the retry costs no extra GET;
      // the fetch is for the first attempt, and for a server too old to send the content.
      // `fetchQuery` directly and not `refetchNow`: this call *is* the pending write on
      // `['landing']`, and waiting for itself to settle would never return.
      const cur: LandingContent =
        conflictContent(conflict) ??
        (await qc.fetchQuery<LandingContent>({
          queryKey: ['landing'],
          queryFn: api.landing.get,
          staleTime: 0,
        }));
      const next = fn(cur);
      // A mutation that turns out to be a no-op writes nothing rather than storing the list as
      // itself: the write would bump the generation for no reason and could refuse an in-flight
      // write in another window over a change nobody made.
      if (next === null) return cur;
      // Publish before awaiting, so the row appears at once instead of a round trip later.
      // Purely cosmetic now — a second edit issued inside this window does its own authoritative
      // read and, if it truly races, conflicts and retries — where it used to be the only thing
      // making two quick edits compose (SHL-10). Still skipped when the patch adds a row: ids are
      // the server's to assign and rendering an id-less row would break the list keys (and the
      // ✎/🗑 that address rows by id) for one request. The published value carries `cur.rev`, one
      // generation behind, which no reader consults — `update` never takes a rev from the cache.
      if (rowsAllHaveIds(next)) {
        qc.setQueryData<LandingContent>(['landing'], { ...cur, ...next } as LandingContent);
      }
      const res = await api.landing.patch(next, cur.rev);
      qc.setQueryData<LandingContent>(['landing'], res);
      return res;
    });
  } finally {
    // Also on the failure path: the optimistic value above must not outlive a rejected write.
    await invalidate();
  }
}

/**
 * The content a refused write lost to, off the 409 the server answered with. `undefined` for
 * anything else, including a 409 without a body — the caller then falls back to a plain read, so
 * a server that stops sending it costs a round trip rather than correctness.
 */
function conflictContent(err: unknown): LandingContent | undefined {
  return (err as { body?: { landing?: LandingContent } } | undefined)?.body?.landing;
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
 *
 * On `update`, not `write` (WP-R5): renaming one heading is an intent over the stored array —
 * „this key, that text, everything else as it stands" — so it can be re-applied to what another
 * window wrote instead of replacing it. It is also the array most likely to be edited from two
 * windows at once, since every page shows renameable headings.
 */
export function useRenameLabel(): (key: LabelKey, label: string) => Promise<void> {
  const { update } = useSettingsArray('labels', parseLabelOverrides);
  return useCallback(
    async (key: LabelKey, label: string) => {
      const trimmed = label.trim();
      await update((cur) => {
        const rest = cur.filter((r) => r.key !== key);
        return !trimmed || trimmed === LABEL_DEFAULTS[key] ? rest : [...rest, { key, label: trimmed }];
      });
    },
    [update],
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
  /**
   * Query-key prefix of the row itself — `['artist', 7]`, `['project', 3]` — for a row that has
   * a page of its own. Those queries are marked stale but **not asked for again**: see the
   * settle step below for why refetching a row we just deleted is never right.
   */
  gone?: readonly unknown[];
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
  const qc = useQueryClient();
  const invalidate = useInvalidateAll();
  return useCallback(
    async ({ label, remove, restore, gone }: UndoableDeleteArgs) => {
      /**
       * Refresh everything the delete could have changed — except the row it deleted.
       *
       * A record delete redirects off the page it happened on, but `navigate()` is a React
       * Router transition and does not commit before this runs: the DELETE round trip to
       * localhost is a couple of milliseconds and the unmount loses that race often enough to
       * be a bug report. A blanket invalidate then refetches the page's own `['artist', 7]`
       * while it is still mounted, the server answers 404 — correctly, the row is in the
       * Papierkorb — and `QueryCache.onError` (main.tsx) turns that into „Daten konnten nicht
       * aktualisiert werden. (not found)" next to the „gelöscht" toast. Nothing is wrong, and
       * the user is told something is.
       *
       * So the row's own keys are marked stale and left alone: nothing asks for a row we just
       * deleted. Stale rather than untouched matters — a later mount from a bookmark or the
       * history must still refetch and land on the `LoadError` panel (PGS-05) rather than
       * render a deleted record out of the cache.
       *
       * The redirect is still worth doing first (it is what keeps the page from flashing that
       * panel on the way out); it is just not a guarantee, and this does not depend on it.
       */
      const settle = async () => {
        if (!gone) return invalidate();
        const isGone = (key: readonly unknown[]) => gone.every((part, i) => Object.is(key[i], part));
        await qc.invalidateQueries({ queryKey: [...gone], refetchType: 'none' });
        await qc.invalidateQueries({ predicate: (q) => !isGone(q.queryKey) });
      };

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
      await settle();
      if (nothingDeleted(result)) {
        toast.show({ message: `${label} war bereits gelöscht` });
        return false;
      }
      pushWithToast(
        {
          label: `Löschen von ${label}`,
          // Redo re-deletes, and settles the same way — the row is gone again, so asking for it
          // again is the same mistake. Both halves refresh even when the call fails, so a list
          // can never keep showing a row the server no longer has. Restore takes the blanket
          // invalidate: the row is back and every list that dropped it needs it again.
          apply: async () => {
            try {
              await remove();
            } finally {
              await settle();
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
    [pushWithToast, toast, report, qc, invalidate],
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
