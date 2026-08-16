import StarterKit from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { Document } from '@tiptap/extension-document';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Markdown, type MarkdownExtensionOptions } from '@tiptap/markdown';
import { Table, renderTableToMarkdown } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Extension, Mark, Node, mergeAttributes, type AnyExtension, type JSONContent } from '@tiptap/core';
import { NodeSelection, Plugin } from '@tiptap/pm/state';
import { Lexer, Marked, type TokensList } from 'marked';
import { fenceParagraphs } from './legacyCode';
import {
  canonicalImageSrc,
  composeImageSrc,
  encodeSrc,
  escapeTitle,
  imageMarkdown,
  isImageAlign,
  isImageRef,
  isImageWidth,
  splitImageSrc,
  type ImageAlign,
} from './imageRef';
import { textColorClass, textColorFromClass } from './textColor';

/**
 * Underline is serialized as raw `<u>…</u>`, not TipTap's default `++…++`.
 *
 * The app's Markdown renderer (`Markdown.tsx`) whitelists `<u>` and has no `++` syntax, so
 * `++text++` would render as the literal characters. Reading `<u>` back into the mark already
 * works via the extension's `parseHTML` (`tag: 'u'`) — only the serialize direction needs
 * overriding.
 */
const MdUnderline = Underline.extend({
  renderMarkdown(node, helpers) {
    return `<u>${helpers.renderChildren(node)}</u>`;
  },
});

/**
 * Schriftfarbe im Text (WP-62) — the same trick as `MdUnderline`, one step further.
 *
 * Markdown cannot spell a colour, so the mark serializes to a raw `<span class="tc-rot">…</span>`
 * and the reader whitelists exactly that: `sanitizeSchema` (`lib/markdownPipeline.ts`) admits a
 * `className` matching `TEXT_COLOR_CLASS` on a `span`, and `index.css` is what paints it. The
 * spelling itself lives in `lib/textColor.ts`, which is the only thing the two halves share — and
 * they must change together, like every other rule in this module.
 *
 * **A class, not a `style` attribute**, which is also why this is a mark of our own rather than
 * `@tiptap/extension-text-style` + `@tiptap/extension-color`: those two store into `style`, and
 * freeing `style` in the sanitize schema would put arbitrary CSS into stored text that is also
 * *imported* (a Notion export carries `style="color:…"`, and loses it here, deliberately). The
 * corpus in `scripts/check-markdown.ts` asserts that no case renders a `style` attribute at all.
 *
 * `parseHTML` matches `span[class]` and refuses everything whose class is not one of ours, so a
 * pasted `<span class="ql-cursor">` is dropped exactly as it was before — `getAttrs` returning
 * `false` rejects the rule, and nothing else claims a `span`. Note this is the paste gate as much
 * as the parser (`MdImage` below documents why), and a colour class is all it can ever admit.
 *
 * The attribute round-trips *any* id the class shape accepts, not only the eight the picker
 * offers: a note written today has to survive the palette being re-cut, and an id with no rule
 * behind it renders in the default colour rather than disappearing from the text.
 */
