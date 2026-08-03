import { useState } from 'react';
import { useLabel, useRenameLabel } from '../hooks';
import type { LabelKey } from '../lib/labels';
import { LABEL_DEFAULTS } from '../lib/labels';
import { InlineInput } from './InlineInput';

/**
 * A heading the user can rename in place. Renders the resolved text plus a ✎ that appears on
 * hover; clicking it swaps in an input (Enter or blur saves, Esc cancels, empty resets to the
 * default). Drop it inside `SectionTitle` — or anywhere a heading string is rendered — and the
 * new name is picked up everywhere else that resolves the same id, including the
 * "Bereiche anordnen" strip.
 *
 * The pencil rather than a click-anywhere target: headings sit next to action buttons and are
 * read far more often than they are edited, so a bare click-to-edit would fire by accident.
 * (Body text is different: `InlineNotes` is click-anywhere, because a text block is its own
 * click target with nothing else competing for the click.)
 */
export function EditableLabel({ k }: { k: LabelKey }) {
  const label = useLabel();
  const rename = useRenameLabel();
  const text = label(k);
  const [editing, setEditing] = useState(false);

  // The wrapper stays mounted in both states, so the heading keeps its place in the layout
  // and only its contents swap.
  return (
    <span data-label={k} className="group/label inline-flex items-center gap-1">
      {editing ? (
        // `empty: 'raw'` — an empty value is a reset, not a no-op, and `useRenameLabel` turns
        // it back into the default.
        <InlineInput
          empty="raw"
          value={text}
          onCommit={(v) => rename(k, v)}
          onDone={() => setEditing(false)}
          title={`Leer lassen für „${LABEL_DEFAULTS[k]}“`}
          errorMessage="Die Bezeichnung konnte nicht gespeichert werden."
          // Inherits the heading's own size/weight/tracking so the text doesn't jump on click.
          className="min-w-32 rounded border border-neutral-300 bg-white px-1 py-0.5 font-[inherit] text-[inherit] uppercase tracking-[inherit] text-neutral-800 outline-none focus:border-neutral-500"
        />
      ) : (
        <>
          {text}
          <button
            type="button"
            title="Umbenennen"
            aria-label={`„${text}“ umbenennen`}
            className="rounded px-0.5 text-[11px] leading-none text-neutral-400 opacity-0 transition group-hover/label:opacity-100 hover:text-neutral-700 focus:opacity-100"
            onClick={() => setEditing(true)}
          >
            ✎
          </button>
        </>
      )}
    </span>
  );
}
