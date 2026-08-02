import { ApiError } from '../api/client';

/**
 * The app's one error sentence: the German statement of what failed leads, the server's own
 * text follows in parentheses.
 *
 * The five hand-written catch sites this replaces did it the other way round — `err instanceof
 * ApiError ? err.message : <German>` — which put untranslated strings in front of the user
 * exactly when something broke: a dead server showed „Bad Gateway", a rejected season delete
 * showed `unknown season`. The German fallback only ever appeared when the fetch itself
 * rejected, i.e. when there was no detail to show anyway.
 *
 * Only an `ApiError` contributes a detail. A `TypeError` from a bug, or fetch's own „Failed to
 * fetch", is an internal English string with no meaning for the user — `reportError` logs the
 * original to the console instead.
 */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? `${fallback} (${err.message})` : fallback;
}

/** A 404 from the server — "this row is gone", as opposed to "the request failed". */
export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

type Reporter = (message: string) => void;

let reporter: Reporter | null = null;

/**
 * Point `reportError` at the live toast. Called by `GlobalErrorSurface`, which is the only
 * place that can — the toast lives in React context and the callers below (the QueryCache,
 * the `unhandledrejection` listener) do not.
 */
export function setErrorReporter(fn: Reporter | null): void {
  reporter = fn;
}

const recent = new Map<string, number>();
const DEDUPE_MS = 5_000;

/**
 * Surface an error the user did not directly trigger. Always logs; toasts when a reporter is
 * registered.
 *
 * Identical messages inside a five-second window collapse into one. Writes invalidate every
 * query at once (`useInvalidateAll`, deliberate — the dataset is tiny), so a server that went
 * away would otherwise stack one identical toast per query in flight.
 */
export function reportError(err: unknown, fallback: string): void {
  const message = errorMessage(err, fallback);
  console.error(message, err);
  const now = Date.now();
  for (const [key, at] of recent) if (now - at > DEDUPE_MS) recent.delete(key);
  if (recent.has(message)) return;
  recent.set(message, now);
  reporter?.(message);
}
