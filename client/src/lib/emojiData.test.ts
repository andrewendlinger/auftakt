import { emojiByUnified } from 'emoji-picker-react';
import de from 'emoji-picker-react/dist/data/emojis-de';
import en from 'emoji-picker-react/dist/data/emojis';
import { describe, expect, it } from 'vitest';
import { mergeEmojiNames, type EmojiDictionary } from './emojiData';

const MUSICAL_NOTE = '1f3b5';
const GUITAR = '1f3b8';

/** What `EmojiPickerLazy` passes in: the English names out of the picker's own copy. */
const englishNames = (unified: string) => emojiByUnified(unified)?.n;

/**
 * What the picker's search does, reduced to the part this module is responsible for: it matches a
 * typed term against an emoji's names. Whether the library matches by prefix or substring is its
 * business — what WP-38 has to guarantee is that the *name is there to be matched*.
 */
function namesFor(data: EmojiDictionary, unified: string): string[] {
  for (const group of Object.values(data.emojis)) {
    for (const entry of group) if (entry.u === unified) return entry.n.map((n) => n.toLowerCase());
  }
  return [];
}

const finds = (data: EmojiDictionary, unified: string, term: string) =>
  namesFor(data, unified).some((name) => name.includes(term));

/**
 * The reported bug, nailed to a test: the customer typed „musik" and the picker showed nothing.
 *
 * These read the dictionaries out of `node_modules` on purpose. The fix is a file that ships with
 * `emoji-picker-react` — if a version bump renames or drops it, this fails loudly instead of
 * quietly falling back to English again.
 */
describe('the shipped dictionaries', () => {
  it('is why the search failed: German names live in a file we were not loading', () => {
    expect(finds(en, MUSICAL_NOTE, 'musik')).toBe(false);
    expect(finds(de, MUSICAL_NOTE, 'musik')).toBe(true);
  });

  it('is also why loading it alone is not enough — German replaces English, it does not add', () => {
    expect(finds(de, MUSICAL_NOTE, 'music')).toBe(false);
    expect(finds(de, GUITAR, 'guitar')).toBe(false);
  });
});

describe('mergeEmojiNames, on the real dictionaries', () => {
  const merged = mergeEmojiNames(de, englishNames);

  // The picker's own lookup is what the app hands the merge, and it is the half that cannot be
  // seen in a build: if a version bump stops exporting it, the chunk keeps compiling and the
  // English search quietly disappears.
  it('reads the English names out of the picker itself', () => {
    expect(englishNames(MUSICAL_NOTE)?.map((n) => n.toLowerCase())).toEqual(namesFor(en, MUSICAL_NOTE));
  });

  it('finds the music emoji in both languages', () => {
    expect(finds(merged, MUSICAL_NOTE, 'musik')).toBe(true);
    expect(finds(merged, MUSICAL_NOTE, 'music')).toBe(true);
    expect(finds(merged, GUITAR, 'gitarre')).toBe(true);
    expect(finds(merged, GUITAR, 'guitar')).toBe(true);
  });

  it('keeps the German category names', () => {
    expect(merged.categories).toBe(de.categories);
  });

  it('never loses a name', () => {
    for (const [category, group] of Object.entries(de.emojis)) {
      for (const [i, entry] of group.entries()) {
        expect(merged.emojis[category]?.[i]?.n).toEqual(expect.arrayContaining(entry.n));
      }
    }
  });
});

describe('mergeEmojiNames', () => {
  const base: EmojiDictionary = { emojis: { music: [{ u: '1f3b5', n: ['musik', 'Musiknote'] }] } };
  const lookup = (names: Record<string, string[]>) => (unified: string) => names[unified];

  it('appends the names it does not already have', () => {
    const merged = mergeEmojiNames(base, lookup({ '1f3b5': ['music', 'note'] }));
    expect(namesFor(merged, '1f3b5')).toEqual(['musik', 'musiknote', 'music', 'note']);
  });

  // Both dictionaries list a capitalized display form beside the lowercase search forms, so a
  // case-sensitive comparison would append „Musiknote" to itself for most of the 1898 entries.
  it('compares names without case', () => {
    const merged = mergeEmojiNames(base, lookup({ '1f3b5': ['MUSIKNOTE'] }));
    expect(namesFor(merged, '1f3b5')).toEqual(['musik', 'musiknote']);
  });

  it('leaves a codepoint the lookup does not know alone', () => {
    const merged = mergeEmojiNames(base, lookup({ '1f3b8': ['guitar'] }));
    expect(namesFor(merged, '1f3b5')).toEqual(['musik', 'musiknote']);
  });

  it('carries the fields it does not read', () => {
    const withExtras = {
      categories: { music: { name: 'Musik' } },
      emojis: { music: [{ u: '1f3b5', n: ['musik'], a: '0.6' }] },
    };
    const merged = mergeEmojiNames(withExtras, lookup({ '1f3b5': ['music'] }));
    expect(merged.categories).toEqual({ music: { name: 'Musik' } });
    expect(merged.emojis.music?.[0]?.a).toBe('0.6');
  });
});
