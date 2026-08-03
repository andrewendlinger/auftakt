import { Fragment, type ReactNode } from 'react';
import { openExternal } from './external';
import { normalizeUrl } from './url';

// URLs (http/https or bare www.) and email addresses.
const PATTERN =
  /((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)\]}"'])|([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;

function hrefFor(match: string, isEmail: boolean): string {
  if (isEmail) return `mailto:${match}`;
  // PATTERN matches case-insensitively, so this used to hand „Www.beispiel.de" (sentence start,
  // mobile autocapitalisation) to openExternal with no scheme: rendered as a link, refused on
  // click with „nicht unterstütztes Format". normalizeUrl is the app's one rule and is not
  // case-sensitive (CCL-16).
  return normalizeUrl(match);
}

/**
 * Turn plain text into React nodes where every URL and email becomes a clickable
 * link. Emails use mailto:. Clicks open externally (OS browser / mail client),
 * never inside the app window.
 */
export function linkify(text: string | null | undefined): ReactNode {
  if (!text) return null;
  const out: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const m of text.matchAll(PATTERN)) {
    const match = m[0];
    const index = m.index ?? 0;
    if (index > lastIndex) out.push(<Fragment key={key++}>{text.slice(lastIndex, index)}</Fragment>);
    const isEmail = m[2] !== undefined;
    const href = hrefFor(match, isEmail);
    out.push(
      <a
        key={key++}
        href={href}
        onClick={(e) => {
          e.preventDefault();
          openExternal(href);
        }}
        className="text-sky-700 underline decoration-sky-300 underline-offset-2 hover:decoration-sky-600 break-words"
      >
        {match}
      </a>,
    );
    lastIndex = index + match.length;
  }
  if (lastIndex < text.length) out.push(<Fragment key={key++}>{text.slice(lastIndex)}</Fragment>);
  return out;
}
