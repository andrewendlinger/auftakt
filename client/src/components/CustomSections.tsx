import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { CustomSection } from '../api/types';
import { Card, SectionTitle, Btn } from './ui';
import { Label, Modal, TextInput } from './fields';
import { InlineNotes } from './InlineNotes';
import { LinkList } from './LinkList';
import type { LabelKey } from '../lib/labels';
import { useInvalidateAll, useLabel, useUndoableDelete, useUndoablePatch, resourceUndo } from '../hooks';

/**
 * User-added widget sections (WP-S): named, typed sections the user adds to the dashboard,
 * an artist page or a project page. Per-entity — a widget added on one artist's page exists
 * only there. Two types: `text` (rich text, edited inline like "Allgemeines / Beschreibung")
 * and `links` (a full LinkList incl. the WP-P category grouping). Removal lives in the
 * SectionArranger's edit mode (its strip 🗑 calls the page's `useRemoveCustomSection`).
 */

/** Where a new widget hangs: exactly one id, or neither for the dashboard. */
export type SectionParent = { artist_id?: number; project_id?: number };

/** Section key in the SectionArranger layout — mirrors TaskTable's `c<id>` for custom columns. */
export function sectionKey(s: CustomSection): string {
  return `cs${s.id}`;
}

/** Which group of the add picker a built-in section belongs to. */
export type SectionGroup = 'eingabe' | 'einblicke';

/** A hidden built-in section the picker can re-add. */
export interface HiddenBuiltin {
  key: string;
  labelKey: LabelKey;
  group: SectionGroup;
}

/** The arranger-strip 🗑 handler for custom widgets: soft-delete the row, undoable. */
export function useRemoveCustomSection(sections: CustomSection[]): (key: string) => void {
  const del = useUndoableDelete();
  return (key) => {
    const s = sections.find((x) => sectionKey(x) === key);
    if (s) void del({ label: `Bereich „${s.name}“`, ...resourceUndo(api.customSections, s.id) });
  };
}

/**
 * The `cs<id>` keys of widgets that still hold content — a filled section can't be binned
 * (`nonEmptyKeys`). One links list for all widgets: the dataset is tiny and blanket-
 * invalidated on every write, the same trade the settings page makes for usage counts.
 */
export function useNonEmptyCustomSections(sections: CustomSection[]): string[] {
  const { data: allLinks = [] } = useQuery({ queryKey: ['links', 'all'], queryFn: () => api.links.list() });
  const linked = new Set(allLinks.map((l) => l.section_id).filter((id) => id != null));
  return sections
    .filter((s) => (s.type === 'text' ? !!s.value?.trim() : linked.has(s.id)))
    .map(sectionKey);
}

/**
 * The "+ Bereich" button (edit mode only), opening a grouped picker: „Eingabe" holds the two
 * custom widget types (needing a name) plus this page's hidden built-in input sections;
 * „Einblicke" holds the hidden computed sections. Built-ins are singletons — clicking one
 * restores it immediately; picking a custom type reveals the name field.
 */
export function AddSectionButton({
  parent,
  hiddenBuiltins,
  onRestore,
  onPrepend,
}: {
  parent: SectionParent;
  hiddenBuiltins: HiddenBuiltin[];
  onRestore: (key: string) => void;
  /** Layout callback placing a just-created widget at the top — new Bereiche always start there. */
  onPrepend: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Btn variant="subtle" onClick={() => setOpen(true)}>
        + Bereich
      </Btn>
      {open && (
        <AddSectionModal
          parent={parent}
          hiddenBuiltins={hiddenBuiltins}
          onRestore={onRestore}
          onPrepend={onPrepend}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

const CUSTOM_TYPES: Array<{ type: CustomSection['type']; label: string }> = [
  { type: 'text', label: 'Textfeld' },
  { type: 'links', label: 'Dokumente & Links' },
];

function AddSectionModal({
  parent,
  hiddenBuiltins,
  onRestore,
  onPrepend,
  onClose,
}: {
  parent: SectionParent;
  hiddenBuiltins: HiddenBuiltin[];
  onRestore: (key: string) => void;
  onPrepend: (key: string) => void;
  onClose: () => void;
}) {
  const invalidate = useInvalidateAll();
  const label = useLabel();
  const [chosen, setChosen] = useState<CustomSection['type'] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim() || !chosen || busy) return;
    setBusy(true);
    try {
      const row = await api.customSections.create({
        name: name.trim(),
        type: chosen,
        artist_id: parent.artist_id ?? null,
        project_id: parent.project_id ?? null,
      });
      await invalidate();
      onPrepend(sectionKey(row));
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const groupHeading = 'mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400';
  const row = (selected: boolean) =>
    `w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
      selected ? 'border-neutral-500 bg-neutral-50' : 'border-neutral-200 hover:bg-neutral-50'
    }`;
  const builtinsOf = (group: SectionGroup) => hiddenBuiltins.filter((b) => b.group === group);

  return (
    <Modal
      title="Bereich hinzufügen"
      onClose={onClose}
      footer={
        chosen && (
          <>
            <Btn onClick={onClose}>Abbrechen</Btn>
            <Btn variant="primary" onClick={create} disabled={!name.trim() || busy}>
              Hinzufügen
            </Btn>
          </>
        )
      }
    >
      <div className="space-y-4">
        <div>
          <div className={groupHeading}>Eingabe</div>
          <div className="space-y-1.5">
            {CUSTOM_TYPES.map((t) => (
              <button key={t.type} className={row(chosen === t.type)} onClick={() => setChosen(t.type)}>
                {t.label}
                <span className="ml-2 text-xs text-neutral-400">neu, mit eigenem Namen</span>
              </button>
            ))}
            {builtinsOf('eingabe').map((b) => (
              <button
                key={b.key}
                className={row(false)}
                onClick={() => {
                  onRestore(b.key);
                  onClose();
                }}
              >
                {label(b.labelKey)}
              </button>
            ))}
          </div>
        </div>
        {builtinsOf('einblicke').length > 0 && (
          <div>
            <div className={groupHeading}>Einblicke</div>
            <div className="space-y-1.5">
              {builtinsOf('einblicke').map((b) => (
                <button
                  key={b.key}
                  className={row(false)}
                  onClick={() => {
                    onRestore(b.key);
                    onClose();
                  }}
                >
                  {label(b.labelKey)}
                </button>
              ))}
            </div>
          </div>
        )}
        {chosen && (
          <div>
            <Label>Name</Label>
            <TextInput
              autoFocus
              value={name}
              placeholder="z. B. Reiseplanung"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create();
              }}
            />
          </div>
        )}
      </div>
    </Modal>
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

/** One rendered widget: renameable title, body per type. Removal lives in the arranger strip. */
export function CustomSectionCard({ section }: { section: CustomSection }) {
  const undoablePatch = useUndoablePatch();

  const rename = (name: string) =>
    undoablePatch({ res: api.customSections, row: section, patch: { name }, label: 'Umbenennung' });

  if (section.type === 'links') {
    return <SectionLinkList section={section} title={<EditableText value={section.name} onSave={rename} />} />;
  }
  return (
    <>
      <SectionTitle>
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
function SectionLinkList({ section, title }: { section: CustomSection; title: ReactNode }) {
  const { data: links = [] } = useQuery({
    queryKey: ['links', 'section', section.id],
    queryFn: () => api.links.list({ section_id: section.id }),
  });
  return <LinkList links={links} parent={{ section_id: section.id }} title={title} />;
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
