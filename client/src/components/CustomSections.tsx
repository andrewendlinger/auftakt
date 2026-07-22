import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { CustomSection } from '../api/types';
import { Card, SectionTitle, Btn } from './ui';
import { RecordFormModal, type FieldDef } from './fields';
import { InlineNotes } from './InlineNotes';
import { LinkList } from './LinkList';
import { TrashIcon } from './icons';
import { useInvalidateAll, useUndoableDelete, useUndoablePatch, resourceUndo } from '../hooks';

/**
 * User-added widget sections (WP-S): named, typed sections the user adds to the dashboard,
 * an artist page or a project page. Per-entity — a widget added on one artist's page exists
 * only there. Two types: `text` (rich text, edited inline like "Allgemeines / Beschreibung")
 * and `links` (a full LinkList incl. the WP-P category grouping).
 */

/** Where a new widget hangs: exactly one id, or neither for the dashboard. */
export type SectionParent = { artist_id?: number; project_id?: number };

/** Section key in the SectionArranger layout — mirrors TaskTable's `c<id>` for custom columns. */
export function sectionKey(s: CustomSection): string {
  return `cs${s.id}`;
}

const ADD_FIELDS: FieldDef[] = [
  { name: 'name', label: 'Name', required: true, placeholder: 'z. B. Reiseplanung', span2: true },
  {
    name: 'type',
    label: 'Art',
    type: 'select',
    required: true,
    options: [
      { value: 'text', label: 'Textfeld' },
      { value: 'links', label: 'Dokumente & Links' },
    ],
  },
];

/** The "+ Bereich" button next to "Bereiche anordnen", opening a small name+type form. */
export function AddSectionButton({ parent }: { parent: SectionParent }) {
  const invalidate = useInvalidateAll();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Btn variant="subtle" onClick={() => setOpen(true)}>
        + Bereich
      </Btn>
      {open && (
        <RecordFormModal
          title="Neuer Bereich"
          fields={ADD_FIELDS}
          initial={{ type: 'text' }}
          onSubmit={async (v) => {
            await api.customSections.create({
              name: v.name ?? '',
              type: (v.type ?? 'text') as CustomSection['type'],
              artist_id: parent.artist_id ?? null,
              project_id: parent.project_id ?? null,
            });
            await invalidate();
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Click-to-edit widget title — the EditableLabel input pattern minus the label-key binding. */
function EditableText({ value, onSave }: { value: string; onSave: (v: string) => void | Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);

  if (editing) {
    return (
      <input
        autoFocus
        // Inherits the heading's own size/weight/tracking so the text doesn't jump on click.
        className="min-w-32 rounded border border-neutral-300 bg-white px-1 py-0.5 font-[inherit] text-[inherit] uppercase tracking-[inherit] text-neutral-800 outline-none focus:border-neutral-500"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setEditing(false);
          const v = text.trim();
          if (v && v !== value) void onSave(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(value);
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <span className="group/label inline-flex items-center gap-1">
      {value}
      <button
        type="button"
        title="Umbenennen"
        aria-label={`„${value}“ umbenennen`}
        className="rounded px-0.5 text-[11px] leading-none text-neutral-400 opacity-0 transition group-hover/label:opacity-100 focus:opacity-100 hover:text-neutral-700"
        onClick={() => {
          setText(value);
          setEditing(true);
        }}
      >
        ✎
      </button>
    </span>
  );
}

/** One rendered widget: title (renameable) + delete, body per type. */
export function CustomSectionCard({ section }: { section: CustomSection }) {
  const undoablePatch = useUndoablePatch();
  const del = useUndoableDelete();

  const rename = (name: string) =>
    undoablePatch({ res: api.customSections, row: section, patch: { name }, label: 'Umbenennung' });
  const deleteBtn = (
    <Btn
      variant="danger"
      title="Bereich löschen"
      onClick={() => del({ label: `Bereich „${section.name}“`, ...resourceUndo(api.customSections, section.id) })}
    >
      <TrashIcon className="h-4 w-4" />
    </Btn>
  );

  if (section.type === 'links') {
    return <SectionLinkList section={section} title={<EditableText value={section.name} onSave={rename} />} extraActions={deleteBtn} />;
  }
  return (
    <>
      <SectionTitle right={deleteBtn}>
        <EditableText value={section.name} onSave={rename} />
      </SectionTitle>
      <Card className="p-5">
        <InlineNotes
          value={section.value}
          onSave={(v) =>
            undoablePatch({ res: api.customSections, row: section, patch: { value: v }, label: 'Textänderung' })
          }
        />
      </Card>
    </>
  );
}

/** A links widget owns its query — the page can't know which sections exist up front. */
function SectionLinkList({
  section,
  title,
  extraActions,
}: {
  section: CustomSection;
  title: ReactNode;
  extraActions: ReactNode;
}) {
  const { data: links = [] } = useQuery({
    queryKey: ['links', 'section', section.id],
    queryFn: () => api.links.list({ section_id: section.id }),
  });
  return <LinkList links={links} parent={{ section_id: section.id }} title={title} extraActions={extraActions} />;
}

/** The widgets as SectionArranger inputs: `cs<id>`-keyed nodes plus their arrange-strip names. */
export function customSectionEntries(sections: CustomSection[]): {
  nodes: Record<string, ReactNode>;
  titles: Record<string, string>;
} {
  const nodes: Record<string, ReactNode> = {};
  const titles: Record<string, string> = {};
  for (const s of sections) {
    nodes[sectionKey(s)] = <CustomSectionCard section={s} />;
    titles[sectionKey(s)] = s.name;
  }
  return { nodes, titles };
}
