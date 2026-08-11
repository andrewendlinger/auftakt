import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import { signalMounted, signalReady } from '../boot';

/**
 * Longest the bootstrap queries may hold the reveal.
 *
 * Also the escape hatch for a race that would otherwise hang: when a first-load query
 * fails, React Query retries once with roughly a second of backoff (see the `retry`
 * option in main.tsx), so `useIsFetching()` would not reach 0 for seconds. Expiring here
 * reveals the page's own ErrorState instead, which is what the user should be looking at.
 */
const DATA_BUDGET_MS = 700;

/** Enough of an idle slot to be confident the thread is free, but never a hang. */
const IDLE_TIMEOUT_MS = 300;

/**
 * Tells the boot screen when the app is mounted and when it is ready. Renders nothing.
 *
 * Mounted **inside `QueryClientProvider`** (it needs `useIsFetching`) and **outside
 * `ErrorBoundary`**, so a route that throws cannot unmount the component responsible for
 * revealing the app.
 *
 * Two components rather than one so that the watching can *stop*. `useIsFetching()`
 * subscribes to the query cache for as long as it is mounted, and its snapshot is a scan
 * of every cached query, re-run on every notification — each fetch start and end, each
 * `setQueryData`, and every observer added or removed by any of the app's ~33 query sites
 * on every route change. The cache only grows over a session. All of that would have run
 * for the whole life of the window, re-rendering this component and re-scheduling an idle
 * callback whose `signalReady()` has been an idempotent no-op since the first second. The
 * boot signals are the one thing here that matters, and once `ready` has been sent there
 * is nothing left for the watcher to observe, so it leaves the tree.
 */
export function BootReady(): ReactElement | null {
  // The attribute, not the event, for the initial value: it is already set if a failure
  // path signalled before this ever mounted.
  const [done, setDone] = useState(() => document.documentElement.dataset.appReady === '1');

  useEffect(() => {
    if (done) return;
    const finish = (): void => setDone(true);
    // Listening rather than acting on the calls below, because signalReady() also arrives
    // from outside this component: signalFailed() on a collapse above the ErrorBoundary.
    document.addEventListener('auftakt:ready', finish, { once: true });
    return () => document.removeEventListener('auftakt:ready', finish);
  }, [done]);

  return done ? null : <BootWatcher />;
}

/**
 * Route-agnostic by construction: `useIsFetching()` counts every query in the client, so
 * this behaves the same on `#/`, on `#/dashboard`, and on whatever deep hash route the
 * window happens to restore to — without any page component knowing it exists.
 */
function BootWatcher(): null {
  const inFlight = useIsFetching();
  // useIsFetching() reads 0 on the first render, before the route's queries have
  // registered. Without this latch "nothing is fetching" would be true one tick after
  // mount and the app would be revealed with no data in it.
  const sawFetch = useRef(false);
  if (inFlight > 0) sawFetch.current = true;

  useEffect(() => {
    // Two frames, not a bare effect: an effect runs after commit but *before* the
    // browser paints it, so signalling there would hand the boot screen a tree that has
    // not been drawn yet and cross-fade to a blank window.
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(signalMounted);
    });
    const budget = setTimeout(signalReady, DATA_BUDGET_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(budget);
    };
  }, []);

  useEffect(() => {
    if (inFlight > 0 || !sawFetch.current) return;
    // requestIdleCallback does not fire while the main thread is busy, which is exactly
    // the condition the gesture needs and the reason this is not just a timeout. The
    // timeout argument is mandatory: idle callbacks can be starved indefinitely, and
    // "never animate on a busy thread" must not become "never reveal the app".
    if (typeof requestIdleCallback !== 'function') {
      signalReady();
      return;
    }
    const handle = requestIdleCallback(() => signalReady(), { timeout: IDLE_TIMEOUT_MS });
    return () => cancelIdleCallback(handle);
  }, [inFlight]);

  return null;
}
