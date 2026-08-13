/**
 * How an image in the flowing text is spelled, on both sides of the round-trip (WP-37).
 *
 * The stored form is a **root-relative, season-free** URL:
 *
 *     ![Saalplan](/api/images/9f2a41c7b8e05d3a6c1f4b90e7d28a35)
 *
 * Two properties hang off that shape, and neither is an accident:
 *
 * - **The sanitizer already accepts it.** `hast-util-sanitize`'s `safeProtocol` returns true when
 *   the value has no colon before the first `/`, `?` or `#`, and `img` is in the GitHub default
 *   `tagNames`. So `markdownPipeline.ts` needs no widening at all — `protocols.src` stays
 *   `http`/`https` and the `rehypeRaw → rehypeSanitize` order stays exactly as WP-49 left it. A
 *   `data:` URL would have needed the opposite.
 * - **It survives a season copy.** The path carries no season id and the token is content-derived,
 *   so nothing in any text column is ever rewritten. See `server/src/db.ts` (`copyImages`).
 *
 * The season pin is added when the `<img>` is *drawn* and stripped when one is *read back*, never
 * stored. That asymmetry is the whole point of this module: a browser fetching an `<img src>` sends
 * no headers, so `X-Auftakt-Season` cannot reach the server and the request would resolve the
 * registry default — another season's picture, silently. `server/src/index.ts` already documents
 * the `?season=` leg for „plain `<a href>` downloads, which cannot carry headers"; an image load is
 * the same class of request.
 *
 * Pure on purpose — no DOM, no `sessionStorage`, no imports. `richtext.ts` is loaded by the
 * headless round-trip gate, which has neither a window nor a season, and `check:unit` reaches this
 * module only because it stays a plain function of its arguments (the callers pass
 * `getWindowSeason()` in).
 */

/** The one path images are served from. Anything else is somebody else's URL — leave it alone. */
const IMAGE_PATH = '/api/images/';

/** `sha256(bytes)` truncated to 32 hex chars — the server's token shape, mirrored for validation. */
const TOKEN_RE = /^[0-9a-f]{32}$/;

/** True for a URL this app serves, i.e. one the season pin applies to. */
export function isImageRef(src: string): boolean {
  return src.startsWith(IMAGE_PATH);
}

/** The stored URL for a token. The server returns this too; the client never builds it for storage. */
export function imageRefUrl(token: string): string {
  return `${IMAGE_PATH}${token}`;
}

/** The token in a reference, or null — including for a pinned URL, so it reads either form. */
export function imageRefToken(src: string): string | null {
  if (!isImageRef(src)) return null;
  const token = src.slice(IMAGE_PATH.length).split('?')[0] ?? '';
  return TOKEN_RE.test(token) ? token : null;
}

/**
 * Add the window's season to an image URL, for display only.
 *
 * Left untouched: external `http(s)` images (an old note may hold one), `data:` URLs, and anything
 * that is not ours. `null` — an unpinned window, which is every window before its first response
 * echoes a season — also passes through unchanged: the server then resolves the registry default,
 * which is the same season that window's other requests are resolving anyway.
 */
export function withSeasonPin(src: string, seasonId: number | null): string {
  if (seasonId === null || !isImageRef(src)) return src;
  return `${canonicalImageSrc(src)}?season=${seasonId}`;
}

/**
 * Strip a season pin back off — the inverse of `withSeasonPin`, and the reason it is safe to add
 * one at all.
 *
 * The editor renders its own `<img>` from the same attribute it will serialize, and ProseMirror
 * reads a pasted `<img>` back through `parseHTML`. Without this, copying a paragraph inside the
 * editor would write `?season=3` into the stored Markdown, and that string would then be wrong in
 * every other season — the `LinkHoverTitle` lesson (a rendered attribute read back into the
 * document) applied to a URL that outlives the window.
 */
export function canonicalImageSrc(src: string): string {
  if (!isImageRef(src)) return src;
  const cut = src.indexOf('?');
  return cut === -1 ? src : src.slice(0, cut);
}

/**
 * Escape the alt text so `![…]` closes where the author meant it to.
 *
 * Backslash first, or the escapes this adds would themselves be escaped. A file name is the alt
 * fallback and file names really do carry brackets („Saalplan [Entwurf].jpg").
 */
export function escapeAlt(alt: string): string {
  return alt.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

/** Escape a Markdown title, which is delimited by the double quotes this has to keep inside. */
export function escapeTitle(title: string): string {
  return title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Parens nest inside a bare Markdown destination only while they balance. */
function parensBalanced(src: string): boolean {
  let depth = 0;
  for (const ch of src) {
    if (ch === '(') depth++;
    else if (ch === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

/**
 * Serialize a destination, angle-bracketing it only when the bare form would not parse back.
 *
 * Both parsers accept `<…>`, so this is a choice about *when* rather than whether. Our own tokens
 * never need it — 32 hex characters on a fixed path — but the dialect now carries whatever an old
 * note or an import put there, and a URL with a space in it is exactly the case that silently
 * re-read as text-plus-garbage before. Bare wherever possible, so a hand-written note keeps looking
 * hand-written.
 */
export function encodeSrc(src: string): string {
  if (!/[\s<>]/.test(src) && parensBalanced(src)) return src;
  return `<${src.replace(/([<>\\])/g, '\\$1')}>`;
}

/** `![alt](src "title")`, escaped in all three positions. The editor's serializer half. */
export function imageMarkdown(src: string, alt = '', title?: string | null): string {
  const suffix = title ? ` "${escapeTitle(title)}"` : '';
  return `![${escapeAlt(alt)}](${encodeSrc(src)}${suffix})`;
}
