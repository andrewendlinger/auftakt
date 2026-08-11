import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The request's season, carried implicitly so getDb()'s call sites (and every helper under
 * them) stay season-blind. better-sqlite3 is synchronous, so a request's DB work happens
 * inside its own continuation and cannot interleave with another request's; the store also
 * survives `await`s in async handlers. Anything running OUTSIDE a request — the boot warm,
 * seed/demo, the check scripts' in-process calls, the Notion importer — has no store and
 * deliberately resolves the registry default.
 *
 * Dependency-free on purpose: db.ts imports this, so this file must never import db.ts.
 */
const als = new AsyncLocalStorage<{ seasonId: number }>();

/** The season established by the /api middleware, or null outside a request. */
export function currentSeasonId(): number | null {
  return als.getStore()?.seasonId ?? null;
}

export function runWithSeason<T>(seasonId: number, fn: () => T): T {
  return als.run({ seasonId }, fn);
}
