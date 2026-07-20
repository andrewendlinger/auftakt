import { useState } from 'react';
import { SectionTitle, Btn, EmptyState } from './ui';
import { RecordFormModal, type FieldDef } from './fields';
import { api } from '../api/client';
import type { Contact } from '../api/types';
import { linkify } from '../lib/linkify';
import { withAlpha } from '../lib/colors';
import { Markdown } from './Markdown';
import { ColorSwatchPicker } from './ColorSwatchPicker';
import { TrashIcon } from './icons';
import { useInvalidateAll, useUndoableDelete, resourceUndo } from '../hooks';

const FIELDS: FieldDef[] = [
  { name: 'name', label: 'Name', required: true },
  { name: 'role', label: 'Rolle', placeholder: 'z. B. Management, Tech, Tour-Organisation' },
  { name: 'email', label: 'E-Mail', type: 'email' },
  { name: 'phone', label: 'Telefon', type: 'tel' },
  { name: 'notes', label: 'Notizen', type: 'textarea' },
];

export function ContactList({
  title = 'Kontakte',
  contacts,
  parent,
}: {
  title?: string;
  contacts: Contact[];
  parent: { artist_id?: number; project_id?: number };
}) {
  const invalidate = useInvalidateAll();
  const del = useUndoableDelete();
  const [editing, setEditing] = useState<Contact | null>(null);
  const [creating, setCreating] = useState(false);

  const save = async (values: Record<string, string | null>) => {
    if (editing) {
      await api.contacts.update(editing.id, values);
    } else {
      await api.contacts.create({
        ...values,
        artist_id: parent.artist_id ?? null,
        project_id: parent.project_id ?? null,
      });
    }
    await invalidate();
  };

  const setColor = async (c: Contact, color: string | null) => {
    await api.contacts.update(c.id, { color });
    await invalidate();
  };

  return (
    <div>
      <SectionTitle right={<Btn onClick={() => setCreating(true)}>+ Kontakt</Btn>}>{title}</SectionTitle>
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
                  {c.phone && <span className="text-neutral-600">{linkify(c.phone)}</span>}
                </div>
                {c.notes && (
                  <Markdown className="mt-0.5 text-sm text-neutral-500">{c.notes}</Markdown>
                )}
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
