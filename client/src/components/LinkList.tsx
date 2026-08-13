import { useState, type ReactNode } from 'react';
import { SectionTitle, Btn, DocumentRow, DragHandle, EmptyState } from './ui';
import { RecordFormModal, type FieldDef } from './fields';
import { InlineNotes } from './InlineNotes';
import { useListReorder } from '../lib/dragReorder';
import { api } from '../api/client';
import type { CustomColumnOption, LinkCreate, LinkItem } from '../api/types';
import { withAlpha } from '../lib/colors';
import { normalizeUrl } from '../lib/url';
import { ColorSwatchPicker } from './ColorSwatchPicker';
import { PencilIcon, TrashIcon } from './icons';
import { EditableLabel } from './EditableLabel';
import type { LabelKey } from '../lib/labels';
import {
  useInvalidateAll,
  useLinkCategoryOptions,
  useUndoableDelete,
  useUndoablePatch,
  resourceUndo,
} from '../hooks';

/**
 * The category picker only exists once categories are configured — an empty one is noise.
 *
 * `pills` rather than a `<select>`: setting a category was two clicks and dropped the colour the
 * list is grouped by, for a list that is a handful of entries long (WP-26). Deselecting is a
 * second click on the same pill, so there is no "—" option to pass here.
 */
function fields(categories: CustomColumnOption[]): FieldDef[] {
  return [
    { name: 'label', label: 'Bezeichnung', required: true, placeholder: 'z. B. TechRider Quartett' },
    { name: 'url', label: 'URL (Google Drive etc.)', span2: true, placeholder: 'https://…' },
    ...(categories.length > 0
      ? [{ name: 'category', label: 'Kategorie', type: 'pills' as const, span2: true, options: categories }]
      : []),
  ];
}

/**
 * The modal's `Record<string, string | null>` bag as a typed payload — a cast instead would put
 * CCL-24's hole back, since an index signature satisfies an all-optional target vacuously.
 *
 * The URL is stored fully qualified, as the editor's link bar does (RTE-09): the field has no
 * validation, so a typed „drive.google.com/…“ used to be stored verbatim and was then
 * unopenable for ever (CCL-09). A cleared field stays null and clears the column.
 *
 * `category` passes straight through and must **not** gain a `?? null`: `fields()` omits the
 * FieldDef entirely while no categories are configured, so the key is simply absent and the
 * PATCH leaves the column alone. Defaulting it would clobber a stored category on every edit
 * made in that state.
 */
function linkPayload(v: Record<string, string | null>): LinkCreate {
  return { label: v.label ?? '', url: v.url ? normalizeUrl(v.url) : v.url, category: v.category };
}

/** Where a new link hangs: exactly one id, or none at all — the empty object is season-level (WP-47). */
export type LinkParent = {
  artist_id?: number;
  project_id?: number;
  event_id?: number;
  task_id?: number;
  section_id?: number;
};

export function LinkList({
  titleKey,
  title,
  links,
  parent,
}: {
  /** Heading id — the text itself lives in `lib/labels.ts` and is user-renameable. */
  titleKey?: LabelKey;
  /** Rendered instead of the label heading — a custom widget's own (renameable) name. */
  title?: ReactNode;
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
    const patch = linkPayload(values);
    if (editing) {
      await undoablePatch({ res: api.links, row: editing, patch, label: 'Änderung am Link' });
      return;
    }
    await api.links.create({
      ...patch,
      artist_id: parent.artist_id ?? null,
      project_id: parent.project_id ?? null,
      event_id: parent.event_id ?? null,
      task_id: parent.task_id ?? null,
      section_id: parent.section_id ?? null,
    });
    await invalidate();
  };

  const setColor = async (l: LinkItem, color: string | null) => {
    await undoablePatch({ res: api.links, row: l, patch: { color }, label: 'Farbänderung' });
  };

  // One group per configured category (options order), then "Ohne Kategorie" as the catch-all
  // for links with no category *or* an unknown/legacy value — a stale value never hides a link.
  const known = new Set(categories.map((c) => c.value));
  /** The group a row is *rendered* in, which is what a drag may cross — not `l.category`. */
  const groupOf = (l: LinkItem) => (l.category && known.has(l.category) ? l.category : '');
  const grouped = categories
    .map((c) => ({ key: c.value, label: c.label, color: c.color, items: links.filter((l) => l.category === c.value) }))
    .filter((g) => g.items.length > 0);
  const uncategorized = links.filter((l) => groupOf(l) === '');

  // Dragging is confined to one category group: `sort_order` is a single sequence across the
  // whole list, so a drop across groups would move a row under a heading that contradicts its
  // category. Changing the category is the ✎ dialog's job (docs/DECISIONS.md, „Links reorder
  // inside their category"). The reorder itself still renumbers every row — see useListReorder on
  // why that leaves the other groups where they are.
  const byId = new Map(links.map((l) => [l.id, l]));
  const drag = useListReorder(links, api.links.reorder, (from, to) => {
    const a = byId.get(from);
    const b = byId.get(to);
    return !!a && !!b && groupOf(a) === groupOf(b);
  });

  /**
   * The group a drag currently belongs to, or null while none is running. Derived from the rows
   * rather than read out of the hook, which reports per-item state only. Every other group is
   * dimmed while this is set: a refused drop used to be silent — the row simply snapped back — and
   * a rule nobody can see reads as a broken feature, which is how this list was reported (WP-35).
   */
  const dragged = links.find((l) => drag.isDragging(l.id));
  const draggingGroup = dragged ? groupOf(dragged) : null;

  const row = (l: LinkItem) => (
    <DocumentRow
      key={l.id}
      label={l.label}
      url={l.url}
      color={l.color}
      dragging={drag.isDragging(l.id)}
      dropTarget={drag.isDropTarget(l.id)}
      handle={
        <DragHandle
          className="mt-0.5 text-base"
          // Only once categories exist: without them the list is one group and the qualifier
          // would name a rule that isn't in force.
          {...(categories.length > 0 ? { title: 'Zum Verschieben ziehen (innerhalb der Kategorie)' } : {})}
          {...drag.handleProps(l.id)}
        />
      }
      notes={
        // Inline-edited like a contact's note, and the add placeholder only shows on row hover
        // so a list of plain documents doesn't grow a second line per row.
        <div className={`mt-0.5 text-neutral-500 ${l.notes ? '' : 'opacity-0 transition group-hover:opacity-100'}`}>
          <InlineNotes
            compact
            value={l.notes}
            onSave={(notes) =>
              undoablePatch({ res: api.links, row: l, patch: { notes }, label: 'Textänderung' })
            }
          />
        </div>
      }
      actions={
        <>
          <ColorSwatchPicker value={l.color} onChange={(color) => setColor(l, color)} />
          <Btn variant="ghost" title="Bearbeiten" onClick={() => setEditing(l)}>
            <PencilIcon className="h-4 w-4" />
          </Btn>
          <Btn
            variant="danger"
            title="Löschen"
            onClick={() => del({ label: `Link „${l.label}“`, ...resourceUndo(api.links, l.id) })}
          >
            <TrashIcon className="h-4 w-4" />
          </Btn>
        </>
      }
      {...drag.itemProps(l.id)}
    />
  );

  return (
    <div>
      <SectionTitle right={<Btn onClick={() => setCreating(true)}>+ Link</Btn>}>
        {titleKey ? <EditableLabel k={titleKey} /> : title}
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
              <div
                key={g.key}
                className={`transition-opacity ${
                  draggingGroup !== null && draggingGroup !== g.key ? 'opacity-40' : ''
                }`}
              >
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
