import { useState } from 'react';
import { Markdown } from './Markdown';
import { MarkdownTextarea } from './MarkdownTextarea';

/**
 * Click-to-edit multi-line notes: shows linkified text, edits in place in a
 * textarea (blur/⌘↵ saves, Esc cancels). Used for "Bestätigte Fakten" etc.
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
      <MarkdownTextarea
        autoFocus
        value={text}
        onChange={setText}
        className="min-h-32 w-full resize-y rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-900/5"
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setText(value ?? '');
            setEditing(false);
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur();
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
    <div className="group">
      <div className="cursor-text text-sm text-neutral-700" onDoubleClick={start}>
        <Markdown>{value}</Markdown>
      </div>
      <button
        className="mt-1 text-[11px] text-neutral-400 opacity-0 transition hover:text-neutral-600 group-hover:opacity-100"
        onClick={start}
      >
        ✎ bearbeiten
      </button>
    </div>
  );
}
