/**
 * The app's one rule for turning what a user typed into an openable URL.
 *
 * Everything that stores a URL has to agree on this, because `openExternal` (lib/external.ts)
 * only opens `http:`/`https:`/`mailto:` and blocks anything `new URL()` cannot parse. A note
 * link typed as `www.beispiel.de` used to be stored verbatim, rendered as a perfectly normal
 * link, and then alert with „nicht unterstütztes Format" on every click (RTE-09).
 *
 * Shared with CCL-09/CCL-10: `linkify`'s `www.`-only, case-sensitive prepend and `LinkList`'s
 * stored URLs are the other consumers.
 */

/** A leading `scheme:` per RFC 3986 — `https:`, `mailto:`, `obsidian:` … */
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * Trim, and prefix `https://` unless the input already names a scheme. An empty input stays
 * empty; an unknown scheme is left alone rather than mangled, so `openExternal` gets to be the
 * single place that decides what may open.
 */
export function normalizeUrl(raw: string): string {
  const url = raw.trim();
  if (!url) return '';
  return HAS_SCHEME.test(url) ? url : `https://${url}`;
}

/** Whether `normalizeUrl(raw)` yields something `new URL()` accepts — the „Einfügen" gate. */
export function isParsableUrl(raw: string): boolean {
  const url = normalizeUrl(raw);
  if (!url) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
