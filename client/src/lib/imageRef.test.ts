import { describe, expect, it } from 'vitest';
import {
  canonicalImageSrc,
  composeImageSrc,
  encodeSrc,
  escapeAlt,
  escapeTitle,
  imageMarkdown,
  imageRefToken,
  imageRefUrl,
  isImageAlign,
  isImageRef,
  isImageWidth,
  splitImageSrc,
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

describe('splitImageSrc / composeImageSrc', () => {
  it('lifts stored presentation off our own reference', () => {
    expect(splitImageSrc(`${REF}?w=384`)).toEqual({ src: REF, width: 384, align: null });
    expect(splitImageSrc(`${REF}?a=right`)).toEqual({ src: REF, width: null, align: 'right' });
    expect(splitImageSrc(`${REF}?w=384&a=center`)).toEqual({ src: REF, width: 384, align: 'center' });
    expect(splitImageSrc(REF)).toEqual({ src: REF, width: null, align: null });
  });

  it('recognizes exactly the canonical grammar and passes everything else through verbatim', () => {
    // Both parsers must give back what they were given; a rewritten URL is the quiet loss the
    // image node exists to prevent. So the split is all-or-nothing: no partial extraction.
    for (const src of [
      `${REF}?w=abc`,
      `${REF}?w=384&x=1`,
      `${REF}?w=0`,
      `${REF}?w=0384`, // a leading zero would not reconstruct byte-identically
      `${REF}?w=12345`, // five digits is no display width
      `${REF}?a=middle`, // vertical alignment from an import, not ours
      `${REF}?a=right&w=384`, // wrong order — compose writes `w` first, so this is not ours
      `${REF}?w=384&a=right&x=1`,
      `${REF}?season=3`, // the render-only leg, never a stored one
      'https://example.com/a.jpg?w=300', // somebody else's `w`
    ]) {
      expect(splitImageSrc(src)).toEqual({ src, width: null, align: null });
    }
  });

  it('is an exact inverse pair, which is what keeps both halves spelling one string', () => {
    for (const width of [1, 192, 384, 768, 9999]) {
      for (const align of [null, 'left', 'right', 'center'] as const) {
        const stored = composeImageSrc(REF, width, align);
        expect(stored).toBe(`${REF}?w=${width}${align ? `&a=${align}` : ''}`);
        expect(splitImageSrc(stored)).toEqual({ src: REF, width, align });
      }
    }
    expect(composeImageSrc(REF, null, 'right')).toBe(`${REF}?a=right`);
    expect(splitImageSrc(composeImageSrc(REF, null, 'right'))).toEqual({
      src: REF,
      width: null,
      align: 'right',
    });
  });

  it('refuses to write what the split would not lift back off', () => {
    expect(composeImageSrc(REF, null)).toBe(REF);
    expect(composeImageSrc(REF, 0)).toBe(REF);
    expect(composeImageSrc(REF, 12.5)).toBe(REF);
    expect(composeImageSrc(REF, 10000)).toBe(REF);
    expect(composeImageSrc('https://example.com/a.jpg', 384)).toBe('https://example.com/a.jpg');
    expect(composeImageSrc('https://example.com/a.jpg', null, 'right')).toBe(
      'https://example.com/a.jpg',
    );
    // A reference that kept an unrecognized query rides verbatim in the node's src; appending
    // a second `?` would corrupt it, so presentation set on such a node is dropped instead.
    expect(composeImageSrc(`${REF}?w=abc`, 384, 'right')).toBe(`${REF}?w=abc`);
  });

  it('accepts the widths the spelling can store', () => {
    expect(isImageWidth(384)).toBe(true);
    expect(isImageWidth(0)).toBe(false);
    expect(isImageWidth(-1)).toBe(false);
    expect(isImageWidth(12.5)).toBe(false);
    expect(isImageWidth(10000)).toBe(false);
    expect(isImageWidth(Number('50%'))).toBe(false); // NaN, the DOM-attribute garbage case
    expect(isImageWidth(null)).toBe(false);
  });

  it('accepts the alignments the spelling can store', () => {
    expect(isImageAlign('left')).toBe(true);
    expect(isImageAlign('right')).toBe(true);
    expect(isImageAlign('center')).toBe(true);
    // The legacy attribute's other values meant vertical alignment; they stay untouched imports.
    expect(isImageAlign('top')).toBe(false);
    expect(isImageAlign('middle')).toBe(false);
    expect(isImageAlign('')).toBe(false);
    expect(isImageAlign(null)).toBe(false);
  });
});

describe('escapeAlt / escapeTitle', () => {
  it('escapes brackets, because file names carry them', () => {
    // The alt fallback is the original file name; „Saalplan [Entwurf].jpg" is an ordinary one.
    expect(escapeAlt('Saalplan [Entwurf]')).toBe('Saalplan \\[Entwurf\\]');
  });

  it('leaves the backslash alone, because the two parsers disagree about it', () => {
    // Escaping it grew one on every save: the reader unescapes `\\` to `\`, marked does not touch
    // it inside an alt, so `a\b` was stored as `a\\b`, then `a\\\\b`, forever (IMG-06). Bare is a
    // fixed point on both sides — a backslash before a non-punctuation character means nothing to
    // either. `escapeTitle` keeps its own escaping: a title is read back by neither of these
    // paths as an alt is.
    expect(escapeAlt('a\\b')).toBe('a\\b');
    // The escape mechanism still survives a backslash in front of a bracket: the reader reads
    // this as (escaped backslash)(literal bracket), marked as (literal backslash)(escaped
    // bracket) — two parses of one string, both yielding `\[`.
    expect(escapeAlt('\\[')).toBe('\\\\[');
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