const MdTextColor = Mark.create({
  name: 'textColor',

  addAttributes() {
    return {
      color: {
        default: null,
        // Structural, not `HTMLElement`: this module is typechecked without the DOM library
        // through `check-markdown.ts` — the same reason `MdImage`'s `getAttrs` is (see below).
        parseHTML: (el: { getAttribute(name: string): string | null }) =>
          textColorFromClass(el.getAttribute('class')),
        renderHTML: (attrs: { color?: string | null }) =>
          typeof attrs.color === 'string' ? { class: textColorClass(attrs.color) } : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[class]',
        getAttrs: (el: { getAttribute(name: string): string | null }) =>
          textColorFromClass(el.getAttribute('class')) !== null && null,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },

  // The serializer hands a mark a synthetic node carrying its `attrs`, so the colour reaches the
  // stored text from here — `renderChildren` is what the manager replaces with the marked run.
  renderMarkdown(node, helpers) {
    const color = typeof node.attrs?.color === 'string' ? node.attrs.color : null;
    const children = helpers.renderChildren(node);
    return color ? `<span class="${textColorClass(color)}">${children}</span>` : children;
  },
});

/**
 * A `|` inside a table cell is written back escaped (WP-30).
 *
 * The extension serializes cell text verbatim, so a cell containing `x | y` used to come out as
 * `| x | y | 2 |` and be read back as three columns — silent data loss, and the reason the fix
 * sits on the *write* side only: the read side is already correct. The extension's tokenizer
 * hands table rows to marked's `splitCells`, which splits on unescaped pipes and unescapes `\|`
 * afterwards, so `\|` survives a parse untouched.
 *
 * Every pipe is escaped, backticks around it or not. WP-30 hit this through a code span, which
 * WP-49 has since removed from the dialect — but the rule never depended on it: GFM splits the
 * row and unescapes `\|` *before* inline parsing, so a cell's pipe has to be escaped whatever the
 * text around it looks like. Writing it unescaped round-tripped through the editor but made
 * `remark-gfm` (`Markdown.tsx`, i.e. what the reader actually sees) split the row, so editor and
 * display disagreed about one string.
 *
 * `renderChildren` is the only channel through which cell content reaches the serializer, so
 * wrapping it escapes before whitespace collapsing and before the column widths are measured —
 * the padding stays aligned and the extension's ~120-line renderer is not forked into the app.
 */
const MdTable = Table.extend({
  renderMarkdown(node, helpers) {
    return renderTableToMarkdown(node, {
      ...helpers,
      renderChildren: (nodes, separator) =>
        helpers.renderChildren(nodes, separator).replace(/(?<!\\)\|/g, '\\|'),
    });
  },
});

/**
 * Auftakt-Text kennt keinen Code (WP-49) — the parser half of it.
 *
 * A paragraph typed with four leading spaces (`.rte-content` is `pre-wrap`, so they are typeable,
 * and the serializer escapes nothing at a line start) was read back as an indented code block:
 * grey, and with the app's own `<u>` printed literally, because code does not parse HTML. Nothing
 * in the app authors code — the toolbar has no button for it — so the construct is gone rather
 * than papered over.
 *
 * Switching off the extensions alone would **delete** that text: `code` and `codespan` tokens
 * with no handler fall through `parseFallbackToken`, which returns `null` for a token that has no
 * children. The tokenizer has to stop producing them, which is why this module owns a marked
 * instance instead of passing `markedOptions` — that route configures the *global* marked
 * singleton, and there is no disable switch on it. Returning `undefined` from a tokenizer means
 * „no match here", so the block loop falls through to `paragraph` and the inline loop to
 * `inlineText`; returning `false` would hand back to marked's own implementation.
 *
 * `fences` stays on deliberately — see `LegacyFence`.
 */
const markdownParser = new Marked({ gfm: true, breaks: true });
markdownParser.use({
  tokenizer: {
    code: () => undefined, // indented — the reported bug
    codespan: () => undefined, // `inline`
  },
});

/**
 * Inside `<u>` and `<span class="tc-…">`, the text is **Markdown** — because that is what the
 * reader reads there (WP-62).
 *
 * The dialect spells two marks as raw HTML, and `MarkdownManager` reads raw inline HTML by handing
 * it to `generateJSON`, i.e. as *HTML*: everything between the tags becomes literal text. remark
 * does the opposite — an inline raw tag is a tag, and what stands between two of them is parsed as
 * Markdown — so the two halves disagreed about every stored `<u>…**fett**…</u>`.
 *
 * That was survivable while such a note could only come from an import. WP-62 ships the gesture
 * that produces one constantly: colouring a *whole* paragraph. The serializer opens a mark that
 * outlives the marks inside it first (`getMarksToOpenForSerialization` — a mark that continues into
 * the next text node cannot be inner), so „select all, then Rot" is stored as
 * `<span class="tc-rot">aaa **bbb** ccc</span>`. That string is *correct*: the reader draws it
 * exactly as the editor did. Opening the note again is where it broke — the editor read `**bbb**`
 * as four literal asterisks, and the next save escaped them to `\*\*bbb\*\*`, at which point the
 * bold was gone from the reader too. Links died the same way, and ordinary punctuation
 * (`Preis_pro_Person`, `[ca. 5000]`) grew a backslash on every save.
 *
 * So the read side is brought into line with the reader, rather than the serializer being taught to
 * split runs: the tokenizer carves the two tags out itself and lexes what is between them as
 * inline Markdown. `MdRawMark` below then applies the mark to the parsed content. One tokenizer for
 * both tags, because it is one rule — and it repairs `<u>` while it is there, which has had the
 * identical flaw since WP-Q.
 *
 * What it deliberately does *not* claim: a `<span>` whose class is not a colour of ours (an import
 * keeps whatever marked did with it), a `<u>` carrying attributes, and either tag nested in itself.
 * The closing tag is the first **unescaped** one, so a `\</span>` the serializer wrote for a
 * literal one in the text does not cut the run short — the same tag CommonMark leaves as text.
 */
const RAW_MARK_TOKEN = 'auftaktRawMark';
const RAW_MARK_OPEN = /^<(u|span)((?:\s[^<>]*)?)>/i;
const RAW_MARK_START = /<(?:u|span)[\s>]/i;
const CLASS_ATTR = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

/** The first closing tag that is not escaped, or `null`. */
function rawMarkClose(src: string, tag: string): { index: number; length: number } | null {
  const re = new RegExp(`</${tag}\\s*>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index === 0 || src[m.index - 1] !== '\\') return { index: m.index, length: m[0].length };
  }
  return null;
}

markdownParser.use({
  extensions: [
    {
      name: RAW_MARK_TOKEN,
      level: 'inline',
      // Marked cuts the preceding text token here and tries the tokenizers again; declining below
      // simply hands the tag back to marked's own `tag` rule.
      start: (src: string) => {
        const at = src.search(RAW_MARK_START);
        return at < 0 ? undefined : at;
      },
      tokenizer(this: { lexer: { inlineTokens(src: string): unknown[] } }, src: string) {
        const open = RAW_MARK_OPEN.exec(src);
        if (!open) return undefined;
        const tag = open[1]!.toLowerCase();
        const attrs = open[2] ?? '';
        const cls = CLASS_ATTR.exec(attrs);
        const color = textColorFromClass(cls?.[1] ?? cls?.[2] ?? null);
        // A `<span>` is ours only when it carries one of our colours; a `<u>` only when it is bare.
        if (tag === 'span' ? color === null : attrs.trim() !== '') return undefined;
        const rest = src.slice(open[0].length);
        const close = rawMarkClose(rest, tag);
        if (!close) return undefined;
        const inner = rest.slice(0, close.index);
        if (new RegExp(`<${tag}[\\s>]`, 'i').test(inner)) return undefined;
        return {
          type: RAW_MARK_TOKEN,
          raw: src.slice(0, open[0].length + close.index + close.length),
          tag,
          color,
          // Populated here rather than in the handler so that a token with no handler still
          // degrades to its content: `parseFallbackToken` walks `tokens` for anything unknown.
          tokens: this.lexer.inlineTokens(inner),
        };
      },
    },
  ],
  // The extension's token shape is ours, not one of marked's own — `tag`/`color` ride along on it.
} as unknown as Parameters<typeof markdownParser.use>[0]);

/** A run of blank lines at the end of a token's `raw` — the vendor's own shape, matched here. */
const TRAILING_BLANK_LINES = /\n[^\S\n]*(?:\n[^\S\n]*)+$/;

/**
 * The read half of WP-57: a blank line is a block separator and nothing more.
 *
 * `MarkdownManager` invents `separatorCount - 1` empty paragraphs out of every run of blank lines
 * it finds between two blocks — the mirror image of the marker the serializer used to swallow, and
 * lossy in the same way. It means the editor drew a gap in `a\n\n\n\nb` that the reader does not
 * (CommonMark collapses blank lines; only `&nbsp;` makes an empty paragraph), and with the
 * serializer now writing a marker for every empty paragraph, that invented gap would be *stored*
 * on the first save. Every note the old serializer wrote a `\n\n\n\n` run into — which is what it
 * wrote for two typed blank lines — would silently gain a blank line on being opened.
 *
 * So the marker becomes the only spelling in both directions: one `&nbsp;` paragraph ⇔ one empty
 * paragraph, and a run of blank lines means exactly what it means to the reader. There is no
 * option for that on the extension and the method is private, so the cut is made one level down,
 * where the token stream is still ours: the manager builds its lexer as
 * `new markedInstance.Lexer(markedInstance.defaults)`, so replacing `Lexer` on the instance this
 * module already owns replaces the lexer the manager uses. `raw` is all the manager reads a run of
 * blank lines out of — `countParagraphSeparators` on a `space` token, and `extractAbsorbedBlankLines`
 * on the trailing newlines a list token swallows — so collapsing a run to a single separator there
 * is the whole change. Only the top-level `lex()` is touched; `blockTokens`/`inlineTokens`, which
 * custom tokenizers reach through, keep marked's own behaviour.
 */
class DialectLexer extends Lexer<string, string> {
  lex(src: string): TokensList {
    const tokens = super.lex(src);
    for (const token of tokens) {
      token.raw =
        token.type === 'space' ? '\n' : (token.raw ?? '').replace(TRAILING_BLANK_LINES, '\n');
    }
    return tokens;
  }
}
// The field is typed as the *generic* `typeof _Lexer`, which quantifies over marked's parser and
// renderer output types, so no concrete subclass — which has to fix them — is assignable to it.
// What the manager does with the class is `new Lexer(defaults)` plus `lex`, `blockTokens` and
// `inlineTokens`, and those this subclass inherits unchanged.
markdownParser.Lexer = DialectLexer as unknown as typeof markdownParser.Lexer;

/**
 * A stored ``` fence becomes a paragraph: the markers go, the text stays.
 *
 * The bug above did not only render wrong, it *wrote*: an indented paragraph came back out of the
 * editor as a fence, so the database holds fences the app manufactured from ordinary prose. Those
 * must not turn into three visible backticks, and must not vanish either — hence the one code
 * tokenizer left alive, plus this handler standing in for the `codeBlock` node that used to own
 * the token. Both directions of the round-trip agree with `remarkFenceToParagraph` on the render
 * side; the corpus in `scripts/check-markdown.ts` is what holds them together.
 *
 * Lines go onto `hardBreak` nodes rather than into one text node with `\n` in it: a raw newline
 * serializes as a soft break and reads back as a hard one, so the first round-trip would differ
 * from the second and the gate's idempotence assertion would fail. `fenceParagraphs` owns the
 * rest of the shape — blank lines and indentation — because the reader has to reach the same one.
 */
const LegacyFence = Extension.create({
  name: 'legacyFence',
  markdownTokenName: 'code',
  parseMarkdown: (token, helpers) =>
    fenceParagraphs(token.text ?? '').map((lines) => {
      const content: JSONContent[] = [];
      lines.forEach((line, i) => {
        if (i) content.push(helpers.createNode('hardBreak', {}, []));
        if (line) content.push(helpers.createTextNode(line));
      });
      return helpers.createNode('paragraph', {}, content);
    }),
});

/**
 * The handler half of the tokenizer above: mark the parsed content (WP-62).
 *
 * `helpers.applyMark` is what `MdLinkedImage` uses for the same shape — a mark around content the
 * handler parsed itself. Everything inside has already been through the inline lexer, so a bold run
 * or a link inside a coloured span arrives as its own mark and the colour is simply added on top,
 * which is exactly the tree the reader builds for the same string.
 */
const MdRawMark = Extension.create({
  name: 'rawMark',
  markdownTokenName: RAW_MARK_TOKEN,
  parseMarkdown: (token, helpers) => {
    const { tag, color } = token as unknown as { tag?: string; color?: string | null };
    const content = helpers.parseInline(token.tokens ?? []);
    return tag === 'span'
      ? helpers.applyMark('textColor', content, { color })
      : helpers.applyMark('underline', content);
  },
});

/**
 * Bilder im Text (WP-37) — and, before it is a feature, a repair.
 *
 * Without an `image` node the token has no handler, so it falls through `MarkdownManager`'s
 * `default:` branch — which returns `parseTokens(token.tokens)` when the token has children. A
 * marked `Image` token *does* carry children: the alt text. So `![Saalplan](/api/images/…)` came
 * back out of the editor as the bare word „Saalplan", URL gone, no warning, while the renderer
 * displayed the same note's image perfectly. Same shape as the `code` loss WP-49 fixed, one
 * degradation quieter: there, text turned grey; here, a picture became a word.
 *
 * Registering the node is what closes that, and it closes it for *every* destination — our own
 * `/api/images/…`, an `https://` image from an imported note, even a `data:` URL the sanitizer
 * still declines to render. Round-tripping a source the reader will not draw is deliberate: the
 * editor's job is to give back what it was given.
 *
 * **`inline: true` is load-bearing.** `mdast-util-to-hast` puts an image inside the paragraph
 * (`<p><img></p>`), so an inline node is what makes render-equality hold for both a lone image and
 * `Davor ![x](u) danach.` — a block node splits the paragraph and the round-trip gate fails on
 * every case at once.
 *
 * `resolveSrc` is how the season pin reaches the `<img>` without entering the dialect: this module
 * is loaded by the headless gate, which has no window and no season, so it defaults to identity and
 * `RichTextEditor.tsx` passes the real one — the same arrangement, and the same reason, as
 * `linkClass`. The matching `parseHTML` strips the pin again, so a pin can never be read back into
 * the document and stored.
 */
const MdImage = Node.create<{ resolveSrc: (src: string) => string }>({
  name: 'image',
  inline: true,
  group: 'inline',
  atom: true,
  draggable: true,
  markdownTokenName: 'image',

  addOptions() {
    return { resolveSrc: (src: string) => src };
  },

  addAttributes() {
    return {
      src: {
        default: '',
        // The read side of the pin. A paste of editor-rendered HTML carries `?season=3`; storing
        // that would make the note wrong in every other season.
        parseHTML: (el) => canonicalImageSrc(el.getAttribute('src') ?? ''),
      },
      alt: { default: '' },
      title: { default: null },
      width: {
        default: null,
        // An explicit `width` attribute first — the editor's own rendered HTML, the reader's DOM
        // and an imported raw tag all carry one — then a `?w=` a hand-written raw src may hold.
        // `canonicalImageSrc` above strips that query from `src`, so without this second look the
        // width would be silently gone. Anything unparseable is null, i.e. natural size.
        parseHTML: (el: { getAttribute(name: string): string | null }) => {
          const attr = Number(el.getAttribute('width'));
          if (isImageWidth(attr)) return attr;
          return splitImageSrc(el.getAttribute('src') ?? '').width;
        },
        renderHTML: (attrs: { width?: number | null }) =>
          isImageWidth(attrs.width) ? { width: attrs.width } : {},
      },
      align: {
        default: null,
        // Same two-step read as `width`: the explicit legacy attribute (an imported raw tag, the
        // editor's own rendered HTML) wins, then a `?a=` in a hand-written raw src. Anything but
        // left/right/center — imports also carry `top`/`middle`, which meant vertical alignment —
        // is null, i.e. ordinary text flow.
        parseHTML: (el: { getAttribute(name: string): string | null }) => {
          const attr = el.getAttribute('align');
          if (isImageAlign(attr)) return attr;
          return splitImageSrc(el.getAttribute('src') ?? '').align;
        },
        renderHTML: (attrs: { align?: string | null }) =>
          isImageAlign(attrs.align) ? { align: attrs.align } : {},
      },
    };
  },

  /**
   * **This is the paste gate, not only the parser.** ProseMirror runs the same rules over
   * clipboard HTML, so an unqualified `img[src]` admits any `<img>` the user copied out of a web
   * page, a Word document or an Outlook mail — with its `src` verbatim, straight past the resize →
   * JPEG → 1.5 MB upload path that `DECISIONS.md` names as the only way an image enters the app
   * („Paste and drag-and-drop are deliberately not wired"). A `data:` flavour then writes hundreds
   * of kilobytes of base64 into a text column that `SELECT *` carries on every list request; an
   * `https://` one stores a reference that no season copy and no backup can carry; a `file:///` one
   * shows while the editor is open and is gone the moment it is saved (IMG-01).
   *
   * So the rule matches our own stored references and nothing else. `false` rejects it, and with no
   * other node claiming `img` the tag is dropped exactly as it was before WP-37. Reading the
   * editor's *own* rendered HTML still works — that is the copy-paste-inside-the-note case, and the
   * pin is stripped by `canonicalImageSrc` before the check, so a pinned `<img>` matches too.
   *
   * The Markdown side (`parseMarkdown`) stays wide open on purpose: a stored `https://` or `data:`
   * image still round-trips verbatim, because giving back what you were given is the repair this
   * node exists for. Only the *clipboard* is narrowed.
   */
  parseHTML() {
    return [
      {
        tag: 'img[src]',
        // Structural, not `HTMLElement`: `tsconfig.scripts.json` typechecks this module through
        // `check-markdown.ts` with `lib: ["ES2023"]` and no DOM, so naming a DOM global here fails
        // the root typecheck while the client's own passes. Contravariance makes the wider
        // parameter type assignable to what ProseMirror asks for.
        getAttrs: (el: { getAttribute(name: string): string | null }) =>
          isImageRef(canonicalImageSrc(el.getAttribute('src') ?? '')) && null,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const src = typeof HTMLAttributes.src === 'string' ? HTMLAttributes.src : '';
    return ['img', mergeAttributes(HTMLAttributes, { src: this.options.resolveSrc(src) })];
  },

  /**
   * Clicking an image selects it — by its DOM element, not by click coordinates.
   *
   * ProseMirror's own click handling maps the pointer through the browser's caret-from-point,
   * and next to a float Chromium resolves a point that is visibly *on* one image to the start of
   * the line beside it: with a floated `a=right` plan in the note, clicking the next image left
   * the old NodeSelection standing and the size bar editing the wrong picture. `posAtDOM` on the
   * `<img>` the event actually hit is immune to that geometry. Returning false for everything
   * else keeps ProseMirror's handling — including drag — exactly as it was.
   */
  addProseMirrorPlugins() {
    const { editor } = this;
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            // Structural, not `MouseEvent`/`HTMLElement`: this module typechecks DOM-free
            // through `check-markdown.ts` — same reason as `getAttrs` above.
            mousedown: (view, event: { target?: unknown }) => {
              const el = event.target as {
                nodeName?: string;
                classList?: { contains(name: string): boolean };
              } | null;
              if (!el || el.nodeName !== 'IMG' || el.classList?.contains('ProseMirror-separator')) {
                return false;
              }
              const posAtDOM = (
                view as unknown as { posAtDOM(node: unknown, offset: number): number }
              ).posAtDOM.bind(view);
              let pos: number;
              try {
                pos = posAtDOM(el, 0);
              } catch {
                return false;
              }
              if (pos < 0 || view.state.doc.nodeAt(pos)?.type.name !== editor.schema.nodes.image?.name) {
                return false;
              }
              view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
              return true;
            },
          },
        },
      }),
    ];
  },

  // The presentation legs of the spelling (`?w=384&a=right`) are lifted off here and written
  // back below — `splitImageSrc`/`composeImageSrc` are exact inverses, and the reader's
  // `rehypeImgQuery` does the identical lift, so both halves draw the same attributes from the
  // same string.
  parseMarkdown: (token, helpers) => {
    const { src, width, align } = splitImageSrc(token.href ?? '');
    return helpers.createNode(
      'image',
      { src, alt: token.text ?? '', title: token.title ?? null, width, align },
      [],
    );
  },

  renderMarkdown: (node) =>
    wrapImageMarks(
      imageMarkdown(
        composeImageSrc(
          node.attrs?.src ?? '',
          node.attrs?.width,
          node.attrs?.align as ImageAlign | null,
        ),
        node.attrs?.alt ?? '',
        node.attrs?.title,
      ),
      node.marks,
    ),
});

const EMPTY_PARAGRAPH_MARKDOWN = '&nbsp;';

const isEmptyParagraph = (node: JSONContent) =>
  node.type === 'paragraph' && !(Array.isArray(node.content) ? node.content : []).length;

/**
 * A paragraph holding nothing but an image stays a paragraph (WP-37).
 *
 * `@tiptap/extension-paragraph`'s own `parseMarkdown` carries a special case:
 *
 *     // if paragraph contains only a single image token,
 *     // unwrap it to avoid nesting block elements incorrectly
 *     if (tokens.length === 1 && tokens[0].type === 'image') return helpers.parseChildren([tokens[0]])
 *
 * which is right for TipTap's own image extension — that one is a **block** node. Ours is
 * deliberately `inline: true`, because the reader puts an image inside its paragraph and the two
 * halves have to agree. Unwrapped, the image landed as a direct child of `doc`, whose content
 * expression is `block+`: a document ProseMirror never validates on construction and cannot
 * survive being touched. The editor mounted, drew the note correctly, and threw
 * „Called contentMatchAt on a node with invalid content" on the first transaction that reached the
 * end of the document — the trailing-node plugin appending its paragraph, i.e. the placeholder
 * nudge or the first keystroke. In the app that reads as: click into a note whose last block is an
 * image, and the field does not open at all.
 *
 * That is why „Bild einfügen" appeared to do nothing. Inserting works — an inline node goes inside
 * the current paragraph — but the note it wrote could not be opened again afterwards.
 *
 * Only the lone-image case is intercepted; `null` sends every other paragraph on to the
 * extension's own handler, which keeps its `&nbsp;` empty-paragraph rule (`nbspIndent`, WP-49)
 * exactly as it was.
 *
 * ---
 *
 * **Every empty paragraph is written as `&nbsp;` (WP-57)** — the extension writes the marker only
 * from the *second* consecutive empty paragraph on (`previousNodeIsEmptyParagraph`), and returns
 * `""` for the first. Since blocks are joined with a blank line, an unmarked empty paragraph is
 * indistinguishable from the paragraph break that was already there, so it simply evaporated:
 *
 *     im Editor                 gespeichert (alt)             was der Reader zeichnete
 *     Liste + 1 Leerzeile       `- a\n- b\n\n`                Liste, keine Leerzeile
 *     Liste + 2 Leerzeilen      `- a\n- b\n\n\n\n&nbsp;`      Liste + eine Leerzeile
 *     Liste, Leerzeile, Liste   `- a\n- b\n\n\n\n- c\n- d`    *eine* Liste aus vier Punkten
 *
 * The last row is the worst of the three and the reason this is a serializer fix rather than a
 * CSS one: a run of blank lines does not interrupt a list in either parser, so the two lists were
 * merged in storage — the user's structure was gone, not merely drawn wrong. A marker paragraph
 * sits at column 0 and *does* end a list, in marked and in micromark alike, so writing it for
 * every empty paragraph repairs the spacing and the structure in one move.
 *
 * The marker is what the reader has always drawn as `<p> </p>` and what the extension's own
 * `parseMarkdown` reads back as an empty paragraph, so this only makes the write side spell what
 * both halves already understood. `MarkdownManager.serialize` strips a document that is *nothing
 * but* markers back to `""`, so an empty note still stores an empty string.
 */
const MdParagraph = Paragraph.extend({
  parseMarkdown: (token, helpers) => {
    const tokens = token.tokens ?? [];
    if (tokens.length === 1 && tokens[0]?.type === 'image') {
      return helpers.createNode('paragraph', undefined, helpers.parseInline(tokens));
    }
    // Everything else stays the extension's own, reached through its config rather than
    // `this.parent`: the markdown fields are declaration-merged onto the config type, so the
    // parent chain is not typed for them. The original reads nothing off `this`, and it owns the
    // `&nbsp;` empty-paragraph rule the legacy fences depend on (WP-49), which is exactly why it
    // has to keep running.
    return Paragraph.config.parseMarkdown!(token, helpers);
  },
  renderMarkdown: (node, helpers, ctx) => {
    // Top level only. Inside a table cell an empty paragraph is an *empty cell*, and writing the
    // marker there put a visible `&nbsp;` in it — and then escaped it to `&amp;nbsp;` on the next
    // save, since a cell's text is serialized verbatim. Same for a list item or a blockquote:
    // „eine Leerzeile" is a statement about the blocks of the note, nothing else.
    if (node && ctx.parentType === 'doc' && isEmptyParagraph(node)) return EMPTY_PARAGRAPH_MARKDOWN;
    // A paragraph with content is the extension's own `renderChildren`, reached the same way as
    // the parser above — `ctx` carries the neighbouring nodes the indentation logic reads.
    return Paragraph.config.renderMarkdown!(node, helpers, ctx);
  },
});

/**
 * The empty paragraph at the *end* of the document is the editor's, not the note's (WP-57).
 *
 * `TrailingNode` (StarterKit) appends one whenever the last block is not a paragraph, so that a
 * note ending in a list or a table still has somewhere to click and type. It is an affordance of
 * the editing surface, and it is there whether or not anyone typed it — so once `MdParagraph`
 * above started writing `&nbsp;` for every empty paragraph, *every* note ending in a list, a
 * heading or a table grew a trailing blank line the first time it was opened and saved. That is
 * the „die Notiz formt sich beim Speichern um" failure this area keeps running into, and at the
 * end of a note the blank line it adds is invisible anyway: there is nothing under it to push
 * down, only the card that gets taller.
 *
 * So the whole trailing run is dropped, not just the last one — trimming one per save would let a
 * note with two of them shrink on every open, which is the same instability spread over time.
 * Everything else is the extension's own handler: children joined by a blank line.
 *
 * A document made of nothing but empty paragraphs trims to `""`, which is what
 * `MarkdownManager.serialize` already produced for an empty note (`isEmptyOutput` strips the
 * markers), so „leer" still stores the empty string.
 */
const MdDocument = Document.extend({
  renderMarkdown: (node, helpers) => {
    const content = Array.isArray(node.content) ? node.content : [];
    let end = content.length;
    while (end > 0 && isEmptyParagraph(content[end - 1]!)) end--;
    return helpers.renderChildren(content.slice(0, end), '\n\n');
  },
});

/**
 * The read half of „a link around an image survives": `[![Saalplan](/api/images/…)](https://…)`.
 *
 * `applyMarkToContent` in the Markdown manager sets marks on **text** nodes and otherwise recurses
 * into `content`. An image is an atom with no content, so a link wrapping one had its mark applied
 * to nothing at all: the node came back unmarked, and the serializer — which can only write what
 * the node carries — then wrote a bare `![…](…)`. Opening an imported note and saving it dropped
 * the destination silently (IMG-04, the parser half).
 *
 * Standing in for the built-in `link` handler is the only place the two tokens are visible at once.
 * `priority` puts this ahead of the Link mark (1000): the registry keeps handlers in registration
 * order and TipTap registers by descending priority, so the first one registered for `link` wins.
 * Text keeps going through `applyMark` exactly as before — the only addition is marking atoms the
 * helper cannot reach.
 */
const MdLinkedImage = Extension.create({
  name: 'linkedImage',
  priority: 1001,
  markdownTokenName: 'link',
  parseMarkdown: (token, helpers) => {
    const attrs = { href: token.href ?? '', title: token.title ?? null };
    const content = helpers.parseInline(token.tokens ?? []).map((node) =>
      node.type === 'image'
        ? { ...node, marks: [...(node.marks ?? []), { type: 'link', attrs }] }
        : node,
    );
    return helpers.applyMark('link', content, attrs);
  },
});

/**
 * Marks around an image, written by hand — the serializer only puts them around *text*.
 *
 * `renderNodesWithMarkBoundaries` opens and closes marks while walking text nodes; a non-text node
 * gets the surrounding marks closed before it and reopened after, and marks that *start* on the
 * node itself are never opened at all. For an image that is the only child of its paragraph the
 * active set is empty, so `[![Saalplan](…)](https://example.com)` — from an import, or from pasting
 * a linked image — serialized to a bare `![Saalplan](…)` and the destination was gone from the
 * stored text with no warning (IMG-04). Same for `**…**` and `*…*`.
 *
 * The link goes outermost, matching the shape both parsers read back. When the image sits *between*
 * two text nodes carrying the same mark, the serializer's own close/reopen still runs — the result
 * is then three adjacent links rather than one, which renders identically and stores the
 * destination the old output simply dropped.
 *
 * `underline` and `textColor` are absent deliberately. Nothing in the app can author either on an
 * atom — the toolbar cannot underline a picture, and a colour paints nothing on one — and neither
 * could survive being written even now that `MdRawMark` reads Markdown inside those tags:
 * `applyMarkToContent` puts marks on *text* nodes, so a raw tag wrapped around an image would come
 * back marking nothing at all. That is the same gap `MdLinkedImage` exists to close for links, and
 * this is the direction of it the serializer must not walk into.
 */
function wrapImageMarks(md: string, marks: JSONContent['marks']): string {
  if (!marks?.length) return md;
  let out = md;
  for (const name of ['strike', 'italic', 'bold'] as const) {
    if (marks.some((m) => m.type === name)) {
      const fence = name === 'strike' ? '~~' : name === 'bold' ? '**' : '*';
      out = `${fence}${out}${fence}`;
    }
  }
  const link = marks.find((m) => m.type === 'link');
  if (link) {
    const href = typeof link.attrs?.href === 'string' ? link.attrs.href : '';
    const title = typeof link.attrs?.title === 'string' ? link.attrs.title : '';
    out = `[${out}](${encodeSrc(href)}${title ? ` "${escapeTitle(title)}"` : ''})`;
  }
  return out;
}

/**
 * The extension set that governs Markdown ⇄ editor round-trips.
 *
 * Shared by the editor component (`RichTextEditor.tsx`) and the round-trip check
 * (`scripts/check-markdown.ts`) so both serialize identically; intentionally free of
 * React/DOM-only UI extensions (those are added in the component).
 *
 * The dialect is pinned to `Markdown.tsx`'s renderer:
 * - `gfm + breaks` mirror `remark-gfm` + `remark-breaks` (single `\n` → `<br>`, GFM tables,
 *   bare-URL autolink).
 * - **3-space** list indentation, because 2 spaces does *not* nest under an ordered parent in
 *   that renderer (documented in WP-J), whereas 3 nests under both bullet and ordered parents.
 * - **No code at all** (WP-49) — `markdownParser` above, and `Markdown.tsx`'s micromark twin.
 *   `horizontalRule` stays enabled (StarterKit default) so any such content in existing notes
 *   round-trips even though the toolbar doesn't author it.
 * - **Two constructs are spelled as raw HTML**, because Markdown has no syntax for either:
 *   underlining (`<u>`, since WP-Q) and the font colour (`<span class="tc-…">`, WP-62). Both are
 *   whitelisted on the reading side, and the colour class is the only *attribute* the sanitize
 *   schema admits beyond GitHub's defaults.
 *
 * Dropping the code mark also empties the serializer's `codeTypes`, so *every* text node is now
 * backtick-escaped on the way out. That is what keeps the two parsers in step: a backtick the
 * user typed is stored as `` \` `` and can never come back as a code span on either side.
 *
 * `linkClass` is the one thing the app injects, so links look the same while you edit them as
 * they do once rendered (WP-29). It stays a parameter rather than an import: this module is
 * loaded by the headless round-trip check, which has no stylesheet and passes nothing. Anything
 * added here must be provably absent from the mark's `renderMarkdown` — the link mark serializes
 * `href` and `title` only, which is why a class cannot reach the stored Markdown.
 */
export function markdownExtensions(
  opts: { linkClass?: string; resolveSrc?: (src: string) => string } = {},
): AnyExtension[] {
  return [
    StarterKit.configure({
      underline: false, // replaced by MdUnderline so it serializes to <u>
      document: false, // replaced by MdDocument so the trailing empty paragraph isn't stored
      paragraph: false, // replaced by MdParagraph so a lone image keeps its paragraph
      code: false, // WP-49 — see markdownParser; the tokenizers go with them
      codeBlock: false,
      link: {
        openOnClick: false,
        autolink: true,
        // Replaces the extension's default object wholesale, so `target`/`rel` have to be
        // restated here or editor-copied HTML loses them.
        HTMLAttributes: {
          target: '_blank',
          rel: 'noopener noreferrer nofollow',
          class: opts.linkClass ?? null,
        },
      },
    }),
    MdUnderline,
    // After the marks above, so that the serializer — which opens marks by registration rank —
    // puts the colour span *inside* `**` and `<u>` whenever it can. It cannot when the colour
    // outlives them (a whole paragraph coloured at once), which is what `MdRawMark` below is for.
    MdTextColor,
    // The read half of both raw-HTML marks — see the tokenizer above.
    MdRawMark,
    LegacyFence,
    MdDocument,
    MdParagraph,
    MdLinkedImage,
    MdImage.configure({ resolveSrc: opts.resolveSrc ?? ((src: string) => src) }),
    MdTable.configure({ resizable: false }),
    TableRow,
    TableCell,
    TableHeader,
    Markdown.configure({
      indentation: { style: 'space', size: 3 },
      // `gfm` and `breaks` moved into the instance itself — passing `markedOptions` alongside it
      // would write them onto the same object a second time. The option is typed as the marked
      // *module*, which carries statics an instance has no reason to have (`getDefaults`); what
      // the manager reads off it is `Lexer`, `defaults` and `setOptions`, and those an instance
      // has — passing the module is how it reaches the global singleton in the first place.
      marked: markdownParser as unknown as MarkdownExtensionOptions['marked'],
    }),
  ];
}
