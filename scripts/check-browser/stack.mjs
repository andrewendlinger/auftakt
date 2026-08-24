/**
 * The demo stack: the Express on :4325, the Vite on :5317, and the JSON round trip to the first.
 *
 * `scripts/demo.mjs` is the stack, deliberately — it already rebuilds `.demo` before starting,
 * already runs the two dev servers in their own process group and already reaps that group.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { request } from '../lib/http.mjs';
import { group, tailLog } from '../lib/server.mjs';
import { waitUntil } from '../lib/wait.mjs';
import { API, PORT, UI, root } from './config.mjs';

/**
 * `Response.json()` is typed `Promise<unknown>` and every assertion below reads a field off the
 * result; narrowing each would mean restating the API's response shape inside the script whose
 * job is to catch the server disagreeing with it.
 * @returns {Promise<any>}
 */
export async function api(path, init) {
  const res = await fetch(`${API}${path}`, init);
  return res.json().catch(() => ({}));
}

/**
 * Bind an API path to one season, for the fixture seasons the cases below work in.
 *
 * `?season=` is the header's twin — the middleware takes either, and a bare `fetch` has no header
 * to send. One factory rather than one closure per case: the two differ only in the id, and a
 * second copy is how the query-vs-`?` branch would start disagreeing with itself.
 */
export const scoped = (id) => (path) => `${path}${path.includes('?') ? '&' : '?'}season=${id}`;

/**
 * A request body as JSON, or `{}` for anything that is not.
 *
 * The `page.on('request')` listeners below run **outside** this file's `try`, so a `JSON.parse`
 * that throws in one is an unhandled rejection that ends the process instead of failing a line —
 * the same class the route handlers' `catch` closes. Nothing on these pages sends a non-JSON
 * PATCH body today; this is what keeps that from being load-bearing.
 * @returns {any}
 */
export const jsonOr = (raw) => {
  try {
    return JSON.parse(raw ?? '{}');
  } catch {
    return {};
  }
};

/** @returns {Promise<{ status: number, body: any }>} */
export async function send(method, path, body) {
  return request(`${API}${path}`, { method, body });
}

/**
 * The stack is `scripts/demo.mjs`, not a hand-rolled spawn pair: it already rebuilds `.demo`
 * before starting, already runs the two dev servers in their own process group and already
 * reaps that group. `AUFTAKT_PORT` reaches both halves — the server binds it and Vite proxies
 * `/api` to it (client/vite.config.ts) — and `server/src/demo.ts` pins `AUFTAKT_DATA_DIR` to
 * `<repo>/.demo` itself and refuses an inherited one, so this cannot touch `.data/`.
 */
/** @type {import('node:child_process').ChildProcess | null} */
export let stack = null;
/** Last ~8 KB of the stack's output, dumped when it fails to come up or a case explodes. */
export const stackLog = tailLog(8000);

// No temp dir to drop: `demo.mjs` owns `<repo>/.demo` and leaves it behind on purpose, so what
// the next `npm run demo` starts against is exactly what this run drove.
export const { adopt, shutdown } = group({ graceMs: 3000 });

export function startStack() {
  stack = adopt(
    spawn(process.execPath, [join(root, 'scripts', 'demo.mjs')], {
      cwd: root,
      env: { ...process.env, AUFTAKT_PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    }),
  );
  stackLog.attach(stack);
}

/**
 * Both halves have to answer: the API on :4325 and Vite on :5317.
 *
 * A dead stack ends the wait immediately rather than at the deadline — `demo.mjs` exits within a
 * second when the seed fails, and two minutes of polling a process that is gone reports „kam nicht
 * hoch" for what is really a seeding error sitting in `stackLog`.
 */
export async function waitForStack() {
  let apiUp = false;
  await waitUntil(
    async () => {
      if (!apiUp) apiUp = (await fetch(`${API}/health`)).ok;
      return apiUp && (await fetch(UI)).ok;
    },
    {
      timeoutMs: 120_000,
      intervalMs: 400,
      dead: () => (stack?.exitCode == null ? null : `Stack ist beendet (Code ${stack.exitCode})\n${stackLog.read()}`),
      onTimeout: () => `Stack kam nicht hoch (API ${apiUp ? 'ok' : 'stumm'})\n${stackLog.read()}`,
    },
  );
}

/**
 * Believe nothing until the server is the *demo* server. A stale process answering from a
 * deleted inode passes both documented confirmations, so this is the cheap third one.
 */
export async function assertDemo() {
  const reg = await api('/seasons');
  if (!String(reg.activeFile ?? '').includes(`${'/'}.demo/`)) {
    throw new Error(`Server auf :${PORT} ist nicht der Demo-Server (activeFile=${reg.activeFile})`);
  }
  return reg;
}
