import { useState } from 'react';
import { InlineInput } from './InlineInput';

// Inherits the heading's own size/weight/tracking so the text doesn't jump on click.
const FIELD =
  'rounded border border-neutral-300 bg-white px-1 py-0.5 font-[inherit] text-[inherit] text-neutral-800 outline-none focus:border-neutral-500';

/**
 * Click-to-edit free text — the EditableLabel input pattern minus the label-key binding.
 * Editing starts from the hover-revealed pencil, not a click on the text itself: these
 * sit in headings whose surroundings are clickable (widget cards, season cards), so a
 * click-anywhere target would misfire. An empty commit is a no-op.
 */
export function EditableText({
  value,
  onSave,
  inputClassName = '',
  truncate = false,
}: {
  value: string;
  onSave: (v: string) => void | Promise<void>;
  /** Extra classes on the edit input — CustomSections passes 'uppercase'. */
  inputClassName?: string;
  /** Clamp the display value to one line with an ellipsis (season card titles). */
  truncate?: boolean;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <InlineInput
        value={value}
        onCommit={onSave}
        onDone={() => setEditing(false)}
        stopClicks
        errorMessage="Der Name konnte nicht gespeichert werden."
        className={`min-w-32 tracking-[inherit] ${FIELD} ${inputClassName}`}
      />
    );
  }
  return (
    <span className={`group/label inline-flex items-center gap-1 ${truncate ? 'max-w-full' : ''}`}>
      {truncate ? <span className="min-w-0 truncate">{value}</span> : value}
      <button
        type="button"
        title="Umbenennen"
        aria-label={`„${value}“ umbenennen`}
        className="shrink-0 rounded px-0.5 text-[11px] leading-none text-neutral-400 opacity-0 transition group-hover/label:opacity-100 focus:opacity-100 hover:text-neutral-700"
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        ✎
      </button>
    </span>
  );
}

/**
 * Click-anywhere single-line text with an automatic fallback: shows `value ?? fallback`,
 * a click edits the override in place (the fallback only ever appears as placeholder),
 * and committing empty clears the override so the auto text returns — the EditableLabel
 * reset-to-default semantics, unlike EditableText's empty-is-a-no-op.
 */
export function EditableFallbackText({
  value,
  fallback,
  onSave,
  className = '',
}: {
  /** The stored override; null/undefined = unset → fallback shows. */
  value: string | null | undefined;
  /** Auto text when no override (e.g. „Angelegt am 12.03.2026"). */
  fallback: string;
  /** null = clear the override. */
  onSave: (v: string | null) => void | Promise<void>;
  /** Display classes — pass the surrounding text's classes so nothing jumps. */
  className?: string;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <InlineInput
        empty="clear"
        value={value ?? ''}
        onCommit={onSave}
        onDone={() => setEditing(false)}
        placeholder={fallback}
        stopClicks
        errorMessage="Der Text konnte nicht gespeichert werden."
        className={`min-w-40 ${FIELD} ${className}`}
      />
    );
  }
  return (
    <button
      type="button"
      title="Bearbeiten – leer lassen für automatischen Text"
      className={`cursor-text text-left transition hover:text-neutral-600 ${className}`}
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
    >
      {value ?? fallback}
    </button>
  );
}
