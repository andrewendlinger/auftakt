/**
 * Polling, which every gate does and none of them may do by sleeping a fixed amount.
 *
 * The rule the six gates follow is the one `docs/VERIFYING.md` states for driving scripts: wait
 * for a *condition*, never for a duration. A fixed sleep is either too short on a loaded CI runner
 * — where it becomes a flake nobody can reproduce locally — or too long everywhere else, and a
 * suite of them adds up to minutes of nothing.
 */

/** @param {number} ms */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll `ready` until it returns something truthy, or give up.
 *
 * `ready` may throw, and throwing is the normal case at the start of a run: a `fetch` against a
 * port nothing is listening on yet rejects, and that is „not up yet", not a failure. So it is
 * caught and the poll continues.
 *
 * `dead` is the other half, and it is why this is not a plain retry loop. `demo.mjs` exits within
 * a second when the seed fails and the server exits immediately when its port is taken; polling a
 * process that is already gone for the full timeout reports „kam nicht hoch" for what is really an
 * error sitting in the child's captured output. Returning a message from `dead` ends the wait at
 * once and says the true thing instead.
 *
 * Both messages come from the caller because both are the gate's own diagnosis — they name the
 * stack, the zone or the bundle that failed to come up, and they carry the tail of its log.
 *
 * @param {() => unknown | Promise<unknown>} ready
 * @param {{
 *   timeoutMs: number,
 *   intervalMs: number,
 *   dead?: () => string | null | undefined,
 *   onTimeout: () => string,
 * }} opts
 * @returns {Promise<void>}
 */
export async function waitUntil(ready, { timeoutMs, intervalMs, dead, onTimeout }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const obituary = dead?.();
    if (obituary) throw new Error(obituary);
    try {
      if (await ready()) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(onTimeout());
    await sleep(intervalMs);
  }
}
