import EmojiPicker, { emojiByUnified, EmojiStyle, Theme } from 'emoji-picker-react';
import de from 'emoji-picker-react/dist/data/emojis-de';
import { mergeEmojiNames } from '../lib/emojiData';

/**
 * German search names, plus the English ones the library searches by default (WP-38).
 *
 * Built once when this chunk loads, not per render. `emojiByUnified` reads the English dictionary
 * the picker already holds, so only the German one is added to the chunk — and it brings the
 * category headings („Tiere & Natur", „Essen & Trinken") with it.
 */
const EMOJI_DATA = mergeEmojiNames(de, (unified) => emojiByUnified(unified)?.n);

/**
 * Thin wrapper so `emoji-picker-react` (which bundles the full emoji dataset) lands in its own
 * chunk, `React.lazy`-loaded only when a user opens the picker. `emojiStyle="native"` renders OS
 * Unicode with **no image-sprite fetch**, keeping the app fully offline (WP-Q constraint).
 */
export default function EmojiPickerLazy({ onPick }: { onPick: (ch: string) => void }) {
  return (
    <EmojiPicker
      onEmojiClick={(d) => onPick(d.emoji)}
      emojiStyle={EmojiStyle.NATIVE}
      emojiData={EMOJI_DATA}
      // `emojiData` localizes the emoji and the category headings, nothing else — the two chrome
      // strings are separate props and stay English without them.
      searchPlaceholder="Suchen"
      searchClearButtonLabel="Leeren"
      // Pinned light, not AUTO: every surface in the app is hardcoded light (`grep -r 'dark:'
      // client/src` finds nothing, `index.css` declares `color-scheme: light`), so the dark
      // skin would drop a black panel over a white note editor. Revisit if a real dark mode
      // ever arrives (RTE-20).
      theme={Theme.LIGHT}
      height={340}
      width={300}
      previewConfig={{ showPreview: false }}
      skinTonesDisabled
    />
  );
}
