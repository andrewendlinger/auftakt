/**
 * Read-modify-write against an endpoint that can refuse a stale write (WP-53).
 *
 * The landing content is one blob in `seasons.json` and a PATCH replaces whole arrays, so every
 * mutation has to compute its array from a read. Two windows computing from the *same* read
 * destroyed each other's rows silently, and there is no Papierkorb behind that file. The server
 * now stamps a generation and rejects a patch built on a superseded one; this is the other half —
 * on a rejection, run the whole read → compute → write again, so the change is re-applied to
 * what is actually stored rather than lost.
 *
 * Re-running is only sound because the caller's `run` is a *function of the current content*
 * — `filter(d => d.id !== gone)`, `[...now, added]`, `arrayMoveTo(now, …)` — never a captured
 * array. A `run` that closes over a snapshot re-applies that snapshot and this buys nothing.
 *
 * **No imports, deliberately.** `check:unit` runs vitest in the default *node* environment (the
 * client has no vitest config), so reaching for `ApiError` would pull in `api/client.ts` →
 * `lib/season.ts` → `sessionStorage` and this module would stop being loadable there. The
 * status check is structural for that reason, the same discipline `lib/imageRef.ts` keeps.
 */

/**
 * How many times the whole read → compute → write runs before the rejection is handed to the
 * caller. Three because a conflict means another window won a race against a local Express
 * process: losing it twice more in a row is not a case worth designing for, and an unbounded
 * loop against a server that answers 409 to everything would hang the write for ever.
 */
export const MAX_CONFLICT_ATTEMPTS = 3;

/** A rejection that says „someone else wrote first" — anything carrying HTTP 409. */
export function isConflict(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { status?: unknown }).status === 409;
}

/**
 * Run `attempt` until it resolves, a non-conflict error comes out, or the budget is spent.
 *
 * The conflicting error is passed back in so the caller can seed the next attempt from whatever
 * the server sent with the 409 instead of paying for another GET. The final rejection is the
 * *last* conflict, not a synthetic one: it carries the server's German sentence, which is what
 * the caller's catch → toast already knows how to say.
 */
export async function retryOnConflict<T>(
  attempt: (conflict: unknown) => Promise<T>,
  attempts: number = MAX_CONFLICT_ATTEMPTS,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await attempt(i === 0 ? undefined : last);
    } catch (err) {
      if (!isConflict(err)) throw err;
      last = err;
    }
  }
  throw last;
}
