// Reading a `page.pdf()` back.
//
// The print sheets are the one surface whose defects exist *only on paper*: `page.pdf()`'s
// default `printBackground: false` is itself the SHL-11 repro, and a screenshot can never show
// that class of bug because screenshots always paint backgrounds. So the print cases assert
// against the PDF's own bytes.
//
// Chromium writes a plain PDF 1.4 — classic `n 0 obj` bodies, an xref table, no object streams —
// with FlateDecode content streams, so `node:zlib` is the whole of what is needed to read one and
// no dependency is added for it. Text is hex glyph ids against a subset font, which is why
// nothing below reads *words*: paging assertions are made on paint order and on fill colours,
// both of which survive without the font's ToUnicode map (docs/VERIFYING.md says the same about
// pdfjs-dist, which is the other way and is a dependency).

import { inflateSync } from 'node:zlib';

/** Object `num`'s dictionary as latin1 — it stops at `stream`, so it never carries binary. */
export function pdfDict(raw, num) {
  const at = raw.indexOf(`\n${num} 0 obj`);
  if (at < 0) return '';
  const end = raw.indexOf('endobj', at);
  const stream = raw.indexOf('stream', at);
  return raw.slice(at, stream >= 0 && stream < end ? stream : end);
}

/**
 * Object `num`'s stream, inflated when the dictionary says FlateDecode.
 *
 * Sliced by the dictionary's own `/Length` rather than by searching for `endstream`: a compressed
 * stream is arbitrary bytes and may well contain that word, and a regex over the whole file would
 * then hand back a truncated — or a spliced — stream that inflates to nothing.
 */
export function pdfStream(raw, buf, num) {
  const at = raw.indexOf(`\n${num} 0 obj`);
  const m = /stream\r?\n/.exec(raw.slice(at));
  if (at < 0 || !m) return '';
  const dict = pdfDict(raw, num);
  const start = at + m.index + m[0].length;
  const bytes = buf.subarray(start, start + Number(/\/Length (\d+)/.exec(dict)?.[1] ?? 0));
  if (!/FlateDecode/.test(dict)) return bytes.toString('latin1');
  try {
    return inflateSync(bytes).toString('latin1');
  } catch {
    return '';
  }
}

/**
 * The decoded content stream of every page, **in page order** — which is the `/Kids` array's
 * order, not the order the objects happen to be written in.
 */
export function pdfPages(buf) {
  const raw = buf.toString('latin1');
  const kids = /\/Type\s*\/Pages[^>]*\/Kids\s*\[([^\]]*)\]/.exec(raw);
  if (!kids) throw new Error('kein /Pages-Knoten im PDF');
  return [...kids[1].matchAll(/(\d+) 0 R/g)]
    .map((m) => pdfDict(raw, Number(m[1])))
    .map((dict) => {
      const one = /\/Contents (\d+) 0 R/.exec(dict);
      const many = /\/Contents \[([^\]]*)\]/.exec(dict);
      const refs = one
        ? [Number(one[1])]
        : [...(many?.[1] ?? '').matchAll(/(\d+) 0 R/g)].map((r) => Number(r[1]));
      return refs.map((r) => pdfStream(raw, buf, r)).join('\n');
    });
}

/** `rgb(11, 95, 233)` → `[11, 95, 233]`, so the expectation can be read off the page itself. */
export const rgbOf = (css) => (css.match(/\d+/g) ?? []).slice(0, 3).map(Number);

/** Skia rounds its own way, and a `.7255 .1098 .1098 rg` is 185,28,28 only to within a unit. */
export const nearRgb = (a, b) => a.length === 3 && b.length === 3 && a.every((v, i) => Math.abs(v - b[i]) <= 2);

/** Every non-stroking fill a content stream sets, as `[r,g,b]` 0..255, in paint order. */
export const pdfFills = (content) =>
  [...content.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) rg/g)].map((m) => ({
    rgb: [Math.round(Number(m[1]) * 255), Math.round(Number(m[2]) * 255), Math.round(Number(m[3]) * 255)],
    at: m.index ?? 0,
  }));

/** One parse per PDF: the pages, and every fill on all of them. */
export function sheet(buf) {
  const pages = pdfPages(buf);
  return { buf, pages, fills: pages.flatMap((p) => pdfFills(p)) };
}

export const painted = (s, css) => s.fills.some((f) => nearRgb(f.rgb, rgbOf(css)));

/** How often the sheet fills in that colour — „once" is what pins a fill to one element. */
export const paintedTimes = (s, css) => s.fills.filter((f) => nearRgb(f.rgb, rgbOf(css))).length;

/**
 * Where a colour is painted in the sheet, and how much text sits before and after it *on that
 * page*. Both counts are of text-showing operators, not of words: one `Tj` is one glyph run, and
 * how many glyphs a run holds is a property of the font, not of the layout — so the numbers are
 * only ever compared against another measurement of the same document, never against a constant.
 */
export function paintedAt(s, css) {
  const want = rgbOf(css);
  for (let i = 0; i < s.pages.length; i++) {
    const hit = pdfFills(s.pages[i]).find((f) => nearRgb(f.rgb, want));
    if (!hit) continue;
    const text = [...s.pages[i].matchAll(/T[jJ]/g)].map((m) => m.index ?? 0);
    return {
      page: i + 1,
      pages: s.pages.length,
      before: text.filter((t) => t < hit.at).length,
      after: text.filter((t) => t > hit.at).length,
    };
  }
  return { page: 0, pages: s.pages.length, before: 0, after: 0 };
}

export const where = (p) => `Seite ${p.page}/${p.pages}, ${p.before} Textläufe davor, ${p.after} danach`;

/**
 * A4, not `page.pdf()`'s default Letter. The print block's numbers are A4's — „A4 inside the
 * 14 mm @page margins leaves ~269 mm" is what the image cap is derived from — and the customer's
 * printer is a German one, so Letter would measure a page nobody prints.
 *
 * `printBackground` is left at its default `false` **on purpose**: that is the SHL-11 repro, and
 * passing `true` would make every colour assertion below pass against the defect.
 */
export const printPdf = (page) => page.pdf({ format: 'A4' });

/**
 * Take a second PDF with one print rule overridden, and hand back both — the in-run proof that a
 * paper assertion is about the rule under test rather than about something Chromium does anyway.
 *
 * The override is `!important` inside `@media print`, which beats index.css on cascade rather
 * than on order, and the tag is removed again so the page is the shipped one afterwards.
 */
export async function withoutPrintRule(page, css) {
  const tag = await page.addStyleTag({ content: `@media print { ${css} }` });
  const buf = await printPdf(page);
  await tag.evaluate((el) => {
    el.parentNode?.removeChild(el);
  });
  return sheet(buf);
}
