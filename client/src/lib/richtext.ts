import StarterKit from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { Markdown } from '@tiptap/markdown';
import { Table, renderTableToMarkdown } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import type { AnyExtension } from '@tiptap/core';

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
 * Escaping inside code spans is deliberate, not an oversight. GFM splits the row and unescapes
 * `\|` *before* inline parsing, so ``` `x \| y` ``` is the correct spelling of a code span
 * holding a pipe — and it is what the extension's own tokenizer produces on the way in. Writing
 * it unescaped round-tripped through the editor but made `remark-gfm` (`Markdown.tsx`, i.e. what
 * the reader actually sees) split the row, so editor and display disagreed about one string.
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
 * - `codeBlock` / `horizontalRule` stay enabled (StarterKit defaults) so any such content in
 *   existing notes round-trips even though the toolbar doesn't author them.
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
    MdTable.configure({ resizable: false }),
    TableRow,
    TableCell,
    TableHeader,
    Markdown.configure({
      indentation: { style: 'space', size: 3 },
      markedOptions: { gfm: true, breaks: true },
    }),
  ];
}
