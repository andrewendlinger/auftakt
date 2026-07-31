/**
 * Shared query-param parsing for list endpoints. A malformed filter must be a 400, never a
 * silent fallback: a non-numeric value used to be dropped (returning *every* row) and a
 * repeated param (`?x=1&x=2`, which Express parses to an array) reached better-sqlite3 as a
 * non-primitive and threw a 500 (SRV-09). HttpError is mapped to its status by the error
 * middleware in index.ts.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Parse a query param to a number: absent (`undefined`/empty) → `undefined`; an array/object
 * (repeated or nested param) or a non-finite value → 400. A well-behaved integer id passes.
 */
export function numParam(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v !== 'string') throw new HttpError(400, 'Ungültiger Filterparameter');
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, 'Ungültiger Filterparameter');
  return n;
}

const TASK_SCOPES = ['live', 'archive', 'all'] as const;
/** Which slice of the task table a list request wants: the active view, the archive, or both. */
export type TaskScope = (typeof TASK_SCOPES)[number];

/**
 * Parse `?scope=`: absent/empty → `'live'`, an unknown value → 400. The route used to cast the
 * raw param (`as 'live'|'archive'|'all'`), which is compile-time only, so a stale or typo'd
 * value reached listTasks, matched neither branch, and silently mixed long-archived tasks back
 * into the live table (SDL-04).
 */
export function scopeParam(v: unknown): TaskScope {
  if (v == null || v === '') return 'live';
  if (typeof v === 'string' && (TASK_SCOPES as readonly string[]).includes(v)) return v as TaskScope;
  throw new HttpError(400, 'Ungültiger Scope-Parameter');
}
