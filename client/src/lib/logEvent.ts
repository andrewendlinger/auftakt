/**
 * The renderer's one way into the app's runtime log (WP-69e).
 *
 * Under Electron a line handed to `window.auftakt.logEvent` ends up in `app-log.jsonl` in
 * userData, next to the boot reports and next to main's own failures — which is what the
 * diagnostics bundle carries, and therefore the only way a renderer error ever reaches a
 * maintainer. In the packaged app there is no console to look at: the window has no DevTools
 * affordance, so before this a React render error left exactly one trace, the German fallback
 * card the customer describes as „da stand irgendwas".
 *
 * **A no-op without the bridge**, twice optional-chained: browser dev has no `window.auftakt`
 * at all, and a packaged app whose preload predates this member has no `logEvent` on it. The
 * whole app is developed and driven in a browser (`npm run check:browser`, docs/VERIFYING.md),
 * so „does nothing there" is the normal case rather than the degraded one — and a logger that
 * threw in the browser would break the error paths it is wired into.
 *
 * **Both caps live here *and* in main**, on purpose. Main's are the ones that hold: this side
 * is the untrusted one, and a renderer wedged in a re-render loop is exactly the process whose
 * own bookkeeping cannot be relied on. These are the cheap half — they keep a burst from
 * becoming hundreds of IPC round trips before main gets to say no, and they keep the
 * *interesting* lines inside the run's budget: 200 identical „failed to fetch" lines spend a
 * log that could have held the one error underneath them.
 */

/** Repeats of one event+message inside this window collapse into the first. */
const DEDUPE_MS = 5_000;
/**
 * Sends per page life. „Page" and not „session": a reload starts a fresh renderer, and a
 * customer who reloads because something broke should get lines for what happens next.
 */
const MAX_SENDS = 50;

/** event+message → when it was last sent. Same idiom as the toast dedupe in `errors.ts`. */
const recent = new Map<string, number>();
let sent = 0;

/**
 * Write one line into the runtime log, if there is one to write into.
 *
 * `msg` is the human half — an error message, not a formatted report — and `stack` whatever
 * trace the caller has. Both are cut by `electron/appLog.ts` (500 and 3000 characters), so a
 * caller assembling a `stack` out of more than one source has to decide what may be lost
 * first; `ErrorBoundary` is the one that does.
 *
 * Silent past `MAX_SENDS`: the marker line saying so is main's to write, because it is the
 * side that can still write when this one cannot.
 */
export function logAppEvent(event: string, msg?: string, stack?: string): void {
  const bridge = window.auftakt?.logEvent;
  if (!bridge || sent >= MAX_SENDS) return;

  const now = Date.now();
  // Event names are this module's callers' own literals and none contains a `|`, so the two
  // halves cannot be confused for one another however a message reads.
  const key = `${event}|${msg ?? ''}`;
  for (const [k, at] of recent) if (now - at > DEDUPE_MS) recent.delete(k);
  if (recent.has(key)) return;
  recent.set(key, now);
  sent += 1;

  try {
    bridge({ event, msg, stack });
  } catch {
    /* a bridge that throws must not become a second error on top of the one being reported */
  }
}

/**
 * Message and stack of a thrown value, without trusting it to be an `Error`.
 *
 * The mirror of `errorFields` in `electron/main.ts`, and for the same reason: this runs inside
 * `window.onerror` and `unhandledrejection` handlers, where the value is whatever somebody
 * threw — a string, a DOM exception, `undefined` when the browser withheld it across origins,
 * or an object whose `message` is a getter that throws. Anything that went wrong reading it
 * would replace the error being reported with an error about reporting it.
 */
export function errorParts(value: unknown): { msg: string; stack?: string } {
  try {
    if (value instanceof Error) {
      return {
        msg: `${value.name}: ${value.message}`,
        stack: typeof value.stack === 'string' ? value.stack : undefined,
      };
    }
    // No `inspect` in a browser, and no JSON either: a rejection value carrying app data would
    // put that data in the log, and the bundle promises the customer it holds none. A plain
    // `String()` is the shallow, boring answer this wants — `[object Object]` says „not an
    // Error" without saying what was inside it.
    return { msg: typeof value === 'string' ? value : String(value) };
  } catch {
    return { msg: '[unreadable error value]' };
  }
}
