import StarterKit from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Markdown, type MarkdownExtensionOptions } from '@tiptap/markdown';
import { Table, renderTableToMarkdown } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Extension, Node, mergeAttributes, type AnyExtension, type JSONContent } from '@tiptap/core';
import { Marked } from 'marked';
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
 * `underline` is absent deliberately: it serializes as raw `<u>`, and marked does not parse
 * Markdown inside a raw tag, so the image would come back as literal `![…]` text. Nothing in the
 * app can author that combination — the toolbar cannot underline an atom — and writing it would be
 * the loss this function exists to prevent.
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
    LegacyFence,
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
