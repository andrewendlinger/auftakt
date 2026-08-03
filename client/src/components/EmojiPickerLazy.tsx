import EmojiPicker, { EmojiStyle, Theme } from 'emoji-picker-react';

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
