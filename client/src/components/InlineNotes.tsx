import { useState } from 'react';
import { Markdown } from './Markdown';
import { RichTextEditor } from './RichTextEditor';

/**
 * Click-to-edit multi-line text: shows linkified text, a single click edits in place in a
 * rich-text editor (blur/⌘↵ saves, Esc cancels). Clicking a link inside the rendered text
 * follows the link instead of opening the editor. Used for "Allgemeines / Beschreibung" etc.
 */
export function InlineNotes({
  value,
  onSave,
  placeholder = '+ hinzufügen',
}: {
  value: string | null;
  onSave: (v: string | null) => void | Promise<void>;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? '');

  const start = () => {
    setText(value ?? '');
    setEditing(true);
  };
  const commit = async () => {
    setEditing(false);
    const v = text.trim() === '' ? null : text;
    if (v !== (value ?? null)) await onSave(v);
  };

  if (editing) {
    return (
      <RichTextEditor
        autoFocus
        compact
        value={text}
        onChange={setText}
        className="min-h-32 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-900/5"
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            setText(value ?? '');
            setEditing(false);
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            (e.target as HTMLElement).blur();
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
      <Markdown>{value}</Markdown>
    </div>
  );
}
