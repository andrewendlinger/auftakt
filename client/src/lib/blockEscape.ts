/**
 * Ein Zeilenanfang ist kein Befehl (WP-85) — the write half of it.
 *
 * `@tiptap/markdown` escapes text node by node and character by character
 * (`escapeMarkdownSyntax`, whose set is a backslash, a backtick, `*`, `_`, `[`, `]` and `~`), which
 * is a statement about *inline* syntax and knows nothing about where a character sits. Every
 * CommonMark **block** construct is decided by what stands at the start of a line, so a paragraph
 * whose text begins `+ Punkt A` was written back verbatim and read again as a bullet list: the note
 * re-shaped itself on the next open, and the plus the user typed was gone from storage. The same
 * held for `- Punkt A`, `# Titel`, `2026. Jubiläum`, `1) eins`, `---` and — through a hard break,
 * which puts several lines in one paragraph — a `===` under a line of text (a setext heading) and a
 * pipe-and-dashes line under a row of pipes (a GFM table).
 *
 * The unit is therefore the **line**, not the character, and this runs on the *serialized*
 * paragraph — after the vendor's escape and after `encodeHtmlEntities` — which is what lets it
 * decide by looking at the character that is actually going to be stored. A line that already
 * begins with a backslash matches no rule, and that is the whole of the idempotence argument:
 * WP-62 is what happens when an escape can fire on its own output.
 *
 * **At most one backslash per line.** Every construct below is decided by the first non-space
 * character of the line (the ordered list by the punctuation right after its digits), so defusing
 * that one position defuses the whole line — there is never a second thing to escape.
 *
 * What is deliberately *not* here:
 *
 * - `>` — `encodeHtmlEntities` turns it into a character reference before this runs, and a
 *   character reference starts no block. That is semantics the whole dialect rests on — the reader
 *   whitelists `<u>` and `<span class="tc-…">` precisely because everything else is encoded — not
 *   an implementation detail, and `check-markdown.ts` pins it with `quote` and `colorInQuote`.
 * - `<` — an HTML block needs a literal `<` at the line start, and the same encoding has eaten it.
 *   The two raw tags the dialect writes itself are neither in CommonMark's type-6 tag list nor ever
 *   alone on their line, so they open no HTML block; `colorWholeParagraph` has always asserted it.
 * - A backtick, `~` and `_` — a fence, a fence and a thematic break, all three already dead because
 *   the vendor escapes those characters inline. That *is* an implementation detail rather than
 *   semantics, so `check-markdown.ts` guards each with a serialize case instead of a rule being
 *   written here for something that cannot happen.
 * - A bare leading pipe — a header row alone is not a table, only the delimiter row below it makes
 *   one. Escaping just that row keeps the churn down; see the fourth rule.
 *
 * `*` rides along in the bullet class anyway, even though the vendor's inline escape already kills
 * it in text: it is one character in a class that has to exist for `-` and `+` regardless, and it
 * costs nothing to stop depending on a vendor's escape set for correctness.
 */

/**
 * One rule per construct, in the order they are tried; the first that changes the line wins.
 *
 * Each matches the line's indent (`$1`) plus the single character to defuse (`$2`) and pushes
 * everything else into a lookahead, so the replacement is always `'$1\\$2'` — an insertion, never a
 * rewrite.
 *
 * **Any amount of indentation, not CommonMark's three spaces.** WP-49 disabled `codeIndented` on
 * both halves, which removed the four-space ceiling with it: `    - vier` is a list to the reader
 * now and `    ---` a thematic break. A `{0,3}` bound would leave exactly the paragraphs WP-49
 * exists for unprotected. Tabs count for the same reason.
 */
const LINE_RULES: readonly RegExp[] = [
  // Aufzählung: `- `, `+ `, `* ` — auch allein auf der Zeile, das ist ein leerer Listenpunkt.
  /^([ \t]*)([-+*])(?=[ \t]|$)/,
  // Nummerierung: `1.` und `1)`. Höchstens **neun** Ziffern, denn `1234567890.` ist keine Liste —
  // und der Backslash steht vor der Interpunktion, nicht vor der Ziffer: `\1.` ist in CommonMark
  // kein Escape (Ziffern sind keine ASCII-Interpunktion) und bliebe sichtbar im Text stehen.
  /^([ \t]*\d{1,9})([.)])(?=[ \t]|$)/,
  // Überschrift: ein bis sechs `#`, gefolgt von Leerraum oder Zeilenende. Nur das erste `#` wird
  // escaped — danach beginnt die Zeile mit einem Backslash und ist keine Überschrift mehr.
  /^([ \t]*)(#)(?=#{0,5}(?:[ \t]|$))/,
  // Trennlinie (`---`, `- - -`), Setext-Unterstrich der Ebene 2 (`--`) und die Trennzeile einer
  // GFM-Tabelle (`| --- | --- |`, `--- | ---`, `:-:|:-:`) sind **eine** Form: eine Zeile aus nichts
  // als Strich, Doppelpunkt, Pipe und Leerraum, die mindestens einen Strich enthält. Die Kopfzeile
  // der Tabelle braucht keinen eigenen Fall — ohne Trennzeile gibt es keine Tabelle.
  /^([ \t]*)(?=[-:| \t]*-)([-:|])(?=[-:| \t]*$)/,
  // Setext-Überschrift der Ebene 1: eine Zeile aus nichts als `=`.
  /^([ \t]*)(=)(?==*[ \t]*$)/,
];

/** The one backslash a line needs, or the line unchanged. */
function escapeLine(line: string): string {
  for (const rule of LINE_RULES) {
    const escaped = line.replace(rule, '$1\\$2');
    if (escaped !== line) return escaped;
  }
  return line;
}

/**
 * Defuse every line of a serialized block that would otherwise open a construct nobody wrote.
 *
 * Idempotent by construction: after a rule fires, the character at the position every rule tests is
 * a backslash, which is in none of their character classes — so escaping twice is escaping once —
 * and because every character it escapes is ASCII punctuation, both parsers consume the backslash
 * again on the way in.
 */
export function escapeBlockStarts(markdown: string): string {
  return markdown.split('\n').map(escapeLine).join('\n');
}
