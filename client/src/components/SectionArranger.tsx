import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { LayoutEntry } from '../api/types';
import { arrayMoveTo } from '../lib/arrays';
import { useDragReorder } from '../lib/dragReorder';
import { Btn } from './ui';
import { Modal } from './fields';
import { TrashIcon } from './icons';
import type { LabelKey } from '../lib/labels';
import { useInvalidateAll, useLabel, useSettings } from '../hooks';

type LayoutKey = 'artist_layout' | 'project_layout' | 'dashboard_layout';

/**
 * Renders a page's sections in a user-defined layout (order + per-section width),
 * persisted in a settings array of {key,width}. A "Bereiche anordnen" toggle reveals
 * a drag handle (native HTML5 drag-and-drop reorder), ▲/▼ move buttons as a keyboard
 * fallback, and a full/half width toggle. Half-width sections flow into a 2-column grid,
 * so two adjacent halves sit side by side. Unknown/new section keys are appended as full;
 * legacy string[] layouts are read as all-full. Shared by the dashboard, artist and
 * project pages.
 *
 * One stored layout serves *many* pages: `artist_layout` is shared by every artist page,
 * but per-entity widget sections (`cs<id>`, WP-S) exist only on their own page. The layout
 * therefore keeps two views — `full` (every stored entry, foreign keys kept in place, this
 * page's new keys appended) and `display` (`full` filtered to this page's sections). All
 * mutations operate on and persist `full`; rendering uses `display`. Persisting the
 * filtered view instead would silently drop the other pages' widget entries on every
 * arrange action.
 *
 * Sections are optional unless listed in `mandatoryKeys`: edit mode offers a 🗑 that hides a
 * built-in (`hidden: true` on its entry) or soft-deletes a custom widget (`onRemoveCustom`).
 * Hidden sections are simply not rendered — re-adding goes through the "+ Bereich" picker,
 * which `addAction` receives the hidden keys and a restore callback for.
 */
