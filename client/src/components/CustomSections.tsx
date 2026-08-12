import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { CustomSection } from '../api/types';
import { Card, SectionTitle, Btn, PickerRow } from './ui';
import { Label, Modal, TextInput } from './fields';
import { SECTION_TYPES, type SectionGroup } from '../lib/sections';
import type { HiddenBuiltin } from '../lib/sectionSpecs';
import { InlineNotes } from './InlineNotes';
import { EditableText } from './EditableText';
import { LinkList } from './LinkList';
import type { LabelKey } from '../lib/labels';
import type { LayoutStore } from './SectionArranger';
import { useInvalidateAll, useLabel, useUndoableDelete, useUndoablePatch } from '../hooks';

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

// Both types moved to lib/ with the section catalog (WP-46); re-exported so callers keep one
// import surface for the picker wiring that stays in this file.
export type { SectionGroup } from '../lib/sections';
export type { HiddenBuiltin } from '../lib/sectionSpecs';

/**
 * The arranger-strip 🗑 handler for custom widgets: soft-delete the row **and drop its layout
 * entry**, undoable as one operation.
 *
 * Nothing used to remove the `cs<id>` entry, so the layout grew by one dead entry per widget the
 * user ever created. That is not merely untidy: `sort_order` and the widget ids are reused, so a
 * later widget can land on a stale entry and inherit its width and hidden flag (the `lt<id>` half
 * of this, SHL-18, is closed in `useRemoveLandingSection`).
 *
 * The `store` comes from the page because the layout does — `useEntityLayout` for an artist or a
 * project, `useSettingsArray` for the dashboard. Pruning stays here, at the delete site, because
 * this is where the deleted id is known; the arranger's read pass cannot tell a dead entry from a
 * widget whose section has not loaded yet.
 *
 * `current()` rather than the rendered array, for the reason `useLanding` documents: the undo
 * arm runs up to six seconds later, and rebuilding from a render snapshot would roll back every
 * layout change the user made in between.
 */
export function useRemoveCustomSection(
  sections: CustomSection[],
  store: LayoutStore,
): (key: string) => void {
  const del = useUndoableDelete();
  const { current, write } = store;
  return (key) => {
    const s = sections.find((x) => sectionKey(x) === key);
    if (!s) return;
    // Captured before the delete, so the undo can put the entry back where it sat rather than
    // appending it — a restored widget that jumps to the bottom of the page reads as a bug.
    const index = current().findIndex((e) => e.key === key);
    const entry = current()[index];
    void del({
      label: `Bereich „${s.name}“`,
      remove: async () => {
        const res = await api.customSections.remove(s.id);
        // Only when the entry is actually stored. On an entity page still following the template
        // `current()` *is* the template, and writing a filtered copy of it back would freeze it
        // onto this artist as its own layout — an arrangement the user never made (WP-25).
        if (index >= 0) await write(current().filter((e) => e.key !== key));
        return res;
      },
      restore: async () => {
        const res = await api.customSections.restore(s.id);
        if (entry) {
          const next = [...current()];
          next.splice(index < 0 ? next.length : Math.min(index, next.length), 0, entry);
          await write(next);
        }
        return res;
      },
    });
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
 * `SectionArranger`'s `addAction` for a page with built-in sections — the whole picker wiring
 * given the page's own label/group tables and the parent a new widget hangs off.
 *
 * The three pages that have built-ins (Dashboard, Künstler, Projekt) used to spell out the same
 * twelve-line block, byte-identical apart from `parent`. Adding a third picker group or changing
 * the `HiddenBuiltin` shape meant editing all three, and missing one left that page's „+ Bereich"
 * picker mis-grouping (PGS-28). The per-page `labelKeys`/`groups` tables genuinely differ and
 * stay in their pages.
 *
 * A key with no entry in either table is dropped rather than asserted: `hiddenKeys` comes from
 * the stored layout, which can carry a key this page does not know — the previous
 * `SECTION_LABEL_KEYS[k]!` turned that into an unnamed picker entry or a crash.
 */
export function builtinPicker(
  labelKeys: Record<string, LabelKey>,
  groups: Record<string, SectionGroup>,
  parent: SectionParent,
): (ctx: {
  hiddenKeys: string[];
  restore: (key: string) => void;
  prepend: (key: string) => void;
}) => ReactNode {
  return ({ hiddenKeys, restore, prepend }) => {
    const hiddenBuiltins: HiddenBuiltin[] = [];
    for (const key of hiddenKeys) {
      const labelKey = labelKeys[key];
      const group = groups[key];
      if (labelKey && group) hiddenBuiltins.push({ key, labelKey, group });
    }
    return (
      <AddSectionButton
        parent={parent}
        onRestore={restore}
        onPrepend={prepend}
        hiddenBuiltins={hiddenBuiltins}
      />
    );
  };
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
            {SECTION_TYPES.map((t) => (
              <PickerRow key={t.type} selected={chosen === t.type} onClick={() => setChosen(t.type)}>
                {t.label}
                <span className="ml-2 text-xs text-neutral-400">neu, mit eigenem Namen</span>
              </PickerRow>
            ))}
            {builtinsOf('eingabe').map((b) => (
              <PickerRow
                key={b.key}
                onClick={() => {
                  onRestore(b.key);
                  onClose();
                }}
              >
                {label(b.labelKey)}
              </PickerRow>
            ))}
          </div>
        </div>
        {builtinsOf('einblicke').length > 0 && (
          <div>
            <div className={groupHeading}>Einblicke</div>
            <div className="space-y-1.5">
              {builtinsOf('einblicke').map((b) => (
                <PickerRow
                  key={b.key}
                  onClick={() => {
                    onRestore(b.key);
                    onClose();
                  }}
                >
                  {label(b.labelKey)}
                </PickerRow>
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

/** One rendered widget: renameable title, body per type. Removal lives in the arranger strip. */
export function CustomSectionCard({ section }: { section: CustomSection }) {
  const undoablePatch = useUndoablePatch();

  const rename = (name: string) =>
    undoablePatch({ res: api.customSections, row: section, patch: { name }, label: 'Umbenennung' });

  if (section.type === 'links') {
    return <SectionLinkList section={section} title={<EditableText value={section.name} onSave={rename} inputClassName="uppercase" />} />;
  }
  return (
    <>
      <SectionTitle>
        <EditableText value={section.name} onSave={rename} inputClassName="uppercase" />
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
