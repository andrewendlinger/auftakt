/**
 * Paragraph indentation for the rich-text editor (WP-49).
 *
 * Tab used to hand itself to the browser, which moved focus out of the note — the reported „focus
 * jump". What it does instead is indent, and the character matters: a Markdown paragraph **cannot
 * carry leading spaces**. Both parsers strip them (that four of them used to mean „code" is the
 * bug this package removed), so an indent typed as spaces would show in the editor and be gone in
 * the reading view. U+00A0 is not whitespace to either parser, so it survives the round-trip and
 * both surfaces show the same thing.
 *
 * Three, to match the list indentation the serializer writes (`richtext.ts`). Written as an
 * escape everywhere it appears: a literal U+00A0 in source is indistinguishable from a space.
 */
export const INDENT_UNIT = '\u00a0'.repeat(3);

/** One unit's worth of leading indentation, either character (WP-49). */
const LEADING_INDENT = /^[\u00a0 ]{1,3}/;

/**
 * How many characters Shift-Tab takes off the front of a block — at most one unit, and never past
 * the text.
 *
 * Plain spaces count too: notes written before WP-49 carry the indentation that caused the bug,
 * and outdent is the only way to get rid of it by keyboard.
 */
export function outdentWidth(text: string): number {
  return LEADING_INDENT.exec(text)?.[0].length ?? 0;
}
