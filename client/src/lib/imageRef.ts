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
 *   so nothing in any text column is ever rewritten. See `server/src/db.ts` (`copySeasonData`).
 *
 * The season pin is added when the `<img>` is *drawn* and stripped when one is *read back*, never
 * stored. That asymmetry is the whole point of this module: a browser fetching an `<img src>` sends
 * no headers, so `X-Auftakt-Season` cannot reach the server and the request would resolve the
 * registry default — another season's picture, silently. `server/src/index.ts` already documents
 * the `?season=` leg for „plain `<a href>` downloads, which cannot carry headers"; an image load is
 * the same class of request.
 *
 * A display width rides on the same URL in the *other* direction: stored as `?w=384`, split off
 * into a `width` attribute before anything is drawn (`splitImageSrc`), and written back on
 * serialization (`composeImageSrc`). The two query legs never meet — **a stored reference carries
 * only `w`, a rendered `src` carries only `season`** — which is what lets `canonicalImageSrc` keep
 * truncating at the first `?` unchanged: by the time a URL reaches it, a recognized width has
 * already been lifted off, and whatever query is left is render-only or noise.
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

/** A display width the `?w=` spelling accepts: a positive integer of at most four digits. */
export function isImageWidth(width: unknown): width is number {
  return typeof width === 'number' && Number.isInteger(width) && width > 0 && width <= 9999;
}

/**
 * Lift a stored display width off a reference: `…?w=384` → `{ src: '…', width: 384 }`.
 *
 * The split is deliberately narrow — our own path, and a query that is *exactly* `w=` followed by
 * a plain positive integer. Anything else (a foreign URL whose `?w=` belongs to somebody else's
 * server, a hand-typed `?w=abc`, a multi-parameter query) passes through verbatim, because both
 * parsers must give back what they were given: a string this function does not recognize
 * round-trips byte-identically, and the round-trip gate's render-equality and idempotence hold by
 * construction instead of by case analysis.
 *
 * `composeImageSrc` is the exact inverse on everything this recognizes — that pair is what keeps
 * the editor (`MdImage` in richtext.ts) and the reader (`rehypeImgWidth` in markdownPipeline.ts)
 * spelling the width identically, the same way `withSeasonPin`/`canonicalImageSrc` hold the pin.
 */
export function splitImageSrc(src: string): { src: string; width: number | null } {
  if (isImageRef(src)) {
    const cut = src.indexOf('?');
    if (cut !== -1) {
      const match = /^w=([1-9]\d{0,3})$/.exec(src.slice(cut + 1));
      if (match) return { src: src.slice(0, cut), width: Number(match[1]) };
    }
  }
  return { src, width: null };
}

/**
 * Write a display width back onto a reference — the serializer half of `splitImageSrc`.
 *
 * Appends only where the split would lift it back off: our own path, a width the spelling accepts,
 * and no query already present. A reference that kept an unrecognized query (`?w=abc` and friends
 * ride along verbatim in the node's `src`) is returned unchanged rather than double-queried — a
 * width set on such a node is dropped on save instead of corrupting the URL.
 */
export function composeImageSrc(src: string, width: number | null | undefined): string {
  if (!isImageWidth(width) || !isImageRef(src) || src.includes('?')) return src;
  return `${src}?w=${width}`;
}

/**
 * Escape the alt text so `![…]` closes where the author meant it to.
 *
 * Brackets only — **the backslash is deliberately left alone**, and that asymmetry is forced by
 * the two parsers disagreeing about it. The reader (micromark) unescapes `\\` to `\`; marked, which
 * is what reads the text back into the editor, does not touch it inside an alt. Writing `\\` for
 * every backslash therefore grew one on each save — `a\b` → `a\\b` → `a\\\\b`, forever — while the
 * reader kept drawing the original: a stored string that changes every time the note is opened
 * (IMG-06). Leaving it bare is a fixed point on both sides, because a backslash before a
 * non-punctuation character means nothing to either.
 *
 * The escape mechanism still survives a backslash that precedes a bracket: `a\[b` is written
 * `a\\[b`, which the reader reads as (escaped backslash)(literal bracket) and marked as (literal
 * backslash)(escaped bracket) — two different parses of the same string, both yielding `a\[b`. The
 * one input where they part is a *doubled* backslash, which no file name the picker produces has.
 *
 * A file name is the alt fallback and file names really do carry brackets („Saalplan
 * [Entwurf].jpg"), which is what this exists for.
 */
export function escapeAlt(alt: string): string {
  return alt.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
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
