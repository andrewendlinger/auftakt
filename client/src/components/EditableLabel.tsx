import { useState, type ReactNode } from 'react';
import { useLabel, useRenameLabel } from '../hooks';
import type { LabelKey } from '../lib/labels';
import { LABEL_DEFAULTS } from '../lib/labels';

/**
 * A heading the user can rename in place. Renders the resolved text plus a ✎ that appears on
 * hover; clicking it swaps in an input (Enter or blur saves, Esc cancels, empty resets to the
 * default). Drop it inside `SectionTitle` — or anywhere a heading string is rendered — and the
 * new name is picked up everywhere else that resolves the same id, including the
 * "Bereiche anordnen" strip.
 *
 * The pencil rather than a click-anywhere target: headings sit next to action buttons and are
 * read far more often than they are edited, so a bare click-to-edit would fire by accident.
 * `InlineNotes` draws the same line with its double-click.
 */
export function EditableLabel({
  k,
  tone = 'default',
  children,
}: {
  k: LabelKey;
  /** `dark` for the nav bar, which is white-on-neutral-900. */
  tone?: 'default' | 'dark';
  /**
   * Wraps the resolved text in something else — used by the nav, where the label is a
   * `NavLink`. The ✎ is always rendered as a *sibling* of whatever this returns: a `<button>`
   * inside an `<a>` is invalid HTML, and clicking it would navigate instead of editing.
   */
  children?: (text: string) => ReactNode;
}) {
  const label = useLabel();
  const rename = useRenameLabel();
  const text = label(k);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text);

  const start = () => {
    setValue(text);
    setEditing(true);
  };

  // The wrapper stays mounted in both states, so the heading keeps its place in the layout
  // and only its contents swap.
  return (
    <span data-label={k} className="group/label inline-flex items-center gap-1">
      {editing ? (
        <input
          autoFocus
          // Inherits the heading's own size/weight/tracking so the text doesn't jump on click.
          className={`min-w-32 rounded border bg-white px-1 py-0.5 font-[inherit] text-[inherit] uppercase tracking-[inherit] text-neutral-800 outline-none ${
            tone === 'dark' ? 'border-white/40' : 'border-neutral-300 focus:border-neutral-500'
          }`}
          value={value}
          title={`Leer lassen für „${LABEL_DEFAULTS[k]}“`}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            setEditing(false);
            // An empty value is a reset, not a no-op, so it still commits — `useRenameLabel`
            // turns it back into the default.
            if (value !== text) void rename(k, value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setValue(text);
              setEditing(false);
            }
          }}
        />
      ) : (
        <>
          {children ? children(text) : text}
          <button
            type="button"
            title="Umbenennen"
            aria-label={`„${text}“ umbenennen`}
            className={`rounded px-0.5 text-[11px] leading-none opacity-0 transition group-hover/label:opacity-100 focus:opacity-100 ${
              tone === 'dark' ? 'text-white/60 hover:text-white' : 'text-neutral-400 hover:text-neutral-700'
            }`}
            onClick={start}
          >
            ✎
          </button>
        </>
      )}
    </span>
  );
}
