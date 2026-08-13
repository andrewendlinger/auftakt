import { describe, expect, it } from 'vitest';
import {
  canonicalImageSrc,
  encodeSrc,
  escapeAlt,
  escapeTitle,
  imageMarkdown,
  imageRefToken,
  imageRefUrl,
  isImageRef,
  withSeasonPin,
} from './imageRef';

/**
 * The two halves this pins are the ones whose failure is silent (WP-37).
 *
 * `withSeasonPin`/`canonicalImageSrc` must be exact inverses on our own URLs: the pin is added when
 * an `<img>` is drawn and removed when one is read back, and a leak in either direction writes a
 * season id into stored prose that is wrong in every *other* season. Nothing renders differently
 * when that happens — the picture simply becomes the wrong picture, one season over.
 *
 * `escapeAlt`/`encodeSrc` are the serializer half. An unescaped bracket or a raw space closes the
 * Markdown early, and what comes back is text where an image used to be.
 */

const TOKEN = '9f2a41c7b8e05d3a6c1f4b90e7d28a35';
const REF = `/api/images/${TOKEN}`;

describe('isImageRef / imageRefUrl / imageRefToken', () => {
  it('recognises our own path and nothing else', () => {
    expect(isImageRef(REF)).toBe(true);
    expect(isImageRef(`${REF}?season=3`)).toBe(true);
    expect(isImageRef('https://example.com/a.jpg')).toBe(false);
    expect(isImageRef('data:image/jpeg;base64,AAAA')).toBe(false);
    // Near-misses: an absolute URL to the same path is somebody else's origin, not our reference.
    expect(isImageRef('http://127.0.0.1:4317/api/images/x')).toBe(false);
  });

  it('round-trips a token through the URL, pinned or not', () => {
    expect(imageRefUrl(TOKEN)).toBe(REF);
    expect(imageRefToken(REF)).toBe(TOKEN);
    expect(imageRefToken(`${REF}?season=12`)).toBe(TOKEN);
  });

  it('rejects anything that is not the server-side token shape', () => {
    // The route validates the same shape; a stale or hand-edited URL must read as „no token"
    // rather than reaching the database as a query parameter.
    expect(imageRefToken('/api/images/../../etc/passwd')).toBeNull();
    expect(imageRefToken('/api/images/ABCDEF')).toBeNull(); // upper case is not the hex we write
    expect(imageRefToken(`/api/images/${TOKEN}f`)).toBeNull(); // 33 chars
    expect(imageRefToken('https://example.com/a.jpg')).toBeNull();
  });
});

describe('withSeasonPin / canonicalImageSrc', () => {
  it('pins our own references', () => {
    expect(withSeasonPin(REF, 3)).toBe(`${REF}?season=3`);
  });

  it('leaves foreign and unpinnable sources alone', () => {
    // An old note may carry either; both must keep rendering exactly as they do today.
    expect(withSeasonPin('https://example.com/a.jpg', 3)).toBe('https://example.com/a.jpg');
    expect(withSeasonPin('data:image/jpeg;base64,AAAA', 3)).toBe('data:image/jpeg;base64,AAAA');
    // Unpinned window: the server resolves the registry default, which is what its other
    // requests are resolving too.
    expect(withSeasonPin(REF, null)).toBe(REF);
  });

  it('is idempotent — a second render must not stack pins', () => {
    // Reached whenever an already-rendered src is fed back through, which the editor does on
    // every re-render of the same node.
    expect(withSeasonPin(withSeasonPin(REF, 3), 3)).toBe(`${REF}?season=3`);
    expect(withSeasonPin(`${REF}?season=1`, 7)).toBe(`${REF}?season=7`);
  });

  it('strips the pin back off, exactly', () => {
    expect(canonicalImageSrc(`${REF}?season=3`)).toBe(REF);
    expect(canonicalImageSrc(REF)).toBe(REF);
    // Not ours → untouched, query string and all.
    expect(canonicalImageSrc('https://example.com/a.jpg?v=2')).toBe(
      'https://example.com/a.jpg?v=2',
    );
  });

  it('is an exact inverse, which is what keeps the pin out of storage', () => {
    for (const season of [1, 3, 42]) {
      expect(canonicalImageSrc(withSeasonPin(REF, season))).toBe(REF);
    }
  });
});

describe('escapeAlt / escapeTitle', () => {
  it('escapes brackets, because file names carry them', () => {
    // The alt fallback is the original file name; „Saalplan [Entwurf].jpg" is an ordinary one.
    expect(escapeAlt('Saalplan [Entwurf]')).toBe('Saalplan \\[Entwurf\\]');
  });

  it('escapes the backslash first, so escapes are not double-escaped', () => {
    expect(escapeAlt('a\\b')).toBe('a\\\\b');
    expect(escapeAlt('\\[')).toBe('\\\\\\[');
  });

  it('escapes the quote a title is delimited by', () => {
    expect(escapeTitle('Großer Saal "West"')).toBe('Großer Saal \\"West\\"');
  });
});

describe('encodeSrc', () => {
  it('leaves a normal destination bare, so notes keep looking hand-written', () => {
    expect(encodeSrc(REF)).toBe(REF);
    expect(encodeSrc('https://example.com/a.jpg')).toBe('https://example.com/a.jpg');
    // Balanced parens parse fine bare — this is the common Wikipedia-style URL.
    expect(encodeSrc('https://e.org/a_(b).jpg')).toBe('https://e.org/a_(b).jpg');
  });

  it('angle-brackets a destination the bare form would not survive', () => {
    // The case that used to re-read as text plus garbage.
    expect(encodeSrc('https://e.org/a b.jpg')).toBe('<https://e.org/a b.jpg>');
    expect(encodeSrc('https://e.org/a)b.jpg')).toBe('<https://e.org/a)b.jpg>');
    expect(encodeSrc('https://e.org/(a.jpg')).toBe('<https://e.org/(a.jpg>');
  });

  it('escapes the angle brackets it adds around', () => {
    expect(encodeSrc('https://e.org/a<b>c d')).toBe('<https://e.org/a\\<b\\>c d>');
  });
});

describe('imageMarkdown', () => {
  it('writes the three positions the parser reads back', () => {
    expect(imageMarkdown(REF, 'Saalplan')).toBe(`![Saalplan](${REF})`);
    expect(imageMarkdown(REF, '')).toBe(`![](${REF})`);
    expect(imageMarkdown(REF, 'Saalplan', 'Großer Saal')).toBe(
      `![Saalplan](${REF} "Großer Saal")`,
    );
  });

  it('escapes all three at once', () => {
    expect(imageMarkdown('https://e.org/a b.jpg', 'Plan [1]', 'Ein "Titel"')).toBe(
      '![Plan \\[1\\]](<https://e.org/a b.jpg> "Ein \\"Titel\\"")',
    );
  });
});
