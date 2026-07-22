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
      theme={Theme.AUTO}
      height={340}
      width={300}
      previewConfig={{ showPreview: false }}
      skinTonesDisabled
    />
  );
}
