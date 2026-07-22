import { useState } from 'react';
import { SectionTitle, Btn, EmptyState } from './ui';
import { RecordFormModal, type FieldDef } from './fields';
import { api } from '../api/client';
import type { CustomColumnOption, LinkItem } from '../api/types';
import { openExternal } from '../lib/external';
import { withAlpha } from '../lib/colors';
import { ColorSwatchPicker } from './ColorSwatchPicker';
import { TrashIcon } from './icons';
import { EditableLabel } from './EditableLabel';
import type { LabelKey } from '../lib/labels';
import {
  useInvalidateAll,
  useLinkCategoryOptions,
  useUndoableDelete,
  useUndoablePatch,
  resourceUndo,
} from '../hooks';

/** The category select only exists once categories are configured — an empty select is noise. */
function fields(categories: CustomColumnOption[]): FieldDef[] {
  return [
    { name: 'label', label: 'Bezeichnung', required: true, placeholder: 'z. B. TechRider Quartett' },
    { name: 'url', label: 'URL (Google Drive etc.)', span2: true, placeholder: 'https://…' },
    ...(categories.length > 0
      ? [
          {
            name: 'category',
            label: 'Kategorie',
            type: 'select' as const,
            options: categories.map(({ value, label }) => ({ value, label })),
          },
        ]
      : []),
  ];
}

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
  const categories = useLinkCategoryOptions();
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

  const row = (l: LinkItem) => (
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
  );

  // One group per configured category (options order), then "Ohne Kategorie" as the catch-all
  // for links with no category *or* an unknown/legacy value — a stale value never hides a link.
  const grouped = categories
    .map((c) => ({ key: c.value, label: c.label, color: c.color, items: links.filter((l) => l.category === c.value) }))
    .filter((g) => g.items.length > 0);
  const known = new Set(categories.map((c) => c.value));
  const uncategorized = links.filter((l) => l.category == null || !known.has(l.category));

  return (
    <div>
      <SectionTitle right={<Btn onClick={() => setCreating(true)}>+ Link</Btn>}>
        <EditableLabel k={titleKey} />
      </SectionTitle>
      {links.length === 0 ? (
        <EmptyState>Keine Dokumente hinterlegt.</EmptyState>
      ) : categories.length === 0 ? (
        <ul className="space-y-1.5">{links.map(row)}</ul>
      ) : (
        <div className="space-y-4">
          {[...grouped, { key: '', label: 'Ohne Kategorie', color: null as string | null, items: uncategorized }]
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <div key={g.key}>
                <div className="mb-1.5">
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-600"
                    style={g.color ? { background: withAlpha(g.color, 0.5) } : { background: '#f5f5f5' }}
                  >
                    {g.label}
                  </span>
                </div>
                <ul className="space-y-1.5">{g.items.map(row)}</ul>
              </div>
            ))}
        </div>
      )}

      {(creating || editing) && (
        <RecordFormModal
          title={editing ? 'Link bearbeiten' : 'Neuer Link'}
          fields={fields(categories)}
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
