/**
 * Writes that have published optimistically and not yet been answered, by query key.
 *
 * `refetchNow` (hooks.ts) exists because a cached read says nothing about what another *window*
 * wrote. It introduced the opposite hazard for the stores that have no server-side conflict
 * guard: a real GET says nothing about what *this* window wrote a millisecond ago either, and
 * unlike the cache it can be behind it.
 *
 * That is not hypothetical bookkeeping. `useSettingsArray.write` publishes its array into the
 * cache and *then* awaits the PATCH — deliberately, so a second edit inside the round trip
 * composes (SHL-10) — and `removalUndoEntry.revert` opens with `await store.refresh?.()` and then
 * reads `current()`. Press 🗑 and Cmd+Z straight after it, and the refresh could GET the
 * pre-removal layout over the optimistic tombstone, find no `hidden` entry and throw „layout
 * entry … is no longer hidden" — reporting a failure for a removal that happened.
 *
 * All three stores register, the landing included. Its generation guard makes the *write* safe —
 * nothing can be lost — but `revert` reads before it writes, and a read is what this is about.
 * `landingUpdate` is the one caller that must NOT go through `refetchNow` for its own read: it is
 * itself the pending write on `['landing']`, so waiting would be waiting for itself.
 *
 * So a refresh waits for this window's own writes to be answered, and only then asks. It does not
 * wait for writes registered *after* it started: those are a later state, not a race it should
 * lose to.
 *
 * Module state on purpose — the writer and the reader are often different components (an undo arm
 * runs from a page the store no longer lives on), so a ref would not reach across them.
 */

const pending = new Map<string, Set<Promise<unknown>>>();

/** Query keys are arrays; this is their identity for the map. */
export function pendingKey(queryKey: readonly unknown[]): string {
  return JSON.stringify(queryKey);
}

/** Register an in-flight write and hand its promise straight back, so callers can `return` it. */
export function trackPending<T>(key: string, run: Promise<T>): Promise<T> {
  let set = pending.get(key);
  if (!set) pending.set(key, (set = new Set()));
  set.add(run);
  // Settled either way: a rejected write is no longer in flight, and leaving it in the set would
  // make every later refresh await a promise that can never clear.
  const done = () => {
    const current = pending.get(key);
    if (!current) return;
    current.delete(run);
    if (!current.size) pending.delete(key);
  };
  void run.then(done, done);
  return run;
}

/** Resolve once every write registered *now* has settled. Resolves immediately when there are none. */
export async function settlePending(key: string): Promise<void> {
  const set = pending.get(key);
  if (!set?.size) return;
  await Promise.allSettled([...set]);
}

/** Test seam — the map is module state and would otherwise leak between cases. */
export function clearPending(): void {
  pending.clear();
}
