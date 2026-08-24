/**
 * The port guard every boot-a-server gate opens with, and the reasoning behind it.
 *
 * Without one a gate happily talks to whatever already answers on its port — typically a leaked
 * `tsx watch` supervisor from an earlier run or another session, still pointing at a long-deleted
 * temp data dir. Every assertion after that reads as a product bug and is not one; the failures
 * this has produced in the past are `no such table: artists` (`check-backup`), a fixture that was
 * never created (`check-api`) and a `.demo` rebuilt underneath a live `npm run demo`
 * (`check-browser`, which `docs/VERIFYING.md` records as costing a full verification run).
 *
 * It sat in four gates under three names — `requireFreePort` twice, `assertPortFree` once and
 * `requireFreePorts` once — with two different detection techniques between them.
 */
import { createServer } from 'node:net';

/**
 * Is anything listening there? Asked **per address family**, because that is where the trap is.
 *
 * Express binds `127.0.0.1` explicitly, but **Vite binds `[::1]` and only that** — it passes the
 * bare hostname `localhost` to `listen`, and on macOS Node resolves that to `::1` first. A probe
 * on `127.0.0.1:5317` therefore binds happily *while a dev server is running on the same port*
 * and reports it free, which is the one answer this guard must never give.
 *
 * `EADDRNOTAVAIL` / `EAFNOSUPPORT` mean the family is not configured at all (a runner without
 * IPv6). That is a free port, not a busy one.
 *
 * @param {number} port
 * @param {string} host
 * @returns {Promise<boolean>}
 */
export async function busy(port, host) {
  const probe = createServer();
  try {
    await /** @type {Promise<void>} */ (
      new Promise((res, rej) => {
        probe.once('error', rej);
        probe.listen(port, host, () => res());
      })
    );
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err)?.code === 'EADDRINUSE') return true;
    const code = /** @type {NodeJS.ErrnoException} */ (err)?.code;
    if (code === 'EADDRNOTAVAIL' || code === 'EAFNOSUPPORT') return false;
    throw err;
  }
  await new Promise((res) => probe.close(res));
  return false;
}

/**
 * Refuse to run while anything holds one of `ports`, printing the caller's own refusal and
 * exiting 1.
 *
 * The message stays the caller's because it is the useful half: each gate's says what *that* run
 * would have done to the stranger's server it found — measure a bundle nobody built here, rebuild
 * a database somebody is looking at, or fail with „no such table" against a deleted data dir.
 *
 * Deliberately not a thrown error: this runs before anything has been spawned, so there is no
 * cleanup to unwind and a stack trace above the message would only bury it.
 *
 * @param {number[]} ports
 * @param {(port: number, host: string) => string} refusal what to print, given the port that was
 *   taken and the address family it was taken on
 * @param {{ hosts?: string[] }} [opts] which families to probe; the two gates that own a port a
 *   Vite might be on probe both, the ones that only ever meet an Express probe `127.0.0.1`
 */
export async function requireFreePorts(ports, refusal, { hosts = ['127.0.0.1', '::1'] } = {}) {
  for (const port of ports) {
    for (const host of hosts) {
      if (!(await busy(port, host))) continue;
      console.error(refusal(port, host));
      process.exit(1);
    }
  }
}
