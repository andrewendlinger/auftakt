/**
 * The child process a gate runs its server — or its whole dev stack — in, and the four things
 * every one of them needs around it.
 *
 * All of it is scar tissue, and each piece has a finding behind it (DBW-10, DBW-11).
 */
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { sleep } from './wait.mjs';

/**
 * Keep the tail of a child's output, for the failure messages that would otherwise say nothing.
 *
 * „Server kam nicht hoch" is useless on its own; the reason is always in the child's stdout, and
 * by the time anybody reads the failure the child is gone. `limit` caps what is retained because
 * the stack `check-browser` runs is a Vite that prints on every request — an uncapped buffer there
 * grows for the length of the run and is then dumped into a terminal.
 *
 * @param {number} [limit] characters to keep; `Infinity` for the gates whose child is quiet
 */
export function tailLog(limit = Infinity) {
  let text = '';
  return {
    /** @param {import('node:child_process').ChildProcess} child */
    attach(child) {
      for (const stream of [child.stdout, child.stderr]) {
        if (!stream) continue;
        stream.setEncoding('utf8');
        stream.on('data', (chunk) => {
          text = (text + chunk).slice(-limit);
        });
      }
    },
    /** Forget everything so far — for the gate that stops and restarts its server mid-run. */
    reset() {
      text = '';
    },
    read: () => text,
  };
}

/**
 * A child spawned into **its own process group**, with the kill, the cleanup, the shutdown and
 * the signal wiring that has to go with one.
 *
 * **Why a group at all (DBW-10).** The gates that go through `npm --prefix server run …` or
 * through `scripts/demo.mjs` spawn with `shell: true`, so the pid held here belongs to the shell,
 * with npm and the tsx/node process actually bound to the port underneath it. `child.kill()` only
 * ever signals the top of that chain and leaves reaping the rest to whatever the shell and npm
 * happen to forward — nothing at all on Windows, where it cannot reach a grandchild. A survivor
 * makes the next run either talk to a stale server pointing at this run's deleted temp dir, or
 * wait out its whole start timeout against EADDRINUSE and fail with „Server kam nicht hoch"
 * though nothing is broken. So: `detached` on POSIX and a negative pid, `taskkill /t` on Windows.
 *
 * **Why the signal handlers (DBW-11).** A run stays alive for tens of seconds to minutes, so
 * Ctrl-C during one is normal. Without a listener Node terminates via the default signal action,
 * never emits `'exit'`, and `cleanup` never runs: the server keeps the port and the temp dirs stay
 * behind, once per interrupted run.
 *
 * The caller keeps its own reference to the child — the gates read `exitCode`, attach a log and
 * wait on `'exit'` — and hands it over with `adopt`.
 *
 * @param {{ graceMs: number, cleanup?: () => void }} opts `graceMs` is how long `shutdown` waits
 *   for the group to actually be gone before dropping the temp dirs: the server re-creates its
 *   data dir on the next registry write, so removing it first leaves it behind.
 */
export function group({ graceMs, cleanup: extra }) {
  /** @type {import('node:child_process').ChildProcess | null} */
  let child = null;

  function kill() {
    if (!child?.pid) return;
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
      } else {
        process.kill(-child.pid, 'SIGTERM'); // negative pid = the whole process group
      }
    } catch {
      /* already gone */
    }
  }

  let cleanedUp = false;
  /** Last-ditch cleanup for the `'exit'` handler, where nothing may be awaited. */
  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    kill();
    extra?.();
  }
  process.on('exit', cleanup);

  /**
   * Stop the group, wait for it to actually be gone, then clean up and leave.
   * @param {number} code
   * @returns {Promise<never>}
   */
  async function shutdown(code) {
    kill();
    if (child) await Promise.race([once(child, 'exit'), sleep(graceMs)]);
    cleanup();
    process.exit(code);
  }

  for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
    process.on(signal, () => {
      void shutdown(130);
    });
  }

  return {
    /**
     * @template {import('node:child_process').ChildProcess} T
     * @param {T} spawned must have been spawned with `detached: process.platform !== 'win32'`
     * @returns {T}
     */
    adopt(spawned) {
      child = spawned;
      return spawned;
    },
    kill,
    cleanup,
    shutdown,
  };
}
