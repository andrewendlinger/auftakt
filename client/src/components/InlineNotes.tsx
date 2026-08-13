import { useState } from 'react';
import { useGuardedAction } from '../hooks';
import { Markdown } from './Markdown';
import { RichTextEditor } from './RichTextEditor';

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
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? '');
  const guard = useGuardedAction();

  const start = () => {
    setText(value ?? '');
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
        compact={compact}
        value={text}
        onChange={setText}
        className="min-h-32 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-900/5"
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
      <button className="text-sm text-neutral-400 transition hover:text-neutral-600" onClick={start}>
        {placeholder}
      </button>
    );
  }

  return (
    <div
      className="cursor-text text-sm text-neutral-700"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a')) return; // follow links, don't edit
        start();
      }}
    >
      <Markdown roomy={!compact}>{value}</Markdown>
    </div>
  );
}
