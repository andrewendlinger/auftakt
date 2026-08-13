import { useState } from 'react';
import type {
  LandingContent,
  LandingDoc,
  LandingDocInput,
  LandingSection,
  LandingSectionInput,
} from '../api/types';
import { Card, SectionTitle, Btn, DocumentRow, EmptyState } from './ui';
import { SectionPickerModal } from './SectionPickerModal';
import { normalizeUrl } from '../lib/url';
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
 * The landing content as it is *now*, with the cache guaranteed warm first.
 *
 * `current()` alone is only half of „now": react-query empties `['landing']` `gcTime` after the
 * page unmounts — five minutes, the default — and the landing is its only reader, so an undo
 * pressed from another screen reads `undefined`. Every reader here turns that into `?? []` and
 * then *writes* what it read, which is why the miss is not a blank list but a wipe: one
 * „Rückgängig" posts the restored row back as the only one the registry has, and there is no
 * Papierkorb behind seasons.json (SHL-03).
 *
 * So a late closure reads the blob through this, or awaits `refresh()` itself before its own
 * reads — which is what `useRemoveLandingSection` does, having three of them across two slices.
 */
function useReadLanding(): () => Promise<LandingContent | undefined> {
  const { current, refresh } = useLanding();
  return async () => {
    await refresh();
    return current();
  };
}

/**
 * Replace the landing's sections, computed from the list as it is *now*.
 *
 * The `all` prop this replaced was a render snapshot shared by every section on the page, so a
 * write issued from one section — or an undo landing seconds after it was armed — carried the
 * other sections back to how they looked at that render, reverting a rename or a note the user
 * had typed in between (SHL-01, SHL-02).
 */
function usePatchSections() {
  const readLanding = useReadLanding();
  const { patch } = useLanding();
  return async (update: (sections: LandingSection[]) => LandingSectionInput[]) => {
    await patch({ sections: update((await readLanding())?.sections ?? []) });
  };
}

export function LandingNotesSection({ landing }: { landing: LandingContent }) {
  const { patch } = useLanding();
  return (
    <div>
      <SectionTitle>
        <EditableLabel k="landing.notizen" />
      </SectionTitle>
      <Card className="p-5">
        <InlineNotes
          value={landing.notes}
          placeholder="+ Notiz hinzufügen"
          onSave={async (notes) => {
            await patch({ notes });
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
 * live: the builtin Dokumente section patches `landing.documents`, a custom links section
 * patches its own `documents` inside the sections array.
 *
 * `read` is that same location read at *write* time. Every mutation here computes a whole new
 * array, and the `docs` prop is only as fresh as the last render — see `remove`.
 */
function DocList({
  docs,
  read,
  creating,
  onCloseCreate,
  onPatch,
}: {
  docs: LandingDoc[];
  /**
   * The current contents of the list `onPatch` writes to. Async so it can go through
   * `useReadLanding`: the undo arms below run after the landing has unmounted, by which time a
   * plain cache read can answer „no documents" for a list that has three.
   */
  read: () => Promise<LandingDoc[]>;
  /** The "+ Dokument" button lives in the section title — the parent owns this state. */
  creating: boolean;
  onCloseCreate: () => void;
  onPatch: (next: LandingDocInput[]) => Promise<void>;
}) {
  const del = useUndoableDelete();
  const [editing, setEditing] = useState<LandingDoc | null>(null);

  const save = async (values: Record<string, string | null>) => {
    const label = values.label ?? '';
    // Same field, same rule as LinkList: store a scheme so the row is openable (CCL-09).
    const url = values.url ? normalizeUrl(values.url) : null;
    const now = await read();
    if (editing) {
      await onPatch(now.map((d) => (d.id === editing.id ? { ...d, label, url } : d)));
    } else {
      await onPatch([...now, { label, url }]); // id-less; the server assigns
    }
  };

  const remove = (doc: LandingDoc) => {
    // Both arms read the list as it is when they run, and the undo re-inserts this one document
    // at the index it held. Posting the captured pre-delete array back instead — which is what
    // this did — replayed the whole list six seconds later: a document added in the meantime was
    // destroyed, a second one deleted came back, an edit to a third was reverted, all from one
    // „Rückgängig" click and with nothing to recover any of it from (SHL-01).
    const index = docs.findIndex((d) => d.id === doc.id);
    return del({
      label: `Dokument „${doc.label}“`,
      // `remove` is the redo arm as well, so both of these run long after the click.
      remove: async () => onPatch((await read()).filter((d) => d.id !== doc.id)),
      restore: async () => {
        const next = [...(await read())];
        next.splice(index < 0 ? next.length : Math.min(index, next.length), 0, doc);
        return onPatch(next);
      },
    });
  };

  const row = (doc: LandingDoc) => (
    <DocumentRow
      key={doc.id}
      label={doc.label}
      url={doc.url}
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
  const readLanding = useReadLanding();
  const { patch } = useLanding();
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <SectionTitle right={<Btn onClick={() => setCreating(true)}>+ Dokument</Btn>}>
        <EditableLabel k="landing.dokumente" />
      </SectionTitle>
      <DocList
        docs={landing.documents}
        read={async () => (await readLanding())?.documents ?? []}
        creating={creating}
        onCloseCreate={() => setCreating(false)}
        onPatch={async (documents) => {
          await patch({ documents });
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
  const readLanding = useReadLanding();
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
        read={async () =>
          (await readLanding())?.sections.find((s) => s.id === section.id)?.documents ?? []
        }
        creating={creating}
        onCloseCreate={() => setCreating(false)}
        onPatch={(documents) =>
          patchSections((all) => all.map((s) => (s.id === section.id ? { ...s, documents } : s)))
        }
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
 * „As they are when they run" needs `refresh()` to be true, though — `current()` reads a query
 * cache react-query empties five minutes after the landing unmounts, and a miss answers `[]`,
 * which here is not a refusal but the whole registry: the redo arm would `PATCH` `sections: []`
 * and take every other Bereich with it, and the undo arm would post this one back as the only
 * one there is. Still SHL-02, reached by a different route and with the same absence of a
 * Papierkorb behind it.
 */
export function useRemoveLandingSection(): (key: string) => void {
  const del = useUndoableDelete();
  const { current, refresh, patch } = useLanding();
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
      // Both arms refresh first: `remove` is the redo arm as well, so it runs late too.
      remove: async () => {
        await refresh();
        return patch({
          sections: sections().filter((x) => x.id !== s.id),
          layout: layout().filter((e) => e.key !== key),
        });
      },
      restore: async () => {
        await refresh();
        // `s` carries its id, so the server keeps it and the entry put back below still points
        // at the restored row.
        const next = [...sections()];
        next.splice(index < 0 ? next.length : Math.min(index, next.length), 0, s);
        const nextLayout = [...layout()];
        if (layoutEntry) {
          nextLayout.splice(Math.min(layoutIndex, nextLayout.length), 0, layoutEntry);
        }
        return patch({ sections: next, layout: nextLayout });
      },
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
  const { current, patch } = useLanding();
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
            // modal opened would otherwise be undone by the act of adding another one.
            const res = await patch({
              sections: [...(current()?.sections ?? []), { name, type, value: null }],
            });
            const created = res.sections.reduce((a, b) => (a.id > b.id ? a : b));
            onPrepend(landingSectionKey(created));
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
