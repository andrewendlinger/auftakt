import { useState } from 'react';
import { api } from '../api/client';
import type {
  LandingContent,
  LandingDoc,
  LandingDocInput,
  LandingSection,
  LandingSectionInput,
} from '../api/types';
import { Card, SectionTitle, Btn, EmptyState } from './ui';
import { Modal, Label, TextInput, RecordFormModal, type FieldDef } from './fields';
import { EditableLabel } from './EditableLabel';
import { EditableText } from './EditableText';
import { InlineNotes } from './InlineNotes';
import { TrashIcon } from './icons';
import { openExternal } from '../lib/external';
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
 * Replace the landing's sections, computed from the list as it is *now*.
 *
 * The `all` prop this replaced was a render snapshot shared by every section on the page, so a
 * write issued from one section — or an undo landing seconds after it was armed — carried the
 * other sections back to how they looked at that render, reverting a rename or a note the user
 * had typed in between (SHL-01, SHL-02).
 */
function usePatchSections() {
  const { current, patch } = useLanding();
  return async (update: (sections: LandingSection[]) => LandingSectionInput[]) => {
    await patch({ sections: update(current()?.sections ?? []) });
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
  /** The current contents of the list `onPatch` writes to. */
  read: () => LandingDoc[];
  /** The "+ Dokument" button lives in the section title — the parent owns this state. */
  creating: boolean;
  onCloseCreate: () => void;
  onPatch: (next: LandingDocInput[]) => Promise<void>;
}) {
  const del = useUndoableDelete();
  const [editing, setEditing] = useState<LandingDoc | null>(null);

  const save = async (values: Record<string, string | null>) => {
    const label = values.label ?? '';
    const url = values.url ?? null;
    const now = read();
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
      remove: () => onPatch(read().filter((d) => d.id !== doc.id)),
      restore: () => {
        const next = [...read()];
        next.splice(index < 0 ? next.length : Math.min(index, next.length), 0, doc);
        return onPatch(next);
      },
    });
  };

  const row = (doc: LandingDoc) => (
    <li
      key={doc.id}
      className="group flex items-center gap-3 rounded-xl bg-white px-3 py-2 shadow-sm ring-1 ring-black/5"
    >
      <span className="text-neutral-400">🔗</span>
      <div className="min-w-0 flex-1">
        {doc.url ? (
          <button
            className="text-left font-medium text-sky-700 hover:underline"
            onClick={() => openExternal(doc.url!)}
          >
            {doc.label}
          </button>
        ) : (
          <span className="font-medium text-neutral-700">
            {doc.label} <span className="text-xs font-normal text-neutral-400">(kein Link hinterlegt)</span>
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
        <Btn variant="ghost" title="Bearbeiten" onClick={() => setEditing(doc)}>
          ✎
        </Btn>
        <Btn variant="danger" title="Löschen" onClick={() => void remove(doc)}>
          <TrashIcon className="h-4 w-4" />
        </Btn>
      </div>
    </li>
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
  const { current, patch } = useLanding();
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <SectionTitle right={<Btn onClick={() => setCreating(true)}>+ Dokument</Btn>}>
        <EditableLabel k="landing.dokumente" />
      </SectionTitle>
      <DocList
        docs={landing.documents}
        read={() => current()?.documents ?? []}
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
  const { current } = useLanding();
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
        read={() => current()?.sections.find((s) => s.id === section.id)?.documents ?? []}
        creating={creating}
        onCloseCreate={() => setCreating(false)}
        onPatch={(documents) =>
          patchSections((all) => all.map((s) => (s.id === section.id ? { ...s, documents } : s)))
        }
      />
    </div>
  );
}

/** The arranger's 🗑 handler for custom sections: snapshot-undo, like landing documents. */
export function useRemoveLandingSection(landing: LandingContent | undefined): (key: string) => void {
  const del = useUndoableDelete();
  return (key) => {
    const before = landing?.sections ?? [];
    const s = before.find((x) => landingSectionKey(x) === key);
    if (!s) return;
    void del({
      label: `Bereich „${s.name}“`,
      remove: () => api.landing.patch({ sections: before.filter((x) => x.id !== s.id) }),
      restore: () => api.landing.patch({ sections: before }),
    });
  };
}

const CUSTOM_TYPES: Array<{ type: LandingSection['type']; label: string }> = [
  { type: 'text', label: 'Textfeld' },
  { type: 'links', label: 'Dokumente & Links' },
];

/**
 * The landing's "+ Bereich" picker. Modeled on CustomSections' AddSectionModal but not
 * reusing it — that one creates per-season `custom_sections` rows, while landing
 * sections live in the registry. Offers the two custom types plus the hidden
 * built-ins to restore.
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
  const [chosen, setChosen] = useState<LandingSection['type'] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => {
    setOpen(false);
    setChosen(null);
    setName('');
  };

  const create = async () => {
    if (!name.trim() || !chosen || busy) return;
    setBusy(true);
    try {
      // Appended to the sections as they are now: a section added or deleted since this modal
      // opened would otherwise be undone by the act of adding another one.
      const res = await patch({
        sections: [...(current()?.sections ?? []), { name: name.trim(), type: chosen, value: null }],
      });
      const created = res.sections.reduce((a, b) => (a.id > b.id ? a : b));
      onPrepend(landingSectionKey(created));
      close();
    } finally {
      setBusy(false);
    }
  };

  const rowCls = (selected: boolean) =>
    `w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
      selected ? 'border-neutral-500 bg-neutral-50' : 'border-neutral-200 hover:bg-neutral-50'
    }`;

  return (
    <>
      <Btn variant="subtle" onClick={() => setOpen(true)}>
        + Bereich
      </Btn>
      {open && (
        <Modal
          title="Bereich hinzufügen"
          onClose={close}
          footer={
            chosen && (
              <>
                <Btn onClick={close}>Abbrechen</Btn>
                <Btn variant="primary" onClick={create} disabled={!name.trim() || busy}>
                  Hinzufügen
                </Btn>
              </>
            )
          }
        >
          <div className="space-y-4">
            <div className="space-y-1.5">
              {CUSTOM_TYPES.map((t) => (
                <button key={t.type} className={rowCls(chosen === t.type)} onClick={() => setChosen(t.type)}>
                  {t.label}
                  <span className="ml-2 text-xs text-neutral-400">neu, mit eigenem Namen</span>
                </button>
              ))}
              {hiddenKeys.map((k) => (
                <button
                  key={k}
                  className={rowCls(false)}
                  onClick={() => {
                    onRestore(k);
                    close();
                  }}
                >
                  {hiddenNames[k] ?? k}
                </button>
              ))}
            </div>
            {chosen && (
              <div>
                <Label>Name</Label>
                <TextInput
                  autoFocus
                  value={name}
                  placeholder={chosen === 'links' ? 'z. B. Verträge' : 'z. B. Kontakte & Adressen'}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void create();
                  }}
                />
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
