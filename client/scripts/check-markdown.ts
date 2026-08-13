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
 *   3. no code          — neither side renders a `<pre>` or a `<code>` (WP-49)
 *
 * The third is not implied by the first: render-equality compares two runs of the *same*
 * renderer, so a construct both sides agree to draw as code passes it happily. „Auftakt-Text
 * kennt keinen Code" is a claim about the output itself, and this is where it is checked.
 *
 * The editor half runs headless via jsdom using the exact `markdownExtensions()` the app
 * ships; the render half rebuilds `Markdown.tsx`'s remark/rehype pipeline in Node. Run with
 * `npm run check:markdown` (root) or `npm --prefix client run check:markdown`.
 */
import { JSDOM } from 'jsdom';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import type { JSONContent } from '@tiptap/core';
import { rehypePlugins, remarkPlugins } from '../src/lib/markdownPipeline.js';

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

// --- render pipeline: the plugins Markdown.tsx ships, not a copy of them --------------
// Only the ends differ — react-markdown builds its own processor and renders to React, this one
// parses and stringifies. Everything the dialect is made of comes from the shared module.
const renderer = unified()
  .use(remarkParse)
  .use(remarkPlugins)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypePlugins)
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

/** WP-49: nothing the app stores may render as code, whatever it looked like when it arrived. */
const CODE_TAGS = /<(pre|code)[\s>]/;

/** The indent unit Tab writes (RichTextEditor). Plain spaces cannot survive a paragraph. */
const NBSP = '\u00a0';

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
  // a line break in a cell used to be flattened to a space. The third case reached that bug
  // through a code span — WP-49 has since removed those, and the entry now guards what is left of
  // it: a cell whose text happens to carry backticks still escapes its pipe, and the backticks
  // come out as the characters they are.
  tablePipeInCell: '| a | b |\n| --- | --- |\n| x \\| y | 2 |',
  tableHardBreakInCell: '| Rolle | Person |\n| --- | --- |\n| Licht | erste<br>zweite |',
  tableBackticksInCell: '| a | b |\n| --- | --- |\n| \\`x \\| y\\` | 2 |',
  // WP-49, the whole package. `indentedParagraph` is the reported bug: four leading spaces are
  // typeable in the editor, so they must survive as prose instead of turning grey — and survive
  // *verbatim*, since silently dropping them is what the naive fix does. The two fences are what
  // that bug already wrote into real databases; their markers go, the text stays, and what stood
  // inside one stays literal because it was never Markdown. The backticks come from both eras —
  // stored raw before, escaped by the serializer now — and must read the same either way.
  indentedParagraph: 'Absatz.\n\n    vier Leerzeichen davor',
  legacyFence: '```\nAufbau ab 14:00\nEinlass 19:00\n```',
  legacyFenceWithMarks: '```js\nein *stern* und <u>u</u>\n```',
  inlineBackticksLegacy: 'ein `code` wort',
  inlineBackticksEscaped: 'ein \\`code\\` wort',
  // Spelled from the escape, never typed: a literal U+00A0 in a fixture is invisible, and the
  // next editor to touch this file would „fix" it back into a plain space.
  nbspIndent: `${NBSP.repeat(3)}Aufbau ab 14:00\n${NBSP.repeat(6)}Soundcheck`,
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
  const codeFree = !CODE_TAGS.test(render(md)) && !CODE_TAGS.test(render(out1));
  if (renderEqual && idempotent && clean && codeFree) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures++;
  console.log(
    `  FAIL ${name}${renderEqual ? '' : '  [render differs]'}${idempotent ? '' : '  [not idempotent]'}${clean ? '' : '  [control chars]'}${codeFree ? '' : '  [renders code]'}`,
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
  if (!codeFree) {
    console.log(`       in  html: ${render(md)}`);
    console.log(`       out html: ${render(out1)}`);
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
console.log(
  `\nmarkdown round-trip: all ${total} cases render-equal, idempotent, control-char free and code free`,
);
