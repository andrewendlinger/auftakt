/**
 * The `tasks.custom_values` blob: a JSON object keyed by custom-column id.
 *
 * Read defensively, because the column is TEXT and nothing constrains its contents.
 * `JSON.parse('null')` succeeds and returns `null`, an imported or hand-edited database can hold
 * anything at all, and every consumer here spreads or iterates the result — so a non-object has
 * to come back as `{}` rather than as itself (the client's `parseCustomValues` in
 * `api/types.ts` is the mirror of this, for the same reason: CCL-07).
 */
export function parseCustomValues(json: unknown): Record<string, unknown> {
  if (typeof json !== 'string' || !json) return {};
  try {
    const v: unknown = JSON.parse(json);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
