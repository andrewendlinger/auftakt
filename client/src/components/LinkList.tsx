import { useState } from 'react';
import { SectionTitle, Btn, EmptyState } from './ui';
import { RecordFormModal, type FieldDef } from './fields';
import { api } from '../api/client';
import type { LinkItem } from '../api/types';
import { openExternal } from '../lib/external';
import { withAlpha } from '../lib/colors';
import { ColorSwatchPicker } from './ColorSwatchPicker';
import { TrashIcon } from './icons';
import { EditableLabel } from './EditableLabel';
import type { LabelKey } from '../lib/labels';
import { useInvalidateAll, useUndoableDelete, useUndoablePatch, resourceUndo } from '../hooks';

const FIELDS: FieldDef[] = [
  { name: 'label', label: 'Bezeichnung', required: true, placeholder: 'z. B. TechRider Quartett' },
  { name: 'url', label: 'URL (Google Drive etc.)', span2: true, placeholder: 'https://…' },
];

export type LinkParent = {
  artist_id?: number;
  project_id?: number;
  event_id?: number;
  task_id?: number;
};

export function LinkList({
  titleKey,
  links,
  parent,
}: {
  /** Heading id — the text itself lives in `lib/labels.ts` and is user-renameable. */
  titleKey: LabelKey;
  links: LinkItem[];
  parent: LinkParent;
}) {
  const invalidate = useInvalidateAll();
  const undoablePatch = useUndoablePatch();
  const del = useUndoableDelete();
  const [editing, setEditing] = useState<LinkItem | null>(null);
  const [creating, setCreating] = useState(false);

  const save = async (values: Record<string, string | null>) => {
    if (editing) {
      await undoablePatch({ res: api.links, row: editing, patch: values, label: 'Änderung am Link' });
      return;
    }
    await api.links.create({
      ...values,
      artist_id: parent.artist_id ?? null,
      project_id: parent.project_id ?? null,
      event_id: parent.event_id ?? null,
      task_id: parent.task_id ?? null,
    });
    await invalidate();
  };

  const setColor = async (l: LinkItem, color: string | null) => {
    await undoablePatch({ res: api.links, row: l, patch: { color }, label: 'Farbänderung' });
  };

  return (
    <div>
      <SectionTitle right={<Btn onClick={() => setCreating(true)}>+ Link</Btn>}>
        <EditableLabel k={titleKey} />
      </SectionTitle>
      {links.length === 0 ? (
        <EmptyState>Keine Dokumente hinterlegt.</EmptyState>
      ) : (
        <ul className="space-y-1.5">
          {links.map((l) => (
            <li
              key={l.id}
              className={`group flex items-center gap-3 rounded-xl px-3 py-2 shadow-sm ring-1 ring-black/5 ${
                l.color ? 'border-l-4' : 'bg-white'
              }`}
              style={l.color ? { background: withAlpha(l.color, 0.16), borderLeftColor: l.color } : undefined}
            >
              <span className="text-neutral-400">🔗</span>
              <div className="min-w-0 flex-1">
                {l.url ? (
                  <button
                    className="text-left font-medium text-sky-700 hover:underline"
                    onClick={() => openExternal(l.url!)}
                  >
                    {l.label}
                  </button>
                ) : (
                  <span className="font-medium text-neutral-700">
                    {l.label} <span className="text-xs font-normal text-neutral-400">(kein Link hinterlegt)</span>
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                <ColorSwatchPicker value={l.color} onChange={(color) => setColor(l, color)} />
                <Btn variant="ghost" title="Bearbeiten" onClick={() => setEditing(l)}>
                  ✎
                </Btn>
                <Btn
                  variant="danger"
                  title="Löschen"
                  onClick={() => del({ label: `Link „${l.label}“`, ...resourceUndo(api.links, l.id) })}
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
          title={editing ? 'Link bearbeiten' : 'Neuer Link'}
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
