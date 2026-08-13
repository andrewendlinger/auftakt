import { useMemo, useState, type ComponentPropsWithoutRef } from 'react';
import ReactMarkdown, { type ExtraProps } from 'react-markdown';
import { withSeasonPin } from '../lib/imageRef';
import { rehypePlugins, remarkPlugins } from '../lib/markdownPipeline';
import { getWindowSeason } from '../lib/season';
import { EXTERNAL_LINK_CLASS, ExternalLink } from './ui';

/**
 * Links open externally (OS browser / mail client), never inside the app window.
 *
 * The hover text is the destination, because a link's label rarely is one — `[die Technik-Seite]`
 * tells you nothing about where it goes (WP-29d). A link that carries its own Markdown title
 * (`[t](u "Titel")`) keeps it; the author said something more useful than the URL.
 */
function MdLink({ href, title, children }: ComponentPropsWithoutRef<'a'>) {
  // A Markdown link with no destination is still a node to render; ExternalLink takes a string.
  if (!href) return <span className={EXTERNAL_LINK_CLASS}>{children}</span>;
  return (
    <ExternalLink href={href} title={title ?? href}>
      {children}
    </ExternalLink>
  );
}

/**
 * Link styled as plain text — no <a>, so a preview can render inside an enclosing <a> (e.g. a
 * clickable card) without nesting anchors. Keeps the link colour/underline as a visual hint.
 */
function MdLinkText({ href, title, children }: ComponentPropsWithoutRef<'a'>) {
  return (
    <span title={title ?? href} className={EXTERNAL_LINK_CLASS}>
      {children}
    </span>
  );
}

/**
 * An image in the flowing text (WP-37) — and the window's season is added *here*, not in storage.
 *
 * A browser fetching an `<img src>` sends no headers, so `X-Auftakt-Season` cannot reach the
 * server and the request would resolve the registry default: in a window pinned to another season,
 * the wrong picture or none, with a DOM that looks perfectly correct either way. `server/index.ts`
 * already documents the `?season=` leg for „plain `<a href>` downloads, which cannot carry
 * headers"; this is the same class of request. The stored Markdown stays season-free so it
 * survives a season copy — see `lib/imageRef.ts`.
 *
 * `loading="lazy"` is deliberately **not** set: Chromium does not reliably load lazy images below
 * the fold when printing, and both print sheets render Markdown.
 *
 * The fallback is what a reference whose image did not travel looks like — a note pasted in from
 * another season — instead of a broken-image glyph with no explanation.
 */
type MdImageProps = ComponentPropsWithoutRef<'img'> & ExtraProps;

function MdImage({ src, alt, node: _node, ...rest }: MdImageProps) {
  // Which src failed, not *that* one did: React reuses this instance across notes (same route,
  // same position in the tree — the useMemo below rebuilds the elements but does not remount), so
  // a boolean latched on the first 404 and drew „Bild nicht gefunden" over the next note's
  // perfectly good picture until the window was reloaded (IMG-05).
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) {
    return (
      <span className="inline-block rounded-lg border border-dashed border-neutral-300 px-2 py-1 text-xs text-neutral-400">
        {alt ? `Bild nicht gefunden: ${alt}` : 'Bild nicht gefunden'}
      </span>
    );
  }
  return (
    // `rest` carries what the sanitizer let through — `width`, `height`, `align`, `id` are all in
    // its default allowlist and used to reach the DOM through react-markdown's own `img`. An
    // imported note with `<img … width="240" align="right">` renders as the small floated
    // thumbnail it was written as, instead of jumping to the full column width (IMG-08).
    <img
      {...rest}
      src={withSeasonPin(src, getWindowSeason())}
      alt={alt ?? ''}
      onError={() => setFailedSrc(src)}
    />
  );
}

/**
 * Render user text as GitHub-flavoured Markdown (**bold**, lists, links, tables …).
 * Single newlines become <br> (remark-breaks) so note-style line breaks survive, and
 * bare URLs auto-link (remark-gfm).
 *
 * Raw HTML **is** parsed — `rehypeRaw` is in the plugin list, because the toolbar's underline
 * round-trips as a literal `<u>` (lib/richtext.ts). It is `rehypeSanitize` running *after* it
 * that keeps notes safe, so the order in `rehypePlugins` is load-bearing: drop or reorder it
 * and an `<img src=x onerror=…>` typed into a note, imported from a CSV or restored from a
 * backup executes in the renderer.
 *
 * There is no code in the dialect (WP-49): no grey box, no `<code>`, and a fence left in an old
 * note reads as the prose it was. The plugin list lives in `lib/markdownPipeline.ts` so the
 * round-trip gate measures this pipeline rather than a copy of it.
 */
export function Markdown({
  children,
  className = '',
  plainLinks = false,
  roomy = false,
}: {
  children: string | null | undefined;
  className?: string;
  /** Render links as non-interactive text — use when the Markdown sits inside an enclosing <a>. */
  plainLinks?: boolean;
  /**
   * Space paragraphs like a document rather than like a table cell. Set it on the large notes
   * surfaces and leave it off in clamped previews and table cells; a surface that also *edits*
   * this text has to match `RichTextEditor`'s `compact`, or the note visibly reflows on blur.
   */
  roomy?: boolean;
}) {
  // Parsing GFM is not free; memoise on the text so a parent re-render (e.g. sorting
  // the task table) doesn't re-parse every unchanged note/comment cell.
  const rendered = useMemo(
    () =>
      children ? (
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          components={{ a: plainLinks ? MdLinkText : MdLink, img: MdImage }}
        >
          {children}
        </ReactMarkdown>
      ) : null,
    [children, plainLinks],
  );
  if (!children) return null;
  return <div className={`prose-md ${roomy ? 'prose-md--roomy ' : ''}${className}`}>{rendered}</div>;
}
