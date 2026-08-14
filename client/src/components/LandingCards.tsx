import { useState } from 'react';
import type {
  LandingContent,
  LandingDoc,
  LandingDocInput,
  LandingSection,
  LandingSectionInput,
} from '../api/types';
import { Card, SectionTitle, Btn, DocumentRow, DragHandle, EmptyState } from './ui';
import { SectionPickerModal } from './SectionPickerModal';
import { normalizeUrl } from '../lib/url';
import { arrayMoveTo } from '../lib/arrays';
import { useDragReorder } from '../lib/dragReorder';
import { RecordFormModal, type FieldDef } from './fields';
import { EditableLabel } from './EditableLabel';
import { EditableText } from './EditableText';
import { InlineNotes } from './InlineNotes';
import { PencilIcon, TrashIcon } from './icons';
import { useLanding, useUndoableDelete } from '../hooks';

/**
 * The landing page's content sections below the season grid. Everything here is
 * cross-season — stored in the seasons.json registry, not in any season DB — so it
 * stays put when the active season changes. Custom sections (Textfelder and extra
 * Dokumente lists) are registry rows (`landing.sections`), not `custom_sections`
 * rows, for the same reason; their layout keys are `lt<id>`.
 */

export const landingSectionKey = (s: LandingSection): string => `lt${s.id}`;

/**
 * The `lt<id>` keys of landing sections that still hold content, for the arranger's
 * `nonEmptyKeys` — the registry twin of `useNonEmptyCustomSections`, testing the same two
 * things (a Textfeld by its text, a Dokumente list by its rows).
 *
 * Without it the page reported only `notizen`/`dokumente`, so `nonEmptyKeys.includes(key)` was
 * false for every custom section and the arranger's 🗑 skipped the confirm modal entirely: one
 * click on a filled Textfeld deleted it and its text outright, while the identical 🗑 one card
 * above — or on any widget on the dashboard, an artist or a project page — asks first
 * (SHL-03, PGS-08).
 */
export function nonEmptyLandingKeys(landing: LandingContent): string[] {
  return landing.sections
    .filter((s) => (s.type === 'links' ? !!s.documents?.length : !!s.value?.trim()))
    .map(landingSectionKey);
}

/**
 * Replace the landing's sections, computed from the list as the *server* has it.
 *
 * The `all` prop this replaced was a render snapshot shared by every section on the page, so a
 * write issued from one section — or an undo landing seconds after it was armed — carried the
 * other sections back to how they looked at that render, reverting a rename or a note the user
 * had typed in between (SHL-01, SHL-02). `useLanding().update` is now what guarantees the input:
 * it re-reads before applying and retries if another window wrote in between (WP-53), which is
 * also why the `useReadLanding` helper that used to sit here is gone — a cold cache can no
 * longer be read as „no sections" and then written back (SHL-03).
 */
function usePatchSections() {
  const { update } = useLanding();
  return async (fn: (sections: LandingSection[]) => LandingSectionInput[]) => {
    await update((cur) => ({ sections: fn(cur.sections) }));
  };
}

export function LandingNotesSection({ landing }: { landing: LandingContent }) {
  const { update } = useLanding();
  return (
    <div>
      <SectionTitle>
        <EditableLabel k="landing.notizen" />
      </SectionTitle>
      <Card className="p-5">
        <InlineNotes
          value={landing.notes}
          placeholder="+ Notiz hinzufügen"
          // The one write here that ignores `cur`: a note is a scalar, so last-write-wins is the
          // only semantics there is. It still goes through `update`, which is what keeps a
          // concurrent *document* add in the other window from being the thing that loses.
          onSave={async (notes) => {
            await update(() => ({ notes }));
          }}
        />
      </Card>
    </div>
  );
}

const DOC_FIELDS: FieldDef[] = [
  { name: 'label', label: 'Bezeichnung', required: true, placeholder: 'z. B. Fördervertrag' },
  { name: 'url', label: 'URL (Google Drive etc.)', span2: true, placeholder: 'https://…' },
];

/**
 * A document list plus its add/edit modal and undoable delete, parameterized by where the docs
 * live: the builtin Dokumente section is `landing.documents`, a custom links section its own
 * `documents` inside the sections array.
 *
 * That parameter is `updateDocs` — one lens, not the `read`/`onPatch` pair it replaced. Every
 * mutation here computes a whole new array and the `docs` prop is only as fresh as the last
 * render, so the two halves always had to be used together anyway; making them one function is
 * what lets `useLanding().update` re-run a mutation against fresh content when another window
 * wrote first (WP-53).
 */
