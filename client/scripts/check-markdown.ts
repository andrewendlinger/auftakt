/**
 * Round-trip gate for the rich-text editor.
 *
 * WP-Q keeps Markdown as the storage format, so the load-bearing invariant is:
 * feeding stored Markdown through the editor and serializing it back must render
 * **identically** under the app's own renderer (`client/src/components/Markdown.tsx`).
 *
 * For every corpus entry this asserts:
 *   1. render-equality  — HTML(input) === HTML(editor round-trip of input)
 *   2. idempotence      — a second round-trip equals the first (stable output)
 *
 * The editor half runs headless via jsdom using the exact `markdownExtensions()` the app
 * ships; the render half rebuilds `Markdown.tsx`'s remark/rehype pipeline in Node. Run with
 * `npm run check:markdown` (root) or `npm --prefix client run check:markdown`.
 */
import { JSDOM } from 'jsdom';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import type { JSONContent } from '@tiptap/core';

// --- jsdom so TipTap (ProseMirror) can mount headless --------------------------------
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
g.DOMParser = dom.window.DOMParser;
g.HTMLElement = dom.window.HTMLElement;
g.Node = dom.window.Node;
g.getComputedStyle = dom.window.getComputedStyle;

const { Editor } = await import('@tiptap/core');
const { markdownExtensions } = await import('../src/lib/richtext.js');

// --- render pipeline: same chain as Markdown.tsx -------------------------------------
// remark-gfm + remark-breaks, then raw HTML kept and sanitized with <u> whitelisted.
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'u'],
};
const renderer = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkBreaks)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize, sanitizeSchema)
  .use(rehypeStringify);
const render = (md: string) => String(renderer.processSync(md)).trim();

// --- headless editor ------------------------------------------------------------------
const el = dom.window.document.createElement('div');
dom.window.document.body.appendChild(el);
const editor = new Editor({ element: el, extensions: markdownExtensions(), content: '' });
const roundtrip = (md: string) => {
  editor.commands.setContent(md, { contentType: 'markdown' });
  return editor.getMarkdown();
};

/**
 * C0 controls except tab and newline. Stored Markdown is plain text a human edits and a backup
 * round-trips; a control character in it is corruption, not formatting. WP-30 found one being
 * written for real — the table serializer joined the blocks of a multi-block cell with U+001F.
 */
const CONTROL_CHARS = /[\x00-\x08\x0b-\x1f]/;

// --- corpus: every authored construct + realistic prose, incl. legacy <u> ------------
const corpus: Record<string, string> = {
  bold: 'A **bold** word.',
  italic: 'An *italic* word.',
  boldItalic: '***both at once***',
  underlineLegacy: 'An <u>underlined</u> phrase from an old note.',
  mixedMarks: '**bold and <u>underlined</u>** together.',
  bullets: '- one\n- two\n- three',
  nestedBullets: '- one\n- two\n   - nested a\n   - nested b\n- three',
  ordered: '1. first\n2. second\n3. third',
  nestedOrdered: '1. a\n2. b\n   1. b-one\n   2. b-two\n3. c',
  mixedNesting: '- bullet parent\n   1. ordered child\n   2. second child',
  link: 'See [the site](https://example.com).',
  bareUrl: 'Visit https://example.com now.',
  mailto: 'Mail [uns](mailto:info@example.com) bitte.',
  softBreak: 'line one\nline two\nline three',
  paraBreak: 'para one\n\npara two',
  heading: '# Titel\n\n## Abschnitt\n\n### Unterpunkt',
  quote: '> ein Zitat\n> über zwei Zeilen',
  table: '| Instrument | Anzahl |\n| --- | --- |\n| Geige | 4 |\n| Cello | 2 |',
  // The shapes the toolbar can now produce, since WP-29 made tables reachable from the notes
  // fields and added row/column controls.
  tableMarks: '| **Rolle** | Person |\n| --- | --- |\n| *Licht* | [Anna](https://example.com) |\n| Ton | <u>Ben</u> |',
  tableEmptyCell: '| Rolle | Person |\n| --- | --- |\n| Licht |  |\n| Ton | Ben |',
  tableAligned: '| Rolle | Anzahl |\n| :--- | ---: |\n| Licht | 2 |',
  tableSingleColumn: '| Aufgabe |\n| --- |\n| Aufbau |\n| Abbau |',
  tableBetweenParas: 'Davor.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nDanach.',
  // WP-30. A `|` in a cell used to be written back unescaped and re-read as a column separator;
  // a line break in a cell used to be flattened to a space. The code-span case is the same bug
  // seen from the other side: the editor's own tokenizer re-escapes those pipes on the way in, so
  // an unescaped `` `x | y` `` round-tripped through TipTap while `remark-gfm` — the app's actual
  // renderer — read it as three columns.
  tablePipeInCell: '| a | b |\n| --- | --- |\n| x \\| y | 2 |',
  tableHardBreakInCell: '| Rolle | Person |\n| --- | --- |\n| Licht | erste<br>zweite |',
  tablePipeInCode: '| a | b |\n| --- | --- |\n| `x \\| y` | 2 |',
  emoji: 'Auftakt 🎉 geschafft 🙂 — super!',
  // A realistic ~1-page project description, the shape WP-Q's feedback singled out.
  longProse: [
    '# Projektbeschreibung',
    '',
    'Das **Eröffnungskonzert** findet im großen Saal statt. Wichtige Punkte:',
    '',
    '- Soundcheck ab 14:00',
    '- Einlass 19:00',
    '   1. VIP-Gäste zuerst',
    '   2. dann Abendkasse',
    '- Beginn 20:00',
    '',
    'Kontakt über [die Website](https://festival.example.com) oder per Mail.',
    '',
    '## Technik',
    '',
    'Die Bühne braucht <u>zwingend</u> zwei Monitore.',
    '',
    '| Position | Person |',
    '| --- | --- |',
    '| Licht | Anna |',
    '| Ton | Ben |',
    '',
    '> Achtung: Aufbau nur mit Helm 🎧',
  ].join('\n'),
};

