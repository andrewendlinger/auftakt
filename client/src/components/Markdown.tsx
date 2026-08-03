import { useMemo, type ComponentPropsWithoutRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { openExternal } from '../lib/external';

// Allow the toolbar's <u> (underline has no Markdown syntax); everything else keeps
// the safe GitHub sanitize defaults, so raw HTML in notes can't inject anything.
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'u'],
};

/** Links open externally (OS browser / mail client), never inside the app window. */
function MdLink({ href, children }: ComponentPropsWithoutRef<'a'>) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href) openExternal(href);
      }}
      className="text-sky-700 underline decoration-sky-300 underline-offset-2 hover:decoration-sky-600 break-words"
    >
      {children}
    </a>
  );
}

/**
 * Link styled as plain text — no <a>, so a preview can render inside an enclosing <a> (e.g. a
 * clickable card) without nesting anchors. Keeps the link colour/underline as a visual hint.
 */
function MdLinkText({ children }: ComponentPropsWithoutRef<'a'>) {
  return (
    <span className="text-sky-700 underline decoration-sky-300 underline-offset-2 break-words">
      {children}
    </span>
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
 */
export function Markdown({
  children,
  className = '',
  plainLinks = false,
}: {
  children: string | null | undefined;
  className?: string;
  /** Render links as non-interactive text — use when the Markdown sits inside an enclosing <a>. */
  plainLinks?: boolean;
}) {
  // Parsing GFM is not free; memoise on the text so a parent re-render (e.g. sorting
  // the task table) doesn't re-parse every unchanged note/comment cell.
  const rendered = useMemo(
    () =>
      children ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkBreaks]}
          rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
          components={{ a: plainLinks ? MdLinkText : MdLink }}
        >
          {children}
        </ReactMarkdown>
      ) : null,
    [children, plainLinks],
  );
  if (!children) return null;
  return <div className={`prose-md ${className}`}>{rendered}</div>;
}
