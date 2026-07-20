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
 * Render user text as GitHub-flavoured Markdown (**bold**, lists, links, tables …).
 * Single newlines become <br> (remark-breaks) so note-style line breaks survive, and
 * bare URLs auto-link (remark-gfm). Raw HTML is not rendered — safe by default.
 */
export function Markdown({
  children,
  className = '',
}: {
  children: string | null | undefined;
  className?: string;
}) {
  // Parsing GFM is not free; memoise on the text so a parent re-render (e.g. sorting
  // the task table) doesn't re-parse every unchanged note/comment cell.
  const rendered = useMemo(
    () =>
      children ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkBreaks]}
          rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
          components={{ a: MdLink }}
        >
          {children}
        </ReactMarkdown>
      ) : null,
    [children],
  );
  if (!children) return null;
  return <div className={`prose-md ${className}`}>{rendered}</div>;
}
