import { AsyncLocalStorage } from 'node:async_hooks';
import type { Season } from './db';

/**
 * The request's season, carried implicitly so getDb()'s call sites (and every helper under
 * them) stay season-blind. better-sqlite3 is synchronous, so a request's DB work happens
 * inside its own continuation and cannot interleave with another request's; the store also
 * survives `await`s in async handlers. Anything running OUTSIDE a request — the boot warm,
 * seed/demo, the check scripts' in-process calls — has no store and
 * deliberately resolves the registry default.
 *
 * The store holds the resolved registry row, not just the id: the /api middleware already
 * read and validated the registry, so re-reading seasons.json for every getDb() call inside
 * the request would be pure waste (PR50-09 — the same cost DBW-13 avoids in snapshotDb).
 *
 * Dependency-free on purpose: db.ts imports this, so this file must never import db.ts at
 * runtime. The `import type` above is erased at compile time and creates no cycle.
 */
const als = new AsyncLocalStorage<{ season: Season }>();

/** The season established by the /api middleware, or null outside a request. */
export function currentSeasonId(): number | null {
  return als.getStore()?.season.id ?? null;
}

/**
 * The registry row the /api middleware resolved, or null outside a request. A snapshot from
 * middleware time: `id` and `file` are immutable per season (import replaces content under
 * the same name), but `label` can go stale within the request — setActiveSeasonLabel and
 * updateSeason mutate a *different* parsed registry object. Never read `label` off this.
 */
export function currentSeasonRef(): Season | null {
  return als.getStore()?.season ?? null;
}

export function runWithSeason<T>(season: Season, fn: () => T): T {
  return als.run({ season }, fn);
}
