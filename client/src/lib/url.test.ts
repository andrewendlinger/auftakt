import { describe, expect, it } from 'vitest';
import { isParsableUrl, normalizeUrl } from './url';

/**
 * `normalizeUrl` is the one rule that keeps stored links openable. `openExternal` only opens
 * http/https/mailto and refuses anything `new URL()` cannot parse, so a link this function lets
 * through unprefixed renders as a perfectly normal link and then alerts „nicht unterstütztes
 * Format" on every click (RTE-09). The contract is narrow on purpose: prefix when there is no
 * scheme, leave an existing scheme alone, and let `openExternal` be the single place that decides
 * what may open.
 */

describe('normalizeUrl', () => {
  it('prefixes https:// when no scheme is named', () => {
    expect(normalizeUrl('beispiel.de')).toBe('https://beispiel.de');
    expect(normalizeUrl('www.beispiel.de')).toBe('https://www.beispiel.de');
    expect(normalizeUrl('beispiel.de/pfad?a=1#b')).toBe('https://beispiel.de/pfad?a=1#b');
  });

  it('leaves an existing scheme alone', () => {
    expect(normalizeUrl('https://beispiel.de')).toBe('https://beispiel.de');
    expect(normalizeUrl('http://beispiel.de')).toBe('http://beispiel.de');
    expect(normalizeUrl('mailto:a@b.de')).toBe('mailto:a@b.de');
  });

  // Left intact rather than mangled into `https://obsidian://…`. Refusing to open it is
  // `openExternal`'s job; this function's job is not to corrupt it on the way there.
  it('leaves an unknown scheme intact rather than mangling it', () => {
    expect(normalizeUrl('obsidian://open?vault=x')).toBe('obsidian://open?vault=x');
    expect(normalizeUrl('file:///etc/hosts')).toBe('file:///etc/hosts');
  });

  // CCL-09/CCL-10: `linkify`'s prepend was `www.`-only and case-sensitive.
  it('recognises a scheme case-insensitively', () => {
    expect(normalizeUrl('HTTPS://beispiel.de')).toBe('HTTPS://beispiel.de');
    expect(normalizeUrl('MailTo:a@b.de')).toBe('MailTo:a@b.de');
  });

  it('accepts the punctuation RFC 3986 allows in a scheme', () => {
    expect(normalizeUrl('x-custom.app+v2://z')).toBe('x-custom.app+v2://z');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeUrl('  beispiel.de  ')).toBe('https://beispiel.de');
    expect(normalizeUrl('\n https://beispiel.de \t')).toBe('https://beispiel.de');
  });

  it('returns empty for empty or whitespace-only input', () => {
    expect(normalizeUrl('')).toBe('');
    expect(normalizeUrl('   ')).toBe('');
  });

  // A bare word is not a scheme — `beispiel:` would be, but `12abc:` starts with a digit, and a
  // colon inside a path is not a leading scheme either.
  it('does not mistake a mid-string colon for a scheme', () => {
    expect(normalizeUrl('beispiel.de/a:b')).toBe('https://beispiel.de/a:b');
    expect(normalizeUrl('1abc:def')).toBe('https://1abc:def');
  });
});

describe('isParsableUrl', () => {
  it('accepts what normalizeUrl turns into a parseable URL', () => {
    expect(isParsableUrl('beispiel.de')).toBe(true);
    expect(isParsableUrl('https://beispiel.de')).toBe(true);
    expect(isParsableUrl('mailto:a@b.de')).toBe(true);
  });

  it('rejects empty input', () => {
    expect(isParsableUrl('')).toBe(false);
    expect(isParsableUrl('   ')).toBe(false);
  });

  it('rejects input new URL() cannot parse', () => {
    expect(isParsableUrl('https://')).toBe(false);
  });

  it('agrees with normalizeUrl — anything it accepts, new URL() accepts', () => {
    for (const raw of ['beispiel.de', 'www.a.de/b', 'mailto:x@y.z', 'obsidian://open']) {
      expect(isParsableUrl(raw)).toBe(true);
      expect(() => new URL(normalizeUrl(raw))).not.toThrow();
    }
  });
});
