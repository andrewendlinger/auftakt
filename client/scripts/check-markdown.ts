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
 * …and the document it parsed into has to be **legal**, which round-tripping does not prove.
 *
 * `setContent` builds the doc with `Node.fromJSON`, which does not validate, and serializing walks
 * it without asking either — so a structurally invalid document passes render-equality and
 * idempotence happily, and only explodes later when something *edits* it. That is exactly what
 * WP-37 shipped: `@tiptap/extension-paragraph` unwraps a paragraph whose only child is an image,
 * which is correct for a block image node and wrong for ours, so `![x](…)` on its own line landed
 * as `doc > image` — inline content where the schema says `block+`. Every image fixture here was
 * green while clicking into such a note threw „Called contentMatchAt on a node with invalid
 * content" and the field refused to open.
 *
 * `doc.check()` is ProseMirror's own answer to „is this document legal", and the dispatch is the
 * cheapest way to reach the plugins that touch the end of the document (trailing-node), since that
 * is what the app does on mount and on every keystroke.
 */
const docIsLegal = (md: string): string | null => {
  // A **fresh editor, content at construction** — `setContent` is not the path the app takes and
  // not the path that breaks. It dispatches a replace step, and ProseMirror repairs an illegal
  // slice on the way in by fitting it into the schema; `useEditor({ content })` goes through
  // `Node.fromJSON`, which validates nothing and hands the editor a document it cannot survive
  // editing. Asserting through `setContent` would have found nothing at all.
  const probe = new Editor({ element: el, extensions: markdownExtensions(), content: md, contentType: 'markdown' });
  try {
    probe.state.doc.check();
    // The plugins that touch the end of the document (trailing-node) run on any transaction, so
    // this is what the placeholder nudge and the first keystroke do in the app.
    probe.view.dispatch(probe.state.tr);
    return null;
  } catch (err) {
    return `invalid document: ${(err as Error).message}`;
  } finally {
    probe.destroy();
  }
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

/** A stored image reference (WP-37): root-relative, season-free, 32 hex chars of content hash. */
const IMG = '/api/images/9f2a41c7b8e05d3a6c1f4b90e7d28a35';

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
  // WP-57. A *visible* blank line — an empty paragraph the user typed, over and above the gap
  // every paragraph break already has — is spelled `&nbsp;` on a line of its own, and that is the
  // only spelling either half of the dialect recognizes. The reader has always drawn it as
  // `<p> </p>`; the editor used to drop the marker for the first of any run of empty paragraphs,
  // so two typed blank lines came back as one and one between two lists came back as none — the
  // reported bug. Every case here is stored text the editor now writes and reads unchanged.
  blankLine: 'davor\n\n&nbsp;\n\ndanach',
  twoBlankLines: 'davor\n\n&nbsp;\n\n&nbsp;\n\ndanach',
  blankLineAtStart: '&nbsp;\n\ndanach',
  blankLineBeforeHeading: 'davor\n\n&nbsp;\n\n## Abschnitt',
  // The list cases the report names. A marker paragraph sits at column 0, so it ends the list in
  // marked and in micromark alike — which is what keeps „Liste, Leerzeile, Liste" two lists
  // instead of one run-together list of four items.
  blankLineAfterList: '- eins\n- zwei\n\n&nbsp;\n\nDanach.',
  twoBlankLinesAfterList: '- eins\n- zwei\n\n&nbsp;\n\n&nbsp;\n\nDanach.',
  blankLineBetweenLists: '- eins\n- zwei\n\n&nbsp;\n\n- drei\n- vier',
  // …and the shapes already in the database, written by the serializer this package repairs: a
  // bare run of blank lines, and the run-plus-one-marker the old rule produced for two typed blank
  // lines. A run of blank lines is a block separator and nothing more — CommonMark draws no gap
  // for it — so the editor must not invent paragraphs from one either, or opening and saving an
  // old note would add a blank line nobody typed. The second one migrates to the canonical
  // spelling on that save, which is why it must render the same before and after.
  blankLinesLegacy: 'davor\n\n\n\ndanach',
  blankLinesLegacyAfterList: '- eins\n- zwei\n\n\n\n&nbsp;\n\nDanach.',
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
  // The two shapes a fence written *by the bug* actually has, both of which the first cut of this
  // package got wrong. An indented block swallows the blank lines between its lines, so a fence
  // full of them is the norm, not an edge case — and rendering one as two hard breaks wrote back
  // a whitespace-only line, which reads as a paragraph break: the note re-shaped itself on save.
  // And the indentation is the whole reason these notes exist, so it has to reach the reader,
  // which for a Markdown paragraph means U+00A0 (`lib/legacyCode.ts`).
  legacyFenceBlankLine: '```\nSoundcheck 14:00\n\nEinlass 19:00\n```',
  legacyFenceIndented: '```\n  eingerückt in der ersten Zeile\nund bündig in der zweiten\n```',
  // Only an import or a restored backup can still carry this, and unwrapping it would collapse
  // its line breaks while the editor keeps them.
  rawPreTag: 'davor\n\n<pre>Soundcheck\nEinlass</pre>',
  inlineBackticksLegacy: 'ein `code` wort',
  inlineBackticksEscaped: 'ein \\`code\\` wort',
  // WP-37. Before the image node existed, every one of these came back out of the editor as its
  // alt text with the URL dropped — a picture silently becoming a word, which is why the plain
  // `image` case alone fails the gate on the unfixed code. `imageInline` is the one that pins
  // `inline: true`: the renderer puts an image inside its paragraph, so a block node would split
  // this sentence in two and disagree with the reader.
  image: `![Saalplan](${IMG})`,
  imageInline: `Davor ![Saalplan](${IMG}) danach.`,
  imageTitle: `![Saalplan](${IMG} "Großer Saal")`,
  imageNoAlt: `![](${IMG})`,
  imageBracketAlt: `![Plan \\[Entwurf\\]](${IMG})`,
  // Destinations the app never authors but a note can hold: an imported `https://` image (which
  // the reader does draw) and a `data:` URL (which the sanitizer strips the src from, so it draws
  // broken). Both must still survive the editor verbatim — giving back what you were given is the
  // whole repair, and re-writing either one would be a second, quieter loss.
  imageHttpsLegacy: '![x](https://example.com/a.jpg)',
  imageDataUrlLegacy: '![x](data:image/jpeg;base64,AAAA)',
  imageSpacedUrlLegacy: '![x](<https://e.org/a b.jpg>)',
  // A backslash in the alt — a file name really can carry one, and the alt fallback *is* the file
  // name. It used to gain one on every save (`a\b` → `a\\b` → `a\\\\b`) because the reader
  // unescapes `\\` and marked does not: the first pass still rendered equal, so only the
  // idempotence assertion catches it. That is why this entry exists rather than a bracket variant.
  imageBackslashAlt: `![a\\b](${IMG})`,
  imageBackslashBeforeBracket: `![a\\\\[b](${IMG})`,
  // A link around an image, which no toolbar authors but an import carries. The destination used
  // to be dropped on save — the mark reached neither the node (the parser cannot mark an atom) nor
  // the output (the serializer only writes marks around text).
  imageLinked: `[![Saalplan](${IMG})](https://example.com)`,
  imageLinkedInline: `Davor [![Saalplan](${IMG})](https://example.com) danach.`,
  imageLinkedTitle: `[![Saalplan](${IMG})](https://example.com "Zur Seite")`,
  imageInList: `- eins\n- ![Saalplan](${IMG})\n- drei`,
  imageInTable: `| Raum | Plan |\n| --- | --- |\n| Saal | ![Saalplan](${IMG}) |`,
  imageInQuote: `> Achtung ![Saalplan](${IMG})`,
  // Only an import or a restored backup can carry raw `<img>`, and it used to be deleted outright.
  // The block case needs `rehypeImgToParagraph` — at the root the reader leaves the tag unwrapped
  // while the editor round-trip puts it in a paragraph.
  imageRawTagInline: `Davor <img src="${IMG}" alt="y"> danach.`,
  imageRawTagBlock: `davor\n\n<img src="${IMG}" alt="y">\n\ndanach`,
  // …and nested inside another block, which is how such markup actually arrives. The plugin used
  // to map the root's direct children only, so the reader left this `<img>` outside any paragraph
  // while the editor read it into one: the note re-spaced itself when you clicked in and again
  // when you clicked away. A blockquote, not a `<div>`, because ProseMirror has a node for it —
  // an unknown wrapper is dropped by the editor for reasons that have nothing to do with images.
  // The same tag in a list item is deliberately *not* a case here: the round-trip writes a loose
  // item (`- …\n\n`), and remark then renders `<li>\n<p>…</p>\n</li>` against the tight
  // `<li><p>…</p></li>`. The two differ only in whitespace between block elements — nothing a
  // browser draws differently — but string equality cannot say so, and the list spread has nothing
  // to do with images.
  imageRawTagInQuote: `> <img src="${IMG}" alt="y">`,
  // A display width is spelled `?w=` on our own reference and nowhere else (WP-37 follow-up).
  // `splitImageSrc` lifts it into a `width` attribute on both sides — the editor in
  // `parseMarkdown`, the reader in `rehypeImgWidth` — and `composeImageSrc` writes it back, so
  // the string must round-trip byte-identically wherever an image can sit.
  imageWidth: `![Saalplan](${IMG}?w=384)`,
  imageWidthInline: `Davor ![Saalplan](${IMG}?w=192) danach.`,
  imageWidthTitle: `![Saalplan](${IMG}?w=384 "Großer Saal")`,
  imageWidthLinked: `[![Saalplan](${IMG}?w=384)](https://example.com)`,
  imageWidthInTable: `| Raum | Plan |\n| --- | --- |\n| Saal | ![Saalplan](${IMG}?w=192) |`,
  // …and everything the spelling does *not* recognize passes through verbatim on both sides:
  // a query that is not exactly `w=<int>`, and a foreign URL whose `?w=` belongs to somebody
  // else's server. Rewriting either would be the quiet loss the image node exists to prevent.
  imageWidthGarbage: `![x](${IMG}?w=abc)`,
  imageWidthTwoParams: `![x](${IMG}?w=384&x=1)`,
  imageWidthForeignQuery: '![x](https://example.com/a.jpg?w=300)',
  // A raw tag's `width` attribute survives an edit, re-spelled as `?w=` — before the schema had a
  // `width` attr, the demo's own `<img … width="120">` fixture silently lost it on the first
  // keystroke. Attribute order matches `mdast-util-to-hast` (src, alt, then the lifted width), so
  // the two render paths agree at string level.
  imageRawTagWidth: `Davor <img src="${IMG}" alt="y" width="120"> danach.`,
  // The alignment leg (`?a=`), alone, combined with the width in canonical order, and everything
  // the grammar refuses: the wrong order and a value that is not left/right/center (imports carry
  // `top`/`middle`, which meant vertical alignment) pass through verbatim on both sides.
  imageAlignRight: `![Saalplan](${IMG}?a=right)`,
  imageAlignCenter: `![Saalplan](${IMG}?a=center)`,
  imageWidthAlign: `![Saalplan](${IMG}?w=384&a=right)`,
  imageAlignWrongOrder: `![x](${IMG}?a=right&w=384)`,
  imageAlignGarbage: `![x](${IMG}?a=middle)`,
  // …and the imported raw shape the demo seeds (`width` + `align`), which used to lose both on
  // the first keystroke. Attribute order src/alt/width/align matches the lift order in
  // `rehypeImgQuery`, which is what keeps the two render paths string-equal.
  imageRawTagAligned: `Davor <img src="${IMG}" alt="y" width="120" align="right"> danach.`,
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
  // Both directions: the stored text must parse into a legal document, and so must what the
  // editor writes back — an invalid doc that serializes cleanly is exactly the failure this
  // catches, and it is invisible to the three assertions above.
  const illegal = docIsLegal(md) ?? docIsLegal(out1);
  if (renderEqual && idempotent && clean && codeFree && !illegal) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures++;
  console.log(
    `  FAIL ${name}${renderEqual ? '' : '  [render differs]'}${idempotent ? '' : '  [not idempotent]'}${clean ? '' : '  [control chars]'}${codeFree ? '' : '  [renders code]'}${illegal ? `  [${illegal}]` : ''}`,
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

/**
 * The clipboard gate (WP-37): an `<img>` reaches the document only if it is one of ours.
 *
 * ProseMirror parses pasted HTML with the node's own `parseHTML` rules, so an unqualified
 * `img[src]` quietly turned „paste a picture from a web page" into a supported path — with the
 * `src` verbatim, past the resize → JPEG → 1.5 MB upload that `DECISIONS.md` says is the only way
 * an image enters the app. A `data:` one then writes hundreds of kilobytes of base64 into a text
 * column, and the reader's sanitizer strips it again, so the bloat lands and the picture does not.
 *
 * `insertContent` with an HTML string runs the same DOM rules the clipboard does, which is what
 * makes this reachable headlessly. The Markdown side stays wide open on purpose — `imageHttpsLegacy`
 * and `imageDataUrlLegacy` above assert that a *stored* foreign source still round-trips.
 */
const parseHtml = (html: string) => {
  editor.commands.setContent('', { contentType: 'markdown' });
  editor.commands.insertContent(html);
  return editor.getMarkdown();
};

const clipboard: Array<[string, string, boolean]> = [
  ['unsere eigene Referenz', `<p>davor <img src="${IMG}" alt="y"> danach</p>`, true],
  ['mit Saison-Pin (Kopie im Editor)', `<p><img src="${IMG}?season=3" alt="y"></p>`, true],
  ['mit Breite (Kopie im Editor)', `<p><img src="${IMG}?season=3" width="360" alt="y"></p>`, true],
  ['mit unlesbarer Breite', `<p><img src="${IMG}" width="50%" alt="y"></p>`, true],
  ['mit Breite und Ausrichtung', `<p><img src="${IMG}?season=3" width="360" align="right" alt="y"></p>`, true],
  ['mit unlesbarer Ausrichtung', `<p><img src="${IMG}" align="top" alt="y"></p>`, true],
  ['data: aus einer Webseite', '<p><img src="data:image/png;base64,AAAA" alt="y"></p>', false],
  ['https: aus einer Webseite', '<p><img src="https://example.com/a.jpg" alt="y"></p>', false],
  ['file:// aus dem Dateisystem', '<p><img src="file:///Users/x/a.jpg" alt="y"></p>', false],
];

for (const [name, html, admitted] of clipboard) {
  const out = parseHtml(html);
  const hasImage = out.includes('![');
  if (hasImage === admitted) {
    console.log(`  ok   clipboard: ${name}`);
  } else {
    failures++;
    console.log(
      `  FAIL clipboard: ${name}  [${admitted ? 'sollte übernommen werden' : 'sollte verworfen werden'}]`,
    );
    console.log(`       out md : ${JSON.stringify(out)}`);
  }
}

// The pin is stripped on the way in, so a copy inside the editor cannot store one season's URL in
// another season's note — the reason `canonicalImageSrc` runs before the check above.
const pinned = parseHtml(`<p><img src="${IMG}?season=3" alt="y"></p>`);
if (pinned.includes('?season=')) {
  failures++;
  console.log(`  FAIL clipboard: der Saison-Pin darf nicht gespeichert werden`);
  console.log(`       out md : ${JSON.stringify(pinned)}`);
} else {
  console.log('  ok   clipboard: der Saison-Pin wird beim Lesen entfernt');
}

// …while a width travels the other way: the DOM attribute a copied `<img>` carries is stored as
// `?w=`, still without the pin. A width the spelling does not accept is dropped, not stored.
const sized = parseHtml(`<p><img src="${IMG}?season=3" width="360" alt="y"></p>`);
if (!sized.includes(`(${IMG}?w=360)`) || sized.includes('?season=')) {
  failures++;
  console.log(`  FAIL clipboard: die Breite wird als ?w= gespeichert, der Pin nicht`);
  console.log(`       out md : ${JSON.stringify(sized)}`);
} else {
  console.log('  ok   clipboard: die Breite wird als ?w= gespeichert, der Pin nicht');
}
const unsized = parseHtml(`<p><img src="${IMG}" width="50%" alt="y"></p>`);
if (unsized.includes('?w=')) {
  failures++;
  console.log(`  FAIL clipboard: eine unlesbare Breite darf nicht gespeichert werden`);
  console.log(`       out md : ${JSON.stringify(unsized)}`);
} else {
  console.log('  ok   clipboard: eine unlesbare Breite wird verworfen');
}
const aligned = parseHtml(`<p><img src="${IMG}?season=3" width="360" align="right" alt="y"></p>`);
if (!aligned.includes(`(${IMG}?w=360&a=right)`) || aligned.includes('?season=')) {
  failures++;
  console.log(`  FAIL clipboard: Breite und Ausrichtung werden kanonisch gespeichert, der Pin nicht`);
  console.log(`       out md : ${JSON.stringify(aligned)}`);
} else {
  console.log('  ok   clipboard: Breite und Ausrichtung werden kanonisch gespeichert, der Pin nicht');
}
const misaligned = parseHtml(`<p><img src="${IMG}" align="top" alt="y"></p>`);
if (misaligned.includes('?a=')) {
  failures++;
  console.log(`  FAIL clipboard: eine unlesbare Ausrichtung darf nicht gespeichert werden`);
  console.log(`       out md : ${JSON.stringify(misaligned)}`);
} else {
  console.log('  ok   clipboard: eine unlesbare Ausrichtung wird verworfen');
}

/**
 * The editor must *understand* the width spelling, not merely carry it.
 *
 * String equality cannot see the difference: an editor that kept `?w=384` verbatim in the node's
 * `src` would round-trip every corpus case above byte-identically — and draw the image full-size
 * while the reader draws it at 384, and silently refuse to re-size it (the size buttons write the
 * `width` attribute, and `composeImageSrc` refuses a src that already carries a query). So this
 * asserts the parsed node directly: the query is lifted into `width`, and the editor's own
 * rendered `<img>` carries it — the WYSIWYG half the size buttons and the paste path read back.
 */
editor.commands.setContent(`![x](${IMG}?w=384&a=right)`, { contentType: 'markdown' });
// Structural, like `getAttrs` in richtext.ts: the JSON node union has no `attrs` on text nodes.
type LooseNode = {
  type?: string;
  attrs?: { src?: string; width?: number | null; align?: string | null };
  content?: LooseNode[];
};
const imageAttrs = ((editor.getJSON() as LooseNode).content ?? [])
  .flatMap((node) => node.content ?? [])
  .filter((node) => node.type === 'image')
  .map((node) => node.attrs);
if (
  imageAttrs.length !== 1 ||
  imageAttrs[0]?.src !== IMG ||
  imageAttrs[0]?.width !== 384 ||
  imageAttrs[0]?.align !== 'right'
) {
  failures++;
  console.log('  FAIL node: ?w=/?a= werden nicht in die width/align-Attribute gehoben');
  console.log(`       attrs  : ${JSON.stringify(imageAttrs)}`);
} else if (!editor.getHTML().includes('width="384"') || !editor.getHTML().includes('align="right"')) {
  failures++;
  console.log('  FAIL node: width/align erreichen das gezeichnete <img> nicht');
  console.log(`       html   : ${editor.getHTML()}`);
} else {
  console.log('  ok   node: ?w=/?a= werden zu width/align, im Dokument und im gezeichneten <img>');
}

/**
 * What the editor *writes* for a document it built itself (WP-57).
 *
 * The corpus can only ever say „this stored string survives a round-trip". It cannot say how a
 * document the user typed is spelled in the first place, and both halves of this package are
 * exactly that: an empty paragraph between two lists has to come out as a `&nbsp;` at column 0 —
 * the only thing that keeps the lists apart, and the case the report is about — while the empty
 * paragraph `TrailingNode` appends after a list has to come out as nothing at all. Seeding the
 * document directly is the only way to tell those two apart, since Markdown spells them the same.
 */
const bullet = (text: string) => ({ type: 'listItem', content: [para(text)] });
const bulletList = (...texts: string[]) => ({ type: 'bulletList', content: texts.map(bullet) });
const emptyPara = { type: 'paragraph' };
const serialized: Array<[string, JSONContent, string]> = [
  [
    'eine Leerzeile zwischen zwei Listen',
    { type: 'doc', content: [bulletList('eins', 'zwei'), emptyPara, bulletList('drei', 'vier')] },
    '- eins\n- zwei\n\n&nbsp;\n\n- drei\n- vier',
  ],
  [
    'zwei Leerzeilen nach einer Liste',
    { type: 'doc', content: [bulletList('eins', 'zwei'), emptyPara, emptyPara, para('Danach.')] },
    '- eins\n- zwei\n\n&nbsp;\n\n&nbsp;\n\nDanach.',
  ],
  [
    'der Absatz, den TrailingNode anhängt, wird nicht gespeichert',
    { type: 'doc', content: [bulletList('eins', 'zwei'), emptyPara] },
    '- eins\n- zwei',
  ],
  [
    'die ganze Schluss-Serie leerer Absätze wird nicht gespeichert, nicht nur der letzte',
    { type: 'doc', content: [bulletList('eins', 'zwei'), emptyPara, emptyPara] },
    '- eins\n- zwei',
  ],
  ['eine leere Notiz bleibt leer', { type: 'doc', content: [emptyPara] }, ''],
];

for (const [name, doc, expected] of serialized) {
  editor.commands.setContent(doc);
  const out = editor.getMarkdown();
  if (out === expected) {
    console.log(`  ok   serialize: ${name}`);
  } else {
    failures++;
    console.log(`  FAIL serialize: ${name}`);
    console.log(`       out md : ${JSON.stringify(out)}`);
    console.log(`       soll   : ${JSON.stringify(expected)}`);
  }
}

editor.destroy();
const total = Object.keys(corpus).length + Object.keys(jsonCorpus).length;
if (failures) {
  console.error(`\nmarkdown round-trip: ${failures} case(s) failed`);
  process.exit(1);
}
console.log(
  `\nmarkdown round-trip: all ${total} cases render-equal, idempotent, control-char free and code free` +
    `, and all ${clipboard.length + 6 + serialized.length} clipboard, node and serialize assertions hold`,
);
