import { useState } from 'react';
import { Modal, Select } from './fields';
import { Btn } from './ui';
import { countWithNoun, type UsageNoun } from './OptionsEditor';
import type { CustomColumnOption } from '../api/types';

/** One category about to disappear, with how many rows still carry it. */
export interface OptionRemoval {
  option: CustomColumnOption;
  count: number;
}

/**
 * Confirms the deletion of categories that are still in use, and asks where their rows should
 * go. Shared by the task-column editor and the Kategorien settings tab so both call sites of
 * `OptionsEditor` behave the same — the guard used to exist on one of them only, and the other
 * dropped referenced categories silently (TTU-34, RTE-06).
 *
 * Deleting the category is the destructive half; the reassignment is what keeps it recoverable
 * in the only sense that matters here, since the rows themselves are never touched by an undo.
 * The caller applies the mapping *after* the option list is saved, so the server reads the new
 * options when it derives anything from them (notably `erledigt_am` for the Status column).
 */
export function OptionRemovalDialog({
  removals,
  targets,
  noun,
  busy = false,
  onCancel,
  onConfirm,
}: {
  removals: OptionRemoval[];
  /** The categories that survive the save — the possible destinations. Never empty. */
  targets: CustomColumnOption[];
  noun: UsageNoun;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (mapping: Array<{ from: string; to: string }>) => void;
}) {
  const fallback = targets[0]?.value ?? '';
  const [to, setTo] = useState<Record<string, string>>(() =>
    Object.fromEntries(removals.map((r) => [r.option.value, fallback])),
  );

  const confirm = () =>
    onConfirm(removals.map((r) => ({ from: r.option.value, to: to[r.option.value] ?? fallback })));

  const many = removals.length > 1;
  return (
    <Modal
      title={many ? 'Kategorien löschen' : `Kategorie „${removals[0]?.option.label}“ löschen`}
      onClose={onCancel}
      footer={
        <>
          <Btn onClick={onCancel}>Abbrechen</Btn>
          <Btn variant="danger" onClick={confirm} disabled={busy}>
            Verschieben & löschen
          </Btn>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-neutral-600">
          {many
            ? 'Diese Kategorien werden noch verwendet. Lege fest, wohin die Einträge verschoben werden.'
            : 'Diese Kategorie wird noch verwendet. Lege fest, wohin die Einträge verschoben werden.'}
        </p>
        {removals.map((r) => (
          <div key={r.option.value} className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm text-neutral-700">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: r.option.color }} />
              <span className="font-medium">„{r.option.label}“</span>
              <span className="text-neutral-500">
                wird von {countWithNoun(r.count, noun)} verwendet
              </span>
            </div>
            <Select
              value={to[r.option.value] ?? fallback}
              onChange={(e) => setTo((prev) => ({ ...prev, [r.option.value]: e.target.value }))}
            >
              {targets.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>
        ))}
      </div>
    </Modal>
  );
}
