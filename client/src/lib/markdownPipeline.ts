import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import type { Root } from 'mdast';
import type { PluggableList, Processor } from 'unified';
// Type-only, for its side effect: `micromarkExtensions` is remark-parse's addition to unified's
// `Data`, and without this the processor's data bag does not admit the field this file writes.
import type {} from 'remark-parse';

/**
 * The reader's half of the Markdown dialect, in one place.
 *
 * `Markdown.tsx` renders with it and `scripts/check-markdown.ts` asserts against it. The two used
 * to spell the same chain out separately — the gate then measured a renderer the app no longer
 * shipped, which is the one failure mode a round-trip gate must not have. The remark/rehype
 * *plugins* are shared; how they are driven is not (react-markdown builds its own processor and
 * ends in React, the script ends in `rehype-stringify`).
 *
 * The editor twin lives in `richtext.ts`. Every change here needs the matching change there, and
 * the corpus is what proves they still agree.
 */

/**
 * Raw HTML is parsed (`rehypeRaw`) because the toolbar's underline round-trips as a literal
 * `<u>`, so `<u>` is whitelisted on top of the GitHub defaults — and `code`/`pre` are taken *out*
 * of them (WP-49): the dialect has no code, and a `<code>` typed as raw HTML or carried in by an
 * import would be the one way left to reach the grey box. Unknown tags are unwrapped rather than
 * dropped, so the text inside survives; only `strip`ped tags (`script`) lose their content.
 */
export const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []).filter((t) => t !== 'code' && t !== 'pre'), 'u'],
};

/**
 * Auftakt-Text kennt keinen Code (WP-49) — the reader's half.
 *
 * micromark has no option for this; the switch is a syntax extension carrying nothing but a
 * `disable` list, merged into the others by name. `codeIndented` is the reported bug (four
 * leading spaces are typeable in the editor and cannot survive a Markdown paragraph, so they must
 * not *mean* anything either), `codeText` is `` `inline` ``. Both names are the constructs' own,
 * matched by `create-tokenizer`.
 *
 * `codeFenced` stays enabled — see `remarkFenceToParagraph`.
 */
function remarkNoCodeSyntax(this: Processor) {
  const data = this.data();
  const extensions = data.micromarkExtensions ?? (data.micromarkExtensions = []);
  extensions.push({ disable: { null: ['codeIndented', 'codeText'] } });
}

/** Structural view of the mdast nodes this file rewrites — `children` on anything that has it. */
type MdNode = { type: string; value?: string; children?: MdNode[] };

/** A fence's text as a paragraph: lines interleaved with hard breaks, empty lines dropped. */
function fenceParagraph(value: string): MdNode {
  const children: MdNode[] = [];
  value
    .replace(/\n+$/, '')
    .split('\n')
    .forEach((line, i) => {
      if (i) children.push({ type: 'break' });
      if (line) children.push({ type: 'text', value: line });
    });
  return { type: 'paragraph', children };
}

function stripFences(node: MdNode) {
  if (!node.children) return;
  node.children = node.children.map((child) => {
    if (child.type === 'code') return fenceParagraph(child.value ?? '');
    stripFences(child);
    return child;
  });
}

/**
 * A stored ``` fence renders as prose: the markers go, the text stays.
 *
 * The database holds fences the app wrote itself — an indented paragraph came back out of the
 * editor as one — so their markers must not become three visible backticks. Disabling
 * `codeFenced` outright would do exactly that, hence the construct stays and its output is
 * rewritten here, in step with `LegacyFence` in `richtext.ts`.
 *
 * The text is *not* re-parsed as Markdown: it was code, so a `*` in it stays a `*`. That matches
 * the editor, which reads the same fence into one paragraph of literal text and escapes it on the
 * way back out.
 */
function remarkFenceToParagraph() {
  return (tree: Root) => stripFences(tree as unknown as MdNode);
}

export const remarkPlugins: PluggableList = [
  remarkGfm,
  remarkBreaks,
  remarkNoCodeSyntax,
  remarkFenceToParagraph,
];

/** Order is load-bearing: raw HTML is parsed first, then sanitized. */
export const rehypePlugins: PluggableList = [rehypeRaw, [rehypeSanitize, sanitizeSchema]];