// --- JSON-seeded cases: shapes the editor can produce but Markdown cannot spell -------
// A cell holding two paragraphs has no GFM syntax — `<br>` reads back as one paragraph with a
// hard break — yet the editor makes one as soon as you press Enter inside a cell. Seeding from
// ProseMirror JSON is the only way to reach that branch of the table serializer.
const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const jsonCorpus: Record<string, JSONContent> = {
  tableTwoBlocksInCell: {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [para('Rolle')] },
              { type: 'tableHeader', content: [para('Notiz')] },
            ],
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [para('Licht')] },
              { type: 'tableCell', content: [para('erster Absatz'), para('zweiter Absatz')] },
            ],
          },
        ],
      },
    ],
  },
};

let failures = 0;

const assertMarkdown = (name: string, md: string, source: 'md' | 'json') => {
  const out1 = roundtrip(md);
  const out2 = roundtrip(out1);
  const renderEqual = render(md) === render(out1);
  const idempotent = out1 === out2;
  const clean = !CONTROL_CHARS.test(md) && !CONTROL_CHARS.test(out1);
  if (renderEqual && idempotent && clean) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures++;
  console.log(
    `  FAIL ${name}${renderEqual ? '' : '  [render differs]'}${idempotent ? '' : '  [not idempotent]'}${clean ? '' : '  [control chars]'}`,
  );
  if (!renderEqual) {
    console.log(`       ${source === 'json' ? 'json md' : 'in  md '}: ${JSON.stringify(md)}`);
    console.log(`       out md : ${JSON.stringify(out1)}`);
    console.log(`       in  html: ${render(md)}`);
    console.log(`       out html: ${render(out1)}`);
  }
  if (!idempotent) {
    console.log(`       pass1  : ${JSON.stringify(out1)}`);
    console.log(`       pass2  : ${JSON.stringify(out2)}`);
  }
  if (!clean) {
    console.log(`       md     : ${JSON.stringify(md)}`);
  }
};

for (const [name, md] of Object.entries(corpus)) {
  assertMarkdown(name, md, 'md');
}

for (const [name, doc] of Object.entries(jsonCorpus)) {
  editor.commands.setContent(doc);
  assertMarkdown(name, editor.getMarkdown(), 'json');
}

editor.destroy();
const total = Object.keys(corpus).length + Object.keys(jsonCorpus).length;
if (failures) {
  console.error(`\nmarkdown round-trip: ${failures} case(s) failed`);
  process.exit(1);
}
console.log(`\nmarkdown round-trip: all ${total} cases render-equal, idempotent and control-char free`);
