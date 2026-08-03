import { Fragment, type ReactNode } from 'react';
import { ExternalLink } from '../components/ui';
import { normalizeUrl } from './url';

// URLs (http/https or bare www.) and email addresses. The final character class keeps sentence
// punctuation out of the link; `)` is *not* in it, because a URL may legitimately end in one —
// `trimUnbalancedParens` decides which is which.
const PATTERN =
  /((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?\]}"'])|([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;

/**
 * A trailing `)` belongs to the URL only when the match left a `(` unclosed. So
 * `…/Ludwig_van_Beethoven_(Film)` keeps its paren — excluding it unconditionally, as the
 * trailing-character class used to, built a truncated href and opened a Wikipedia 404 instead of
 * the article that was pasted (CCL-20) — while `(siehe https://beispiel.de)` gives its `)` back to
 * the sentence.
 */
function trimUnbalancedParens(match: string): string {
  let end = match.length;
  while (end > 0 && match[end - 1] === ')') {
    const head = match.slice(0, end);
    const opens = head.split('(').length - 1;
    const closes = head.split(')').length - 1;
    if (closes <= opens) break;
    end -= 1;
  }
  return match.slice(0, end);
}

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
    const index = m.index ?? 0;
    if (index > lastIndex) out.push(<Fragment key={key++}>{text.slice(lastIndex, index)}</Fragment>);
    const isEmail = m[2] !== undefined;
    // Anything the paren trim gives back is left un-consumed, so it re-enters the text below.
    const match = isEmail ? m[0] : trimUnbalancedParens(m[0]);
    const href = hrefFor(match, isEmail);
    out.push(
      <ExternalLink key={key++} href={href}>
        {match}
      </ExternalLink>,
    );
    lastIndex = index + match.length;
  }
  if (lastIndex < text.length) out.push(<Fragment key={key++}>{text.slice(lastIndex)}</Fragment>);
  return out;
}
