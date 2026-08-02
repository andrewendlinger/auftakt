/**
 * Whether a `:id` route param parsed into a usable row id.
 *
 * `Number(id)` yields NaN for a hand-typed or malformed hash like `#/artist/abc`, and the page
 * then requested `/api/artists/NaN` and waited for the failure. Every `:id` page tests this
 * before it queries, so junk in the hash is answered from the client (PGS-05).
 */
export function isValidId(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}
