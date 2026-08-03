import { useState } from 'react';
import { SectionTitle, Btn, EmptyState } from './ui';
import { RecordFormModal, type FieldDef } from './fields';
import { api } from '../api/client';
import type { Contact, ContactCreate } from '../api/types';
import { linkify } from '../lib/linkify';
import { withAlpha } from '../lib/colors';
import { InlineNotes } from './InlineNotes';
import { ColorSwatchPicker } from './ColorSwatchPicker';
import { TrashIcon } from './icons';
import { EditableLabel } from './EditableLabel';
import type { LabelKey } from '../lib/labels';
import { useInvalidateAll, useUndoableDelete, useUndoablePatch, resourceUndo } from '../hooks';

const FIELDS: FieldDef[] = [
  { name: 'name', label: 'Name', required: true },
  { name: 'role', label: 'Rolle', placeholder: 'z. B. Management, Tech, Tour-Organisation' },
  { name: 'email', label: 'E-Mail', type: 'email' },
  { name: 'phone', label: 'Telefon', type: 'tel' },
  // No notes field: "Allgemeines / Beschreibung" is edited inline on the contact card.
];

/**
 * The one place the modal's `Record<string, string | null>` bag becomes a typed payload. A cast
 * here instead would put CCL-24's hole straight back: an index signature satisfies an
 * all-optional target vacuously, so nothing at all would be checked. `?? ''` is unreachable —
 * `name` is `required: true` and RecordFormModal refuses to submit while it is blank.
 */
function contactPayload(v: Record<string, string | null>): ContactCreate {
  return { name: v.name ?? '', role: v.role, email: v.email, phone: v.phone };
}

export function ContactList({
  titleKey,
  contacts,
  parent,
}: {
  /** Heading id — the text itself lives in `lib/labels.ts` and is user-renameable. */
  titleKey: LabelKey;
  contacts: Contact[];
  parent: { artist_id?: number; project_id?: number };
}) {
  const invalidate = useInvalidateAll();
  const undoablePatch = useUndoablePatch();
  const del = useUndoableDelete();
  const [editing, setEditing] = useState<Contact | null>(null);
  const [creating, setCreating] = useState(false);

  const save = async (values: Record<string, string | null>) => {
    if (editing) {
      await undoablePatch({
        res: api.contacts,
        row: editing,
        patch: contactPayload(values),
        label: 'Änderung am Kontakt',
      });
      return;
    }
    await api.contacts.create({
      ...contactPayload(values),
      artist_id: parent.artist_id ?? null,
      project_id: parent.project_id ?? null,
    });
    await invalidate();
  };

  const setColor = async (c: Contact, color: string | null) => {
    await undoablePatch({ res: api.contacts, row: c, patch: { color }, label: 'Farbänderung' });
  };

  return (
    <div>
      <SectionTitle right={<Btn onClick={() => setCreating(true)}>+ Kontakt</Btn>}>
        <EditableLabel k={titleKey} />
      </SectionTitle>
      {contacts.length === 0 ? (
        <EmptyState>Keine Kontakte.</EmptyState>
      ) : (
        <ul className="space-y-1">
          {contacts.map((c) => (
            <li
              key={c.id}
              className={`group flex items-start gap-3 rounded-lg px-3 py-1.5 shadow-sm ring-1 ring-black/5 ${
                c.color ? 'border-l-4' : 'bg-white'
              }`}
              style={c.color ? { background: withAlpha(c.color, 0.16), borderLeftColor: c.color } : undefined}
            >
              <div className="min-w-0 flex-1">
                {/* Name · role · email · phone on one line to keep long contact lists compact. */}
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
                  <span className="font-medium text-neutral-800">{c.name}</span>
                  {c.role && <span className="text-xs text-neutral-500">{c.role}</span>}
                  {c.email && <span className="text-neutral-600">{linkify(c.email)}</span>}
                  {/* Plain text: linkify never matched a phone number, so this was already what
                      rendered — a `tel:` link would mean widening openExternal's allowlist. */}
                  {c.phone && <span className="text-neutral-600">{c.phone}</span>}
                </div>
                {/* Inline-edited; the add placeholder only appears on row hover so contact
                    lists without notes don't grow a button per row. */}
                <div className={`mt-0.5 text-neutral-500 ${c.notes ? '' : 'opacity-0 transition group-hover:opacity-100'}`}>
                  <InlineNotes
                    value={c.notes}
                    onSave={(v) =>
                      undoablePatch({ res: api.contacts, row: c, patch: { notes: v }, label: 'Textänderung' })
                    }
                  />
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                <ColorSwatchPicker value={c.color} onChange={(color) => setColor(c, color)} />
                <Btn variant="ghost" title="Bearbeiten" onClick={() => setEditing(c)}>
                  ✎
                </Btn>
                <Btn
                  variant="danger"
                  title="Löschen"
                  onClick={() => del({ label: `Kontakt „${c.name}“`, ...resourceUndo(api.contacts, c.id) })}
                >
                  <TrashIcon className="h-4 w-4" />
                </Btn>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <RecordFormModal
          title={editing ? 'Kontakt bearbeiten' : 'Neuer Kontakt'}
          fields={FIELDS}
          initial={editing ?? undefined}
          onSubmit={save}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
