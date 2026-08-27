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
 * `queueWrite` at the bottom is the same bookkeeping turned on the writes themselves: those same
 * stores persist their whole value every time, so two of them in flight at once are decided by
 * whichever the server happens to apply last (WP-82). See there.
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

/**
 * The promise a *new* write on this key has to wait behind — the tail of its queue. Empty for a
 * key with nothing in flight, so the common case queues behind nothing and costs one microtask.
 */
const tails = new Map<string, Promise<unknown>>();

const noop = () => {};

/**
 * Send one key's writes **one at a time**, in the order they were made.
 *
 * `trackPending` above is about *reads*: it makes a refresh wait for a write to be answered. This
 * is the write-against-write half, and it exists because the stores that publish optimistically
 * (SHL-10) all persist their **whole** value on every change. Three toggles inside one round trip
 * are three concurrent PATCHes carrying a one-, a two- and a three-key map, and the server keeps
 * whichever it applies *last* — which nothing orders. Against localhost the writes settle between
 * two clicks and the question never comes up; hold the PATCH back the way the browser gate does
 * and the three race on three sockets. Measured on the demo, releasing all three at the same
 * instant: 2 of 10 runs ended with the server holding write 2's map, the page correctly showing
 * it, and one of the three columns visibly back (WP-82).
 *
 * Composition is not what this fixes — the caller composes from its own last intent before it gets
 * here, and publishes optimistically, so the screen is still instant. What it fixes is the
 * *arrival* order: write *n+1* is not sent until write *n*'s whole `run` has settled, so the last
 * map the server sees is the last one the user asked for.
 *
 * **What „settled" covers is the caller's business, and it is more than the PATCH.**
 * `useEntityColumns` puts its `invalidate()` inside `run`, so a burst there also serialises the
 * refetches — where overlapping invalidates used to cancel each other down to roughly one
 * (`cancelRefetch`, see the WP-82 entry in `docs/VERIFYING.md`), each now completes. Nothing awaits
 * `setVisible`, so none of that reaches the screen; at localhost latency it is tens of
 * milliseconds of background work per toggle. A caller that wants only the write ordered should
 * keep its refetch outside the closure.
 *
 * **The cost of ordering is that one wedged write parks the rest.** `run` is awaited, and the
 * client's `fetch` carries no timeout, so a request the server accepts and never answers leaves
 * this key's queue stopped while the optimistic cache goes on saying the writes worked. Before,
 * one wedged request lost one write. Judged the better trade — a hung local socket means the app
 * is already broken — but it is the honest price.
 *
 * Deliberately keyed like `trackPending` but held in its own map: a store only has to queue behind
 * writes that rewrite the same value, and two stores writing different columns of the same row do
 * not overwrite each other.
 */
export function queueWrite<T>(key: string, run: () => Promise<T>): Promise<T> {
  const mine = (tails.get(key) ?? Promise.resolve()).then(run);
  // The stored tail is the *swallowed* promise: a write that rejected is still finished, and a
  // queue that stalled on one failure would strand every write made after it.
  const tail = mine.then(noop, noop);
  tails.set(key, tail);
  void tail.then(() => {
    // The identity test is load-bearing, not tidying. An unconditional delete here lets a write
    // registered *after* an early one settled chain on `Promise.resolve()` and race a sibling that
    // is still in flight — WP-82's bug again, reintroduced by one token. Covered by
    // „still queues behind a write in flight, even after an earlier one has drained"; a burst
    // registered in one tick never reaches it, because no cleanup has run yet.
    if (tails.get(key) === tail) tails.delete(key);
  });
  return mine;
}

/** Test seam — both maps are module state and would otherwise leak between cases. */
export function clearPending(): void {
  pending.clear();
  tails.clear();
}