function DocList({
  docs,
  updateDocs,
  creating,
  onCloseCreate,
}: {
  docs: LandingDoc[];
  /**
   * Replace the list this section owns, computed from its contents as the server has them —
   * never from the `docs` prop. The undo arms below run seconds after the click and from
   * whatever screen the user has moved to by then; `docs` names the list as it looked at a
   * render that is long past, and writing that back is SHL-01.
   */
  updateDocs: (fn: (docs: LandingDoc[]) => LandingDocInput[]) => Promise<void>;
  /** The "+ Dokument" button lives in the section title — the parent owns this state. */
  creating: boolean;
  onCloseCreate: () => void;
}) {
  const del = useUndoableDelete();
  const [editing, setEditing] = useState<LandingDoc | null>(null);

  /**
   * Drag-to-reorder, the same affordance every other content list has (docs/DECISIONS.md,
   * „Inhaltslisten bekommen Drag"). Landing documents are a JSON array in the registry, so the
   * move *is* the write: `patchLanding` stores what it is given and `assignDocIds` keeps both
   * order and ids.
   *
   * `useDragReorder` directly rather than `useListReorder`, which the other flat lists use: that
   * one persists by sending ids in display order to a batch `reorder` endpoint and computes them
   * from the array its caller *rendered* with. There is no such endpoint here — and a snapshot is
   * exactly what this component may not write, since a document added since that render is absent
   * from it and a PATCH would delete it outright, with no Papierkorb behind seasons.json (SHL-01
   * again, reached through the drag). So the move is computed over `read()`, like every other
   * mutation here.
   *
   * `mode: 'armed'` because the row is not a card: a permanently `draggable` ancestor swallows
   * the text selection inside it and misfires the label's click-to-open (CCL-01, CCL-19).
   */
  const drag = useDragReorder<number>({
    mode: 'armed',
    onReorder: async (fromId, toId) => {
      // `arrayMoveTo` hands back the same array when either `findIndex` came up -1 — a row
      // dropped from the list between the grab and the release, or between a refused write and
      // its retry — and returning it unchanged then rewrites the list to itself rather than
      // renumbering it around a row that is not there.
      await updateDocs((now) =>
        arrayMoveTo(
          now,
          now.findIndex((d) => d.id === fromId),
          now.findIndex((d) => d.id === toId),
        ),
      );
    },
  });

  const save = async (values: Record<string, string | null>) => {
    const label = values.label ?? '';
    // Same field, same rule as LinkList: store a scheme so the row is openable (CCL-09).
    const url = values.url ? normalizeUrl(values.url) : null;
    await updateDocs((now) =>
      editing
        ? now.map((d) => (d.id === editing.id ? { ...d, label, url } : d))
        : [...now, { label, url }], // id-less; the server assigns
    );
  };

  const remove = (doc: LandingDoc) => {
    // Both arms compute from the list as it is when they run, and the undo re-inserts this one
    // document at the index it held. Posting the captured pre-delete array back instead — which
    // is what this did — replayed the whole list six seconds later: a document added in the
    // meantime was destroyed, a second one deleted came back, an edit to a third was reverted,
    // all from one „Rückgängig" click and with nothing to recover any of it from (SHL-01).
    const index = docs.findIndex((d) => d.id === doc.id);
    return del({
      label: `Dokument „${doc.label}“`,
      // `remove` is the redo arm as well, so both of these run long after the click.
      remove: () => updateDocs((now) => now.filter((d) => d.id !== doc.id)),
      restore: () =>
        updateDocs((now) => {
          const next = [...now];
          next.splice(index < 0 ? next.length : Math.min(index, next.length), 0, doc);
          return next;
        }),
    });
  };

  const row = (doc: LandingDoc) => (
    <DocumentRow
      key={doc.id}
      label={doc.label}
      url={doc.url}
      dragging={drag.isDragging(doc.id)}
      dropTarget={drag.isDropTarget(doc.id)}
      // The bare „Zum Verschieben ziehen" — the qualifier LinkList adds names its category rule,
      // and landing documents have no categories and so no `canDrop`.
      handle={<DragHandle className="mt-0.5 text-base" {...drag.handleProps(doc.id)} />}
      actions={
        <>
          <Btn variant="ghost" title="Bearbeiten" onClick={() => setEditing(doc)}>
            <PencilIcon className="h-4 w-4" />
          </Btn>
          <Btn variant="danger" title="Löschen" onClick={() => void remove(doc)}>
            <TrashIcon className="h-4 w-4" />
          </Btn>
        </>
      }
      {...drag.itemProps(doc.id)}
    />
  );

  return (
    <>
      {docs.length === 0 ? (
        <EmptyState>Keine Dokumente hinterlegt.</EmptyState>
      ) : (
        <ul className="space-y-1.5">{docs.map(row)}</ul>
      )}
      {(creating || editing) && (
        <RecordFormModal
          title={editing ? 'Dokument bearbeiten' : 'Neues Dokument'}
          fields={DOC_FIELDS}
          initial={editing ?? undefined}
          onSubmit={save}
          onClose={() => {
            onCloseCreate();
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

/** The builtin Dokumente section, backed by the top-level `landing.documents`. */
export function LandingDocsSection({ landing }: { landing: LandingContent }) {
  const { update } = useLanding();
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <SectionTitle right={<Btn onClick={() => setCreating(true)}>+ Dokument</Btn>}>
        <EditableLabel k="landing.dokumente" />
      </SectionTitle>
      <DocList
        docs={landing.documents}
        creating={creating}
        onCloseCreate={() => setCreating(false)}
        // The lens: where this list lives, plus the „did anything actually move" check. A
        // mutation that hands its own input back — `arrayMoveTo` on a refused drag — writes
        // nothing rather than storing the list as itself.
        updateDocs={async (fn) => {
          await update((cur) => {
            const next = fn(cur.documents);
            return next === cur.documents ? null : { documents: next };
          });
        }}
      />
    </div>
  );
}

/** One custom Textfeld: renameable title, InlineNotes body — the registry twin of a text widget. */
export function LandingTextSection({ section }: { section: LandingSection }) {
  const patchSections = usePatchSections();
  const set = (fields: Partial<LandingSection>) =>
    patchSections((all) => all.map((s) => (s.id === section.id ? { ...s, ...fields } : s)));
  return (
    <div>
      <SectionTitle>
        <EditableText
          value={section.name}
          inputClassName="uppercase"
          onSave={(name) => set({ name })}
        />
      </SectionTitle>
      <Card className="p-5">
        <InlineNotes
          value={section.value}
          placeholder="+ Notiz hinzufügen"
          onSave={(value) => set({ value })}
        />
      </Card>
    </div>
  );
}

/** One custom Dokumente list: renameable title, its own documents inside the section row. */
export function LandingLinksSection({ section }: { section: LandingSection }) {
  const { update } = useLanding();
  const patchSections = usePatchSections();
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <SectionTitle right={<Btn onClick={() => setCreating(true)}>+ Dokument</Btn>}>
        <EditableText
          value={section.name}
          inputClassName="uppercase"
          onSave={(name) =>
            patchSections((all) => all.map((s) => (s.id === section.id ? { ...s, name } : s)))
          }
        />
      </SectionTitle>
      <DocList
        docs={section.documents ?? []}
        creating={creating}
        onCloseCreate={() => setCreating(false)}
        // The same lens one level in: this section's own documents, found by id in the sections
        // array as the server has it.
        updateDocs={async (fn) => {
          await update((cur) => {
            // The section itself can be gone — deleted in another window while this modal stood
            // open. Bail before computing: `?? []` would hand `fn` a *fresh* array, so the
            // identity check below could never fire, and the write went ahead as a `map` that
            // matched nothing. That stored the sections array as itself and bumped the
            // generation for a change nobody made, which can refuse an innocent write in a
            // third window. There is nowhere to put the document either way; this at least
            // stops paying for it.
            const target = cur.sections.find((s) => s.id === section.id);
            if (!target) return null;
            const docs = target.documents ?? [];
            const next = fn(docs);
            if (next === docs) return null;
            return {
              sections: cur.sections.map((s) =>
                s.id === section.id ? { ...s, documents: next } : s,
              ),
            };
          });
        }}
      />
    </div>
  );
}

/**
 * The arranger's 🗑 handler for custom sections. Undoable, and — like the document delete — both
 * arms compute from the sections as they are when they run.
 *
 * The snapshot this replaced overwrote `landing.sections` wholesale, so undoing the removal of
 * one Bereich six seconds later also carried every other one back to its pre-delete state: a note
 * typed into a neighbouring Textfeld, a heading renamed through `EditableText`, a second Bereich
 * deleted on purpose. Registry sections have no `deleted_at` and never appear in „Archiv", so
 * none of that was recoverable (SHL-02).
 *
 * „As they are when they run" used to need an explicit `refresh()` in each arm — `current()`
 * reads a query cache react-query empties five minutes after the landing unmounts, and a miss
 * answers `[]`, which here is not a refusal but the whole registry: the redo arm would `PATCH`
 * `sections: []` and take every other Bereich with it, and the undo arm would post this one back
 * as the only one there is (SHL-02, reached by a different route and with the same absence of a
 * Papierkorb). `update` reads authoritatively itself now, so the arms cannot be written the wrong
 * way round any more.
 *
 * The three `current()` reads below stay, and are a different thing: they capture what is being
 * deleted — the section, its position, its layout entry — at *click* time, from a page that is
 * on screen. That is the pre-delete state by definition, and it is what the undo puts back.
 */
export function useRemoveLandingSection(): (key: string) => void {
  const del = useUndoableDelete();
  const { current, update } = useLanding();
  return (key) => {
    const sections = () => current()?.sections ?? [];
    const layout = () => current()?.layout ?? [];
    const s = sections().find((x) => landingSectionKey(x) === key);
    if (!s) return;
    const index = sections().indexOf(s);
    // The section's layout entry goes with it, in the same request. `display` already filters
    // it out of the rendered list, but nothing ever removed it from the stored array, so
    // `landing.layout` grew by one dead entry per section the user ever created — and because
    // the registry hands out `max(surviving ids) + 1`, the next section reclaims the id and
    // inherits a stale width (SHL-18). Landing keys are all known to one page, so a missing
    // section really is a dead entry; the shared `artist_layout`/`project_layout` cannot tell
    // that apart from another page's widget and must keep theirs.
    const layoutIndex = layout().findIndex((e) => e.key === key);
    const layoutEntry = layout()[layoutIndex];
    void del({
      label: `Bereich „${s.name}“`,
      // Both arms compute from `cur`, never from the captured arrays: `remove` is the redo arm
      // as well, so it runs late too, and both write back what they read.
      remove: () =>
        update((cur) => ({
          sections: cur.sections.filter((x) => x.id !== s.id),
          layout: cur.layout.filter((e) => e.key !== key),
        })),
      restore: () =>
        update((cur) => {
          // `s` carries its id, so the server keeps it and the entry put back below still points
          // at the restored row.
          const next = [...cur.sections];
          next.splice(index < 0 ? next.length : Math.min(index, next.length), 0, s);
          const nextLayout = [...cur.layout];
          if (layoutEntry) {
            nextLayout.splice(Math.min(layoutIndex, nextLayout.length), 0, layoutEntry);
          }
          return { sections: next, layout: nextLayout };
        }),
    });
  };
}

/**
 * The landing's "+ Bereich" picker: the shared shell in flat mode (the landing has no picker
 * groups), with its own persistence — landing sections live in the registry, not in a season's
 * `custom_sections` table, and that split stays (SHL-29). Hidden built-ins arrive
 * already-named because the landing's two label keys are resolved at the call site.
 */
export function AddLandingSectionButton({
  hiddenKeys,
  hiddenNames,
  onRestore,
  onPrepend,
}: {
  hiddenKeys: string[];
  /** Display names for the hidden built-ins (already label-resolved by the caller). */
  hiddenNames: Record<string, string>;
  onRestore: (key: string) => void;
  onPrepend: (key: string) => void;
}) {
  const { update } = useLanding();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Btn variant="subtle" onClick={() => setOpen(true)}>
        + Bereich
      </Btn>
      {open && (
        <SectionPickerModal
          grouped={false}
          builtins={hiddenKeys.map((k) => ({ key: k, name: hiddenNames[k] ?? k }))}
          namePlaceholder={(type) => (type === 'links' ? 'z. B. Verträge' : 'z. B. Kontakte & Adressen')}
          onRestore={onRestore}
          onCreate={async (type, name) => {
            // Appended to the sections as they are now: a section added or deleted since this
            // modal opened — in this window or another one — would otherwise be undone by the
            // act of adding another one.
            const res = await update((cur) => ({
              sections: [...cur.sections, { name, type, value: null }],
            }));
            // The winning response, so this is the section that was actually stored even when
            // the first attempt was refused and re-applied.
            const created = res.sections.reduce((a, b) => (a.id > b.id ? a : b));
            onPrepend(landingSectionKey(created));
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
