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
