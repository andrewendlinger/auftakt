/**
 * Merging the emoji picker's two name dictionaries (WP-38).
 *
 * The reported bug was that „musik" finds nothing: `emoji-picker-react` searches the *English*
 * name list unless it is handed another one through `emojiData`. The library's own answer is to
 * pass the localized dictionary instead — but that **replaces** the English names rather than
 * adding to them. Only 664 of 1898 entries in `emojis-de` still carry an English word, so a
 * straight swap trades one broken search for another: „musik" would start working and „music"
 * would stop.
 *
 * The English names are taken from the copy the library already holds, through its own
 * `emojiByUnified` — importing `dist/data/emojis` a second time instead put a duplicate copy in
 * the chunk (measured: 714 KB against 529 KB), because the shipped ESM bundle inlines its own
 * rather than importing that file.
 *
 * Hence the lookup-function argument, and no data imports here at all: this module is pulled in
 * by `EmojiPickerLazy`, and a dictionary import would follow it into whatever else imports this.
 */

/** The half of the library's `DataEmoji` this module reads: unified codepoint and search names. */
export type NamedEmoji = { u: string; n: string[] };

/** The half of the library's `EmojiData` this module reads. `categories` is carried through. */
export type EmojiDictionary = { emojis: Record<string, NamedEmoji[]> };

const fold = (name: string) => name.toLowerCase();

/**
 * `base` with every emoji's search names extended by whatever `alsoKnownAs` returns for the same
 * codepoint.
 *
 * Everything else comes from `base` — category order, category *names* (the German dictionary
 * ships „Tiere & Natur" and the rest with it), and each entry's remaining fields. Names already
 * present are not repeated; the comparison is case-insensitive because both dictionaries list a
 * capitalized display form next to the lowercase search forms („Musiknote" and „musiknote").
 *
 * Codepoints `alsoKnownAs` does not know keep their names untouched — the two dictionaries do not
 * cover exactly the same set.
 */
export function mergeEmojiNames<T extends EmojiDictionary>(
  base: T,
  alsoKnownAs: (unified: string) => string[] | undefined,
): T {
  const emojis: Record<string, NamedEmoji[]> = {};
  for (const [category, group] of Object.entries(base.emojis)) {
    emojis[category] = group.map((entry) => {
      const extra = alsoKnownAs(entry.u);
      if (!extra) return entry;
      const known = new Set(entry.n.map(fold));
      const added = extra.filter((name) => !known.has(fold(name)));
      return added.length ? { ...entry, n: [...entry.n, ...added] } : entry;
    });
  }

  // The spread carries every field TypeScript cannot see through the generic — `categories`, and
  // each entry's `a`/`v`. Only `n` is rebuilt, and only ever grows.
  return { ...base, emojis } as T;
}
