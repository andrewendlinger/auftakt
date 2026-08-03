import { Fragment, type ReactNode } from 'react';
import { ExternalLink } from '../components/ui';

// Email addresses. The trailing character class keeps sentence punctuation out of the link.
const PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/**
 * Turn plain text into React nodes where every email address becomes a `mailto:` link. Clicks
 * open externally (OS mail client), never inside the app window.
 *
 * Email only. This used to carry a URL branch as well, but it had no live caller: the sole
 * consumer is the contact card, and everywhere else in the app rich text goes through
 * `Markdown`, whose remark-gfm autolink already handles bare URLs (CCL-26). The other former
 * call site — `linkify(c.phone)` — was a no-op: a phone number matches nothing here, so the
 * function walked the string and handed back the same text. Phone numbers render as plain text
 * rather than `tel:` links, which would mean widening `openExternal`'s protocol allowlist.
 */
export function linkify(text: string | null | undefined): ReactNode {
  if (!text) return null;
  const out: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const m of text.matchAll(PATTERN)) {
    const index = m.index ?? 0;
    if (index > lastIndex) out.push(<Fragment key={key++}>{text.slice(lastIndex, index)}</Fragment>);
    out.push(
      <ExternalLink key={key++} href={`mailto:${m[0]}`}>
        {m[0]}
      </ExternalLink>,
    );
    lastIndex = index + m[0].length;
  }
  if (lastIndex < text.length) out.push(<Fragment key={key++}>{text.slice(lastIndex)}</Fragment>);
  return out;
}