export function SectionArranger({
  layoutKey,
  layout: layoutProp,
  onPersist,
  sections,
  labelKeys,
  titles = {},
  mandatoryKeys,
  defaultHidden = [],
  fullWidthKeys = [],
  nonEmptyKeys = [],
  toolbarAfterKey,
  onRemoveCustom,
  addAction,
}: {
  /** Settings key holding the layout — the default persistence. Omit when `layout` + `onPersist` are given. */
  layoutKey?: LayoutKey;
  /** Stored entries when the page persists elsewhere (the landing: seasons.json via /api/landing). */
  layout?: LayoutEntry[];
  /** Write-back override, paired with `layout`. */
  onPersist?: (next: LayoutEntry[]) => Promise<void>;
  sections: Record<string, ReactNode>;
  /**
   * Section key → the heading id it is named by, so the strip below shows whatever the user
   * renamed that section's heading to. Stated explicitly rather than derived from
   * `layoutKey`: the project page's `kontakte` section holds two headings, and this picks
   * which of them names the section. Also the built-in/custom discriminator: a key without
   * a LabelKey is a custom widget.
   */
  labelKeys: Record<string, LabelKey>;
  /** Names for sections without a LabelKey — the custom widgets, titled by their own name. */
  titles?: Record<string, string>;
  /** Never removable (no 🗑); a stale stored `hidden` on one of these is ignored on read. */
  mandatoryKeys: string[];
  /** Built-in keys that start hidden: appended as hidden when absent from the stored layout. */
  defaultHidden?: string[];
  /** Sections that can't be set to half width (always full, no width toggle) — e.g. the task table. */
  fullWidthKeys?: string[];
  /** Sections that still hold content — their 🗑 is disabled so filled data can't vanish. */
  nonEmptyKeys?: string[];
  /** Render the toolbar row *after* this section instead of above everything (the dashboard's Künstler grid). */
  toolbarAfterKey?: string;
  /** 🗑 on a custom widget's strip — the page soft-deletes the row (undoable). */
  onRemoveCustom?: (key: string) => void;
  /** The "+ Bereich" button, rendered only in edit mode, fed the hidden built-ins to offer. */
  addAction?: (ctx: {
    hiddenKeys: string[];
    restore: (key: string) => void;
    prepend: (key: string) => void;
  }) => ReactNode;
}) {
  if (!layoutKey && !onPersist) throw new Error('SectionArranger needs layoutKey or layout+onPersist');
  const { data: settings } = useSettings();
  const label = useLabel();
  const invalidate = useInvalidateAll();
  const [arranging, setArranging] = useState(false);
  // 🗑 on a *filled* section opens a dialog first: built-ins get a "must be emptied"
  // explanation, custom widgets a confirm that their content moves to the trash with them.
  const [removing, setRemoving] = useState<string | null>(null);

  // `sections` (fresh ReactNodes) and an inline `fullWidthKeys` literal change identity
  // every render, but the layout only depends on their string content — key the memo on
  // stable signatures so it recomputes only when the keys/widths actually change.
  const sectionSig = Object.keys(sections).join('\u0000');
  const fullWidthSig = fullWidthKeys.join('\u0000');

  const mandatorySig = mandatoryKeys.join(' ');
  const defaultHiddenSig = defaultHidden.join(' ');

  const raw = layoutProp !== undefined ? layoutProp : layoutKey ? settings?.[layoutKey] : undefined;

  const { full, display, hiddenKeys } = useMemo(() => {
    const known = Object.keys(sections);
    const stored: LayoutEntry[] = Array.isArray(raw)
      ? (raw as unknown[]).map((item) => {
          if (typeof item === 'string') return { key: item, width: 'full' as const };
          const e = item as LayoutEntry;
          const key = String(e.key);
          return {
            key,
            width: e.width === 'half' ? ('half' as const) : ('full' as const),
            // `hidden` only ever applies to built-ins (keys with a LabelKey): custom widgets
            // are soft-deleted rows, and a mandatory section must never disappear even if a
            // stale entry claims so — both self-heal here on read.
            ...(e.hidden === true && key in labelKeys && !mandatoryKeys.includes(key)
              ? { hidden: true }
              : {}),
          };
        })
      : [];
    const seen = new Set<string>();
    const full: LayoutEntry[] = [];
    for (const e of stored) {
      if (!seen.has(e.key)) {
        seen.add(e.key);
        full.push(e);
      }
    }
    for (const k of known) {
      if (!seen.has(k)) {
        full.push({ key: k, width: 'full', ...(defaultHidden.includes(k) ? { hidden: true } : {}) });
      }
    }
    const display = full
      .filter((e) => known.includes(e.key) && !e.hidden)
      .map((e) => (fullWidthKeys.includes(e.key) ? { key: e.key, width: 'full' as const } : e));
    const hiddenKeys = full.filter((e) => known.includes(e.key) && e.hidden).map((e) => e.key);
    return { full, display, hiddenKeys };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the *Sig strings capture the only content used
  }, [sectionSig, raw, fullWidthSig, mandatorySig, defaultHiddenSig]);

  const persist = async (next: LayoutEntry[]) => {
    if (onPersist) {
      await onPersist(next);
      return;
    }
    await api.patchSettings({ [layoutKey!]: next });
    await invalidate();
  };

  const idxInFull = (key: string) => full.findIndex((e) => e.key === key);

  const move = (key: string, dir: -1 | 1) => {
    // The neighbour comes from the *visible* list, the move happens in the full one —
    // so a section steps over the adjacent visible section, not over an invisible
    // foreign widget entry that happens to sit between them in the stored layout.
    const i = display.findIndex((e) => e.key === key);
    const neighbour = display[i + dir];
    if (!neighbour) return;
    const next = arrayMoveTo(full, idxInFull(key), idxInFull(neighbour.key));
    if (next !== full) void persist(next);
  };

  const toggleWidth = (key: string) => {
    if (fullWidthKeys.includes(key)) return;
    const next = full.map((e) =>
      e.key === key ? { ...e, width: e.width === 'half' ? ('full' as const) : ('half' as const) } : e,
    );
    void persist(next);
  };

  /** Remove a built-in section: it stays in the layout, flagged hidden, re-addable via the picker. */
  const hide = (key: string) => {
    void persist(full.map((e) => (e.key === key ? { ...e, hidden: true } : e)));
  };

  /** Re-add a hidden built-in at its remembered position and width. */
  const restore = (key: string) => {
    void persist(
      full.map((e) => {
        if (e.key !== key) return e;
        const { hidden, ...rest } = e;
        void hidden;
        return rest;
      }),
    );
  };

  /**
   * Put a just-created custom widget at the top — new Bereiche always start there. "Top"
   * means the start of the editable zone: right below `toolbarAfterKey` when the toolbar
   * sits inside the grid (the dashboard's Künstler grid stays first), else position 0.
   */
  const prepend = (key: string) => {
    const entry: LayoutEntry = { key, width: 'full' };
    const anchor = toolbarAfterKey != null ? full.findIndex((e) => e.key === toolbarAfterKey) : -1;
    const next = [...full];
    next.splice(anchor + 1, 0, entry);
    void persist(next);
  };

  const drag = useDragReorder<string>({
    enabled: arranging,
    onReorder: (fromKey, toKey) => {
      const next = arrayMoveTo(full, idxInFull(fromKey), idxInFull(toKey));
      // Hand the promise back rather than `void`-ing it: the hook awaits it and toasts a
      // rejection, so a layout that failed to save no longer just snaps back silently (CCL-13).
      if (next !== full) return persist(next);
    },
  });

  const toolbar = (
    <div className="flex items-center justify-end gap-2">
      {arranging && addAction?.({ hiddenKeys, restore, prepend })}
      <Btn variant="subtle" onClick={() => setArranging((a) => !a)}>
        {arranging ? '✓ Fertig' : '✎ Bereiche bearbeiten'}
      </Btn>
    </div>
  );
  // The toolbar can sit inside the grid after a named section (the dashboard puts it below
  // the Künstler grid — you can't edit that anyway); everywhere else it tops the block.
  const toolbarInGrid = toolbarAfterKey != null && display.some((e) => e.key === toolbarAfterKey);

  return (
    <>
      {!toolbarInGrid && toolbar}
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
        {display.map((entry, i) => {
          const key = entry.key;
          const canHalf = !fullWidthKeys.includes(key);
          // `[&_.section-title]:hidden`: the strip already names the section — hiding the
          // in-card heading (incl. its action buttons) avoids the double title in edit mode.
          const arrangeCls = arranging
            ? `select-none rounded-2xl p-3 ring-2 ring-dashed [&_.section-title]:hidden ${
                drag.isDropTarget(key) ? 'ring-neutral-600' : 'ring-neutral-300'
              } ${drag.isDragging(key) ? 'opacity-40' : ''}`
            : '';
          return (
            <Fragment key={key}>
            <div
              data-section={key}
              data-width={entry.width}
              className={`${entry.width === 'full' ? 'sm:col-span-2' : ''} ${arrangeCls}`}
              {...drag.itemProps(key)}
            >
              {arranging && (
                <div className="mb-3 flex items-center justify-between rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  <span className="flex items-center gap-2">
                    <span className="cursor-grab text-base leading-none text-neutral-400" title="Zum Verschieben ziehen">
                      ⠿
                    </span>
                    {labelKeys[key] ? label(labelKeys[key]) : (titles[key] ?? key)}
                  </span>
                  <span className="flex items-center gap-1">
                    {canHalf && (
                      <button
                        className="rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 hover:bg-neutral-200"
                        title="Breite umschalten"
                        onClick={() => toggleWidth(key)}
                      >
                        {entry.width === 'half' ? '▭ Volle Breite' : '◧ Halbe Breite'}
                      </button>
                    )}
                    <button
                      className="rounded px-2 py-0.5 text-lg leading-none text-neutral-500 hover:bg-neutral-200 disabled:opacity-30"
                      disabled={i === 0}
                      aria-label="nach oben"
                      onClick={() => move(key, -1)}
                    >
                      ▲
                    </button>
                    <button
                      className="rounded px-2 py-0.5 text-lg leading-none text-neutral-500 hover:bg-neutral-200 disabled:opacity-30"
                      disabled={i === display.length - 1}
                      aria-label="nach unten"
                      onClick={() => move(key, 1)}
                    >
                      ▼
                    </button>
                    {!mandatoryKeys.includes(key) && (
                      <button
                        className="rounded px-2 py-1 text-neutral-500 hover:bg-neutral-200 hover:text-red-600"
                        title="Bereich entfernen"
                        // Empty sections go right away: built-ins (they have a LabelKey) are
                        // hidden and re-addable via the picker; custom widgets are soft-deleted
                        // by the page (undo toast). Filled ones get an explaining dialog first.
                        onClick={() => {
                          if (nonEmptyKeys.includes(key)) setRemoving(key);
                          else if (key in labelKeys) hide(key);
                          else onRemoveCustom?.(key);
                        }}
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                </div>
              )}
              {sections[key]}
            </div>
            {toolbarInGrid && key === toolbarAfterKey && <div className="sm:col-span-2">{toolbar}</div>}
            </Fragment>
          );
        })}
      </div>
      {removing != null &&
        (removing in labelKeys ? (
          // Built-in with rows: hiding it would make real data invisible — explain, no action.
          <Modal
            title="Bereich ist nicht leer"
            onClose={() => setRemoving(null)}
            footer={
              <Btn variant="primary" onClick={() => setRemoving(null)}>
                Verstanden
              </Btn>
            }
          >
            <p className="text-sm text-neutral-600">
              „{label(labelKeys[removing]!)}“ enthält noch Einträge und kann erst ausgeblendet
              werden, wenn er leer ist. Bitte zuerst die Inhalte löschen oder verschieben.
            </p>
          </Modal>
        ) : (
          // Custom widget: its content belongs to it and moves into the trash along with it.
          <Modal
            title="Bereich löschen"
            onClose={() => setRemoving(null)}
            footer={
              <>
                <Btn onClick={() => setRemoving(null)}>Abbrechen</Btn>
                <Btn
                  variant="danger"
                  onClick={() => {
                    onRemoveCustom?.(removing);
                    setRemoving(null);
                  }}
                >
                  In den Papierkorb
                </Btn>
              </>
            }
          >
            <p className="text-sm text-neutral-600">
              „{titles[removing] ?? removing}“ samt Inhalt in den Papierkorb verschieben? Du
              kannst den Bereich im Archiv wiederherstellen.
            </p>
          </Modal>
        ))}
    </>
  );
}
