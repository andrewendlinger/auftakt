import StarterKit from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { Markdown, type MarkdownExtensionOptions } from '@tiptap/markdown';
import { Table, renderTableToMarkdown } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Extension, type AnyExtension, type JSONContent } from '@tiptap/core';
import { Marked } from 'marked';

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
 * The lines are split onto `hardBreak` nodes rather than left as one text node with `\n` in it:
 * a raw newline serializes as a soft break and reads back as a hard one, so the first round-trip
 * would differ from the second and the gate's idempotence assertion would fail.
 */
const LegacyFence = Extension.create({
  name: 'legacyFence',
  markdownTokenName: 'code',
  parseMarkdown: (token, helpers) => {
    const content: JSONContent[] = [];
    (token.text ?? '').replace(/\n+$/, '').split('\n').forEach((line, i) => {
      if (i) content.push(helpers.createNode('hardBreak', {}, []));
      if (line) content.push(helpers.createTextNode(line));
    });
    return helpers.createNode('paragraph', {}, content);
  },
});

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
export function markdownExtensions(opts: { linkClass?: string } = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      underline: false, // replaced by MdUnderline so it serializes to <u>
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
