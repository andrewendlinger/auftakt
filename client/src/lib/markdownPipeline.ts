import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import type { Root } from 'mdast';
import type { Root as HastRoot } from 'hast';
import type { PluggableList, Processor } from 'unified';
// Type-only, for its side effect: `micromarkExtensions` is remark-parse's addition to unified's
// `Data`, and without this the processor's data bag does not admit the field this file writes.
import type {} from 'remark-parse';
import { fenceParagraphs } from './legacyCode';

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

/** A block of code text as prose: `fenceParagraphs`' shape in mdast nodes. */
function proseNodes(value: string): MdNode[] {
  return fenceParagraphs(value).map((lines) => {
    const children: MdNode[] = [];
    lines.forEach((line, i) => {
      if (i) children.push({ type: 'break' });
      if (line) children.push({ type: 'text', value: line });
    });
    return { type: 'paragraph', children };
  });
}

function stripFences(node: MdNode) {
  if (!node.children) return;
  // flatMap, not map: a fence holding a blank line becomes two paragraphs, exactly as the
  // editor reads it — see `fenceParagraphs`.
  node.children = node.children.flatMap((child) => {
    if (child.type === 'code') return proseNodes(child.value ?? '');
    stripFences(child);
    return [child];
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

/** Structural view of the hast nodes below — enough to find a `<pre>` and replace it. */
type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const textOf = (node: HastNode): string =>
  node.type === 'text' ? (node.value ?? '') : (node.children ?? []).map(textOf).join('');

/** The same prose shape `proseNodes` builds, in hast. */
function proseElements(value: string): HastNode[] {
  return fenceParagraphs(value).map((lines) => {
    const children: HastNode[] = [];
    lines.forEach((line, i) => {
      if (i) {
        children.push({ type: 'element', tagName: 'br', properties: {}, children: [] });
        // `mdast-util-to-hast` puts a newline after every hard break; matching it keeps this
        // path's HTML identical to the fence path's, which is what the gate compares.
        children.push({ type: 'text', value: '\n' });
      }
      if (line) children.push({ type: 'text', value: line });
    });
    return { type: 'element', tagName: 'p', properties: {}, children };
  });
}

function unwrapPre(node: HastNode) {
  if (!node.children) return;
  node.children = node.children.flatMap((child) => {
    if (child.type === 'element' && child.tagName === 'pre') return proseElements(textOf(child));
    unwrapPre(child);
    return [child];
  });
}

/**
 * A `<pre>` typed as raw HTML reads as prose too (WP-49).
 *
 * No Markdown produces one any more, but a CSV import or a restored backup can carry one, and
 * the sanitizer alone would unwrap it into bare text: its line breaks would collapse and it would
 * sit outside any paragraph, while the *editor* reads the same note as a paragraph with hard
 * breaks. Same segmentation as the fence path, so the two halves agree.
 */
function rehypePreToProse() {
  return (tree: HastRoot) => unwrapPre(tree as unknown as HastNode);
}

/**
 * A raw `<img>` standing on its own line is read as a paragraph (WP-37).
 *
 * Markdown's own `![…](…)` always lands inside a paragraph, so the editor's image node is inline
 * and everything agrees. Raw HTML does not: `rehypeRaw` leaves a root-level `<img>` exactly where
 * it stood, outside any paragraph, while the editor — which has nowhere else to put an inline node
 * — reads it into one. The two halves then rendered different HTML for the same note, which is the
 * one thing the round-trip gate exists to catch.
 *
 * Only an import or a restored backup can carry such a tag; nothing in the app authors one. Same
 * situation and same remedy as `rehypePreToProse` above, which is why it sits here rather than in
 * the sanitize schema: this is about *shape*, not about safety.
 */
function wrapRootImages(tree: HastNode) {
  if (!tree.children) return;
  tree.children = tree.children.map((child) =>
    child.type === 'element' && child.tagName === 'img'
      ? { type: 'element', tagName: 'p', properties: {}, children: [child] }
      : child,
  );
}

function rehypeImgToParagraph() {
  return (tree: HastRoot) => wrapRootImages(tree as unknown as HastNode);
}

/** Order is load-bearing: raw HTML is parsed first, reshaped, and only then sanitized. */
export const rehypePlugins: PluggableList = [
  rehypeRaw,
  rehypePreToProse,
  rehypeImgToParagraph,
  [rehypeSanitize, sanitizeSchema],
];
