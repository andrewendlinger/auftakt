/**
 * Schriftfarbe im Text (WP-62): the palette, as ids — the colours themselves are in `index.css`.
 *
 * Markdown has no colour, and Markdown is what is stored, so the mark serializes to a raw
 * `<span class="tc-…">` exactly as underlining serializes to a raw `<u>`. The class name is
 * therefore the one string both halves of the dialect have to agree on — `MdTextColor`
 * (`lib/richtext.ts`) writes and parses it, `sanitizeSchema` (`lib/markdownPipeline.ts`) admits it
 * — and it is spelled once, here.
 *
 * **A class, never a `style` attribute.** Freeing `style` in the sanitize schema would let
 * arbitrary CSS live in stored text — text that is also *imported*, from a CSV or a Notion export
 * — for the sake of one property. A `tc-` class is an enum instead of a surface: the worst an
 * unknown one can do is render in the default colour, because the only thing that paints is a rule
 * in our own stylesheet. That is also why neither `@tiptap/extension-text-style` nor
 * `@tiptap/extension-color` is used: both store into `style`.
 *
 * **The hex values are in the stylesheet, not here.** The rendered note is coloured by the class
 * and nothing else can do it, so a hex in TypeScript would be a second copy of the same eight
 * colours — and two lists drift. The picker paints its swatches with the very rule it is about to
 * apply (`background: currentColor` under a `tc-…` class), so it needs no hex either, and
 * `textColor.test.ts` pins every id below to a rule in `index.css`.
 *
 * The ids are German words because they are what the user picked and what a stored note then
 * carries for as long as it exists: `tc-rot` reads as the palette entry it is — in the database,
 * in a backup and in a diff — where `tc-3` or `tc-b91c1c` would not.
 */

export interface TextColorSpec {
  /** The `tc-` suffix, the stored spelling, and the key of the CSS rule. */
  readonly id: string;
  /** What the picker calls it. */
  readonly label: string;
}

/**
 * Eight tones, all readable as text on white (≥ 4.5:1 against #fff).
 *
 * Deliberately **not** `ColorSwatchPicker`'s `PRESETS`: those sixteen colour a dot beside a list
 * entry, where lightness is decoration — as *text* on white, its yellow (#eab308) and its lime
 * (#84cc16) cannot be read at all. What is borrowed from that component is the mechanism (an
 * anchored popover, a roving grid), not the list.
 *
 * There is no „eigene Farbe": a closed palette is what keeps the class an enum, and a free colour
 * would have to be spelled as a `style` — see the module note above.
 */
export const TEXT_COLORS: readonly TextColorSpec[] = [
  { id: 'rot', label: 'Rot' },
  { id: 'orange', label: 'Orange' },
  { id: 'bernstein', label: 'Bernstein' },
  { id: 'gruen', label: 'Grün' },
  { id: 'tuerkis', label: 'Türkis' },
  { id: 'blau', label: 'Blau' },
  { id: 'violett', label: 'Violett' },
  { id: 'pink', label: 'Pink' },
];

/**
 * The class shape both halves accept, in one place.
 *
 * A *shape* rather than a literal list of the eight above, and that is the deliberate half: a note
 * written today must still round-trip if the palette is ever re-cut. An id no rule matches simply
 * renders in the default colour — the sanitizer's job is to keep arbitrary CSS out, and a class
 * with no rule behind it is not CSS. Matching a whole class value (not merely its prefix) is what
 * keeps the editor from writing something back that the reader would drop.
 */
export const TEXT_COLOR_CLASS = /^tc-[a-z][a-z0-9-]{0,23}$/;

/** The class a colour id is stored as. */
export const textColorClass = (id: string): string => `tc-${id}`;

/**
 * The colour id in a `class` attribute, or `null` — the read half of the spelling.
 *
 * Takes the raw attribute string rather than an element, because `richtext.ts` is typechecked
 * without the DOM library (it is loaded by the headless round-trip gate).
 */
export function textColorFromClass(className: string | null | undefined): string | null {
  for (const name of (className ?? '').split(/\s+/)) {
    if (TEXT_COLOR_CLASS.test(name)) return name.slice('tc-'.length);
  }
  return null;
}
