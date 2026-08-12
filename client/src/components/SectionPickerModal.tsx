import { useState } from 'react';
import { Btn, PickerRow } from './ui';
import { Label, Modal, TextInput } from './fields';
import { SECTION_TYPES, type SectionGroup, type SectionType } from '../lib/sections';
import { useErrorToast } from '../hooks';

/** One hidden built-in on offer, its display name already resolved by the caller. */
export interface PickerBuiltinRow {
  key: string;
  name: string;
  group?: SectionGroup;
}

/**
 * The „Bereich hinzufügen" modal both pickers share: the two custom section types (needing a
 * name) plus the hidden built-ins to restore. Presentation only — persistence stays with the
 * callers, because that is the line SHL-29 drew and it still holds: `AddSectionModal` creates a
 * per-season `custom_sections` row, `AddLandingSectionButton` a cross-season registry section.
 * What SHL-29 left duplicated was the modal itself, and the two copies had already begun to
 * drift (grouping, placeholders); WP-46 shares the shell and keeps the persistence split.
 *
 * `grouped` is the entity pages' layout („Eingabe"/„Einblicke" headings, groups from the
 * page's section specs); the landing has no groups and renders one flat list.
 */
export function SectionPickerModal({
  builtins,
  grouped,
  namePlaceholder = () => 'z. B. Reiseplanung',
  onRestore,
  onCreate,
  onClose,
}: {
  builtins: PickerBuiltinRow[];
  grouped: boolean;
  namePlaceholder?: (type: SectionType) => string;
  onRestore: (key: string) => void;
  /** Persist the new section and place it in the layout; the shell closes when this resolves. */
  onCreate: (type: SectionType, name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<SectionType | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const report = useErrorToast();

  /**
   * The report lives here rather than in either `onCreate`, because neither of them guards:
   * `api.customSections.create` is unwrapped, and `useLanding.patch` throws by design (its
   * callers own the catch). Both rejections used to land nowhere at all — from the button they
   * were an unhandled promise, from Enter a `void`-ed one — so a failed „Hinzufügen" left the
   * modal sitting there unchanged with no message, and in the packaged app there is no console
   * to find the reason in. Staying open with the typed name intact is the point: the retry is
   * pressing the button again.
   */
  const create = async () => {
    if (!name.trim() || !chosen || busy) return;
    setBusy(true);
    try {
      await onCreate(chosen, name.trim());
      onClose();
    } catch (err) {
      report(err, 'Der Bereich konnte nicht angelegt werden.');
    } finally {
      setBusy(false);
    }
  };

  const typeRows = SECTION_TYPES.map((t) => (
    <PickerRow key={t.type} selected={chosen === t.type} onClick={() => setChosen(t.type)}>
      {t.label}
      <span className="ml-2 text-xs text-neutral-400">neu, mit eigenem Namen</span>
    </PickerRow>
  ));

  const restoreRow = (b: PickerBuiltinRow) => (
    <PickerRow
      key={b.key}
      onClick={() => {
        onRestore(b.key);
        onClose();
      }}
    >
      {b.name}
    </PickerRow>
  );

  const groupHeading = 'mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400';
  const einblicke = builtins.filter((b) => b.group === 'einblicke');

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
        {grouped ? (
          <>
            <div>
              <div className={groupHeading}>Eingabe</div>
              <div className="space-y-1.5">
                {typeRows}
                {builtins.filter((b) => b.group === 'eingabe').map(restoreRow)}
              </div>
            </div>
            {einblicke.length > 0 && (
              <div>
                <div className={groupHeading}>Einblicke</div>
                <div className="space-y-1.5">{einblicke.map(restoreRow)}</div>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-1.5">
            {typeRows}
            {builtins.map(restoreRow)}
          </div>
        )}
        {chosen && (
          <div>
            <Label>Name</Label>
            <TextInput
              autoFocus
              value={name}
              placeholder={namePlaceholder(chosen)}
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
