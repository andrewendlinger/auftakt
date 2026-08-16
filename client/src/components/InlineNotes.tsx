import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useGuardedAction } from '../hooks';
import { Markdown } from './Markdown';
import { caretPointIn, RichTextEditor, type CaretPoint } from './RichTextEditor';

/**
 * The box both halves render in — same border width, same padding, same font size (WP-56).
 *
 * Shared rather than merely similar, because the caret is resolved from the click coordinates
 * after the editor has mounted: any difference here moves the text between the two surfaces and
 * the caret lands where the text *was*. The reading view's border is transparent, so all the user
 * sees is the field's own border appearing around text that has not moved. It also has to stay the
 * same width, which is what makes both wrap at the same word.
 */
const BOX = 'rounded-xl border px-3 py-2 text-sm';

/**
 * Click-to-edit multi-line text: shows linkified text, a single click edits in place in a
 * rich-text editor (blur/⌘↵ saves, Esc cancels). Clicking a link inside the rendered text
 * follows the link instead of opening the editor. Used for "Allgemeines / Beschreibung" etc.
 *
 * The draft outlives a failed save on purpose — see `commit`.
 */
export function InlineNotes({
  value,
  onSave,
  placeholder = '+ hinzufügen',
  compact = false,
  images = false,
}: {
  value: string | null;
  onSave: (v: string | null) => void | Promise<void>;
  placeholder?: string;
  /**
   * For the one-line notes that live inside another row (a contact). Off by default, because
   * every other caller is a document-sized field. This block renders *both* halves of its
   * surface, so the flag goes to the editor and the reader together and they cannot drift.
   */
  compact?: boolean;
  /**
   * Offer „Bild einfügen" (WP-37). Threaded rather than defaulted on, because this block is also
   * the landing page's notes editor, whose text lives in `seasons.json` and not in a season
   * database — see `RichTextEditor`'s `images` prop.
   */
  images?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? '');
  const guard = useGuardedAction();
  const boxRef = useRef<HTMLDivElement>(null);
  // Where the click that started this edit landed — the editor turns it into a caret (WP-56).
  // `null` from the „+ hinzufügen" button, which points at no text.
  const [clickedAt, setClickedAt] = useState<CaretPoint | null>(null);

  const start = (e?: ReactMouseEvent<HTMLElement>) => {
    setText(value ?? '');
    setClickedAt(e ? caretPointIn(boxRef.current, e) : null);
    setEditing(true);
  };
  /**
   * Leave edit mode only once the write has actually landed.
   *
   * This used to run `setEditing(false)` first and *then* await `onSave`, which unmounts the
   * editor and its draft before the request resolves — and nothing caught the rejection. A
   * rejected write was indistinguishable from a successful one: the block collapsed back to
   * the old rendered value and the user's typed note was gone (RTE-01). Keeping the editor
   * mounted is what makes the text recoverable; re-entering edit mode would only reseed the
   * draft from the stale prop.
   */
  const commit = async () => {
    const v = text.trim() === '' ? null : text;
    if (v === (value ?? null)) {
      setEditing(false);
      return;
    }
    if (await guard('Der Text konnte nicht gespeichert werden.', async () => void (await onSave(v)))) {
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <RichTextEditor
        autoFocus
        caretAt={clickedAt}
        compact={compact}
        images={images}
        value={text}
        onChange={setText}
        className={`${BOX} min-h-32 w-full border-neutral-300 bg-white text-neutral-800 outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-900/5`}
        onBlur={commit}
        // Escape cancels; ⌘↵ saves by blurring, which the editor does for itself (WP-49).
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            setText(value ?? '');
            setEditing(false);
          }
        }}
      />
    );
  }

  if (!value) {
    return (
      <button className="text-sm text-neutral-400 transition hover:text-neutral-600" onClick={() => start()}>
        {placeholder}
      </button>
    );
  }

  return (
    <div
      ref={boxRef}
      className={`${BOX} cursor-text border-transparent text-neutral-700`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a')) return; // follow links, don't edit
        start(e);
      }}
    >
      <Markdown roomy={!compact}>{value}</Markdown>
    </div>
  );
}
