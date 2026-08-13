import { NBSP } from './indent';

/**
 * How a block of code text becomes prose, for both halves of the dialect (WP-49).
 *
 * The editor (`LegacyFence`) and the reader (`remarkFenceToParagraph`) build different node
 * shapes out of the same segmentation, so the segmentation itself lives here — the two must agree
 * character for character or the round-trip gate fails, which is exactly what it is for.
 *
 * Two things a naive `split('\n')` gets wrong, both found reviewing this package:
 *
 * - **A blank line is a paragraph break, not two hard breaks.** An indented code block swallows
 *   the blank lines between its lines, so the fences this app wrote from ordinary prose are full
 *   of them. Rendering one as two hard breaks writes `"  \n  \n"` back out — a whitespace-only
 *   line, which reads as a paragraph separator: the note silently re-shaped itself on the first
 *   save and again on the second.
 * - **Leading spaces have to become U+00A0.** They were indentation before the code block ate
 *   them, and indentation is the whole point of these notes — but a Markdown paragraph cannot
 *   carry a leading space (see `indent.ts`). Left alone, the first line's indent also broke
 *   render-equality: it survives the fence but not the paragraph the fence turns into.
 */
export function fenceParagraphs(text: string): string[][] {
  return text
    .replace(/\n+$/, '')
    .split(/\n[^\S\n]*\n\s*/)
    .map((block) => block.split('\n').map(keepIndent));
}

/** Leading spaces and tabs become the one whitespace a paragraph can hold. */
const keepIndent = (line: string) => line.replace(/^[ \t]+/, (ws) => NBSP.repeat(ws.length));
