import { useState } from 'react';
import { api } from '../api/client';
import type { LandingContent, LandingDoc, LandingDocInput, LandingSection, LandingSectionInput } from '../api/types';
import { Card, SectionTitle, Btn, EmptyState } from './ui';
import { Modal, Label, TextInput, RecordFormModal, type FieldDef } from './fields';
import { EditableLabel } from './EditableLabel';
import { EditableText } from './EditableText';
import { InlineNotes } from './InlineNotes';
import { TrashIcon } from './icons';
import { openExternal } from '../lib/external';
import { useInvalidateAll, useUndoableDelete } from '../hooks';

/**
 * The landing page's content sections below the season grid. Everything here is
 * cross-season — stored in the seasons.json registry, not in any season DB — so it
 * stays put when the active season changes. Custom Textfelder are registry rows
 * (`landing.sections`), not `custom_sections` rows, for the same reason; their layout
 * keys are `lt<id>`.
 */

export const landingSectionKey = (s: LandingSection): string => `lt${s.id}`;

function usePatchSections() {
  const invalidate = useInvalidateAll();
  return async (sections: LandingSectionInput[]) => {
    await api.landing.patch({ sections });
    await invalidate();
  };
}

export function LandingNotesSection({ landing }: { landing: LandingContent }) {
  const invalidate = useInvalidateAll();
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
            await api.landing.patch({ notes });
            await invalidate();
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

export function LandingDocsSection({ landing }: { landing: LandingContent }) {
  const invalidate = useInvalidateAll();
  const del = useUndoableDelete();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<LandingDoc | null>(null);
  const docs = landing.documents;

  const patchDocs = async (documents: LandingDocInput[]) => {
    await api.landing.patch({ documents });
    await invalidate();
  };

  const save = async (values: Record<string, string | null>) => {
    const label = values.label ?? '';
    const url = values.url ?? null;
    if (editing) {
      await patchDocs(docs.map((d) => (d.id === editing.id ? { ...d, label, url } : d)));
    } else {
      await patchDocs([...docs, { label, url }]); // id-less; the server assigns
    }
  };

  const remove = (doc: LandingDoc) => {
    // Restore posts the pre-delete snapshot back verbatim — id and position intact.
    const before = docs;
    return del({
      label: `Dokument „${doc.label}“`,
      remove: () => api.landing.patch({ documents: before.filter((d) => d.id !== doc.id) }),
      restore: () => api.landing.patch({ documents: before }),
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
    <div>
      <SectionTitle right={<Btn onClick={() => setCreating(true)}>+ Dokument</Btn>}>
        <EditableLabel k="landing.dokumente" />
      </SectionTitle>
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
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/** One custom Textfeld: renameable title, InlineNotes body — the registry twin of a text widget. */
export function LandingTextSection({ section, all }: { section: LandingSection; all: LandingSection[] }) {
  const patchSections = usePatchSections();
  return (
    <div>
      <SectionTitle>
        <EditableText
          value={section.name}
          inputClassName="uppercase"
          onSave={(name) => patchSections(all.map((s) => (s.id === section.id ? { ...s, name } : s)))}
        />
      </SectionTitle>
      <Card className="p-5">
        <InlineNotes
          value={section.value}
          placeholder="+ Notiz hinzufügen"
          onSave={(value) => patchSections(all.map((s) => (s.id === section.id ? { ...s, value } : s)))}
        />
      </Card>
    </div>
  );
}

/** The arranger's 🗑 handler for Textfelder: snapshot-undo, like landing documents. */
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

/**
 * The landing's "+ Bereich" picker. Modeled on CustomSections' AddSectionModal but not
 * reusing it — that one creates per-season `custom_sections` rows, while landing
 * Textfelder live in the registry. Offers one custom type (Textfeld) plus the hidden
 * built-ins to restore.
 */
export function AddLandingSectionButton({
  landing,
  hiddenKeys,
  hiddenNames,
  onRestore,
  onPrepend,
}: {
  landing: LandingContent;
  hiddenKeys: string[];
  /** Display names for the hidden built-ins (already label-resolved by the caller). */
  hiddenNames: Record<string, string>;
  onRestore: (key: string) => void;
  onPrepend: (key: string) => void;
}) {
  const invalidate = useInvalidateAll();
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => {
    setOpen(false);
    setNaming(false);
    setName('');
  };

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const res = await api.landing.patch({
        sections: [...landing.sections, { name: name.trim(), value: null }],
      });
      const created = res.sections.reduce((a, b) => (a.id > b.id ? a : b));
      await invalidate();
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
            naming && (
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
              <button className={rowCls(naming)} onClick={() => setNaming(true)}>
                Textfeld
                <span className="ml-2 text-xs text-neutral-400">neu, mit eigenem Namen</span>
              </button>
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
            {naming && (
              <div>
                <Label>Name</Label>
                <TextInput
                  autoFocus
                  value={name}
                  placeholder="z. B. Kontakte & Adressen"
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
