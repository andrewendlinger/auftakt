import StarterKit from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { Markdown } from '@tiptap/markdown';
import { Table } from '@tiptap/extension-table';
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
 */
export function markdownExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      underline: false, // replaced by MdUnderline so it serializes to <u>
      link: { openOnClick: false, autolink: true },
    }),
    MdUnderline,
    Table.configure({ resizable: false }),
    TableRow,
    TableCell,
    TableHeader,
    Markdown.configure({
      indentation: { style: 'space', size: 3 },
      markedOptions: { gfm: true, breaks: true },
    }),
  ];
}
