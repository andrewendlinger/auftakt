import { Fragment, useCallback, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Artist, LayoutEntry, Project } from '../api/types';
import { arrayMoveTo } from '../lib/arrays';
import { useDragReorder } from '../lib/dragReorder';
import { useAnchoredPopover } from '../lib/popover';
import { Btn, DragHandle } from './ui';
import { Modal } from './fields';
import { TrashIcon } from './icons';
import { useToast } from './Toast';
import type { LabelKey } from '../lib/labels';
import { useGuardedAction, useInvalidateAll, useLabel, useSettingsArray } from '../hooks';

export type LayoutKey = 'artist_layout' | 'project_layout' | 'dashboard_layout';

/**
 * Shape-normalise a stored layout: legacy `string[]` layouts read as all-full entries, and a
 * hand-edited or foreign value that is not an array reads as "no layout" rather than throwing
 * mid-render (PGS-15). Module-level because `useSettingsArray` takes it as a memo dep.
 *
 * Only the shape. The page-dependent half — the `hidden` self-heal, this page's own new keys,
 * which entries are visible here — stays in the component, which is where the props are.
 */
export function parseLayoutEntries(raw: unknown): LayoutEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: LayoutEntry[] = [];
  for (const item of raw as unknown[]) {
    if (typeof item === 'string') {
      if (item) out.push({ key: item, width: 'full' });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const e = item as LayoutEntry;
    const key = String(e.key ?? '');
    if (!key) continue;
    out.push({
      key,
      width: e.width === 'half' ? 'half' : 'full',
      ...(e.hidden === true ? { hidden: true } : {}),
    });
  }
  return out;
}

/**
 * The same for an entity's `layout` column, which arrives as JSON *text*: the crud factory has no
 * read transform, so a JSON-in-TEXT column reaches the client unparsed (as `tasks.custom_values`
 * does). Reads `null`, a legacy shape and a hand-edited value all as „no layout", which is what
 * makes the fallback to the template the single failure mode instead of a blank page (PGS-15).
 */
export function parseEntityLayout(raw: unknown): LayoutEntry[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    return parseLayoutEntries(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** A widget entry — `cs<id>`, keyed to a `custom_sections` row that lives on exactly one page. */
const WIDGET_KEY = /^cs\d+$/;

/**
 * Read + write access to one stored layout. `useSettingsArray(key, parseLayoutEntries)` and
 * `useEntityLayout` both produce it, which is what lets `useRemoveCustomSection` prune an entry
 * without knowing where the array lives.
 */
export interface LayoutStore {
  value: LayoutEntry[];
  /** The array as it is *now* — for a closure (an undo) that runs after the render that made it. */
  current: () => LayoutEntry[];
  write: (next: LayoutEntry[]) => Promise<boolean>;
}

export interface EntityLayoutStore extends LayoutStore {
  /** This page has arranged itself; `false` means it is still following the standard. */
  hasOwn: boolean;
  /** Something is in the saved store, so „anwenden" has anything to apply. */
  hasSaved: boolean;
  /** Keep this arrangement to apply elsewhere later — the `*_layout_saved` store. */
  saveLayout: (full: LayoutEntry[]) => Promise<boolean>;
  /** Put the saved arrangement onto *this* page. */
  applySaved: () => Promise<boolean>;
  /** Publish this arrangement as the standard new pages inherit — the `*_layout` store. */
  saveAsDefault: (full: LayoutEntry[]) => Promise<boolean>;
  /** Back to `NULL` — the page follows the standard again. */
  resetToDefault: () => Promise<boolean>;
}

/**
 * One artist's or one project's own section layout (WP-25), plus the two settings stores it can be
 * exchanged with (WP-31). A `NULL` column means „never arranged" and reads as the **standard**
 * (`artist_layout` / `project_layout`), so a database from before the column renders exactly as it
 * did; a **saved** layout (`artist_layout_saved` / `project_layout_saved`) is a second, independent
 * store the user applies by hand. Keeping them apart is what lets „was neue Seiten erben" and „ein
 * Layout, das ich gelegentlich aufspiele" be different arrangements.
 *
 * The `['artist', id]` cache is published *before* the request is awaited, for the reason
 * `useSettingsArray` does it and `Arranger` restates: five of the six arrange mutations fire as
 * `void persist(…)`, so a second click inside the invalidate → refetch window would otherwise be
 * computed from the pre-first-click array and silently replace it (SHL-10). `useUndoablePatch` is
 * deliberately not used here — it does not publish, and no layout write has ever been undoable.
 */
export function useEntityLayout(
  kind: 'artist' | 'project',
  row: Artist | Project | undefined,
): EntityLayoutStore {
  const qc = useQueryClient();
  const guard = useGuardedAction();
  const invalidate = useInvalidateAll();
  const standard = useSettingsArray(
    kind === 'artist' ? 'artist_layout' : 'project_layout',
    parseLayoutEntries,
  );
  const saved = useSettingsArray(
    kind === 'artist' ? 'artist_layout_saved' : 'project_layout_saved',
    parseLayoutEntries,
  );
  const id = row?.id;
  const raw = row?.layout;

  const own = useMemo(() => parseEntityLayout(raw), [raw]);
  // Emptiness, not `!= null`: a corrupt or empty stored value then falls back to the standard
  // rather than presenting a layout with no entries in it.
  const hasOwn = own.length > 0;

  const standardCurrent = standard.current;
  const standardWrite = standard.write;
  const savedCurrent = saved.current;
  const savedWrite = saved.write;

  const current = useCallback(() => {
    const stored = parseEntityLayout(
      (qc.getQueryData([kind, id]) as { layout?: unknown } | undefined)?.layout,
    );
    return stored.length ? stored : standardCurrent();
  }, [qc, kind, id, standardCurrent]);

  const patch = useCallback(
    async (next: LayoutEntry[] | null, fallback: string) => {
      if (id == null) return false;
      qc.setQueryData([kind, id], (old: unknown) =>
        old && typeof old === 'object'
          ? { ...(old as object), layout: next && JSON.stringify(next) }
          : old,
      );
      const res = kind === 'artist' ? api.artists : api.projects;
      const ok = await guard(fallback, () => res.update(id, { layout: next }));
      await invalidate();
      return ok;
    },
    [qc, kind, id, guard, invalidate],
  );

  const write = useCallback(
    (next: LayoutEntry[]) => patch(next, 'Die Anordnung konnte nicht gespeichert werden.'),
    [patch],
  );
  const resetToDefault = useCallback(
    () => patch(null, 'Die Anordnung konnte nicht zurückgesetzt werden.'),
    [patch],
  );
  // Widget entries are dropped from **both** stores: a `cs<id>` names a row that exists on exactly
  // one page, so carrying it into a store other pages read hands them an entry they can never
  // render. Only the entity's own column may hold one.
  const withoutWidgets = (full: LayoutEntry[]) => full.filter((e) => !WIDGET_KEY.test(e.key));
  const saveAsDefault = useCallback(
    (full: LayoutEntry[]) => standardWrite(withoutWidgets(full)),
    [standardWrite],
  );
  const saveLayout = useCallback(
    (full: LayoutEntry[]) => savedWrite(withoutWidgets(full)),
    [savedWrite],
  );
  // `current()` rather than the rendered array, so an apply issued right after a save uses what
  // was actually stored — `useSettingsArray.write` publishes before it awaits.
  const applySaved = useCallback(() => write(savedCurrent()), [write, savedCurrent]);

  return {
    value: hasOwn ? own : standard.value,
    current,
    write,
    hasOwn,
    hasSaved: saved.value.length > 0,
    saveLayout,
    applySaved,
    saveAsDefault,
    resetToDefault,
  };
}

/** A row in the layout menu; disabled rows keep their reason in `title` rather than just greying. */
function MenuRow({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className="w-full rounded-lg px-3 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

/** What a page-changing action discards, or `null` when there is nothing to lose. */
interface PendingLayoutAction {
  title: string;
  body: string;
  confirm: string;
  run: () => Promise<boolean>;
  done: string;
}

/**
 * The arrange toolbar's „Layout" menu — the one place the two stores are visible and named.
 *
 * Both are settings arrays, but they answer different questions: the **standard** is what a page
 * inherits while its own column is NULL, and the **saved** layout is one the user keeps around and
 * applies by hand. They were the same thing in WP-25, which made „Als Vorlage" read as the only
 * action and hid the fact that the reset *was* the apply (WP-31).
 *
 * The heading names the scope through `useLabel`, because „Künstler" is renameable — and it is
 * appended, never fused: `Layout · ${label}` survives a rename to „Ensembles" where
 * „Künstlerseiten-Layout" would not.
 *
 * Passed the arranger's `full` rather than the store's own value, so a save records what is on
 * screen, including the defaults a page that never arranged is currently showing.
 */
export function LayoutMenu({
  store,
  full,
  labelKey,
}: {
  store: EntityLayoutStore;
  full: LayoutEntry[];
  labelKey: LabelKey;
}) {
  const label = useLabel();
  const toast = useToast();
  const { open, pos, anchorRef, menuRef, toggle, closePopover } = useAnchoredPopover<
    HTMLButtonElement,
    HTMLDivElement
  >();
  const [pending, setPending] = useState<PendingLayoutAction | null>(null);

  const run = async (fn: () => Promise<boolean>, done: string) => {
    closePopover();
    if (await fn()) toast.show({ message: done });
  };

  /**
   * The two page-changing actions confirm — they discard this page's arrangement at once and no
   * layout write goes on the undo stack. Only when there *is* one: on a page still following the
   * standard nothing is lost, and the dialog would be pure friction.
   */
  const ask = (action: PendingLayoutAction) => {
    closePopover();
    if (store.hasOwn) setPending(action);
    else void run(action.run, action.done);
  };

  return (
    <>
      <Btn ref={anchorRef} variant="subtle" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
        ⌂ Layout <span className="text-[9px] opacity-70">▾</span>
      </Btn>
      {open &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-30" onClick={closePopover} />
            <div
              ref={menuRef}
              role="menu"
              className="fixed z-40 w-72 overflow-y-auto rounded-xl bg-white p-1 shadow-xl ring-1 ring-black/10"
              style={{ left: pos.left, top: pos.top, maxHeight: pos.maxHeight }}
            >
              <div className="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                {`Layout · ${label(labelKey)}`}
              </div>
              <div className="px-3 pb-2 text-xs text-neutral-500">
                {store.hasOwn
                  ? 'Diese Seite hat eine eigene Anordnung.'
                  : 'Diese Seite folgt dem Standard.'}
              </div>
              <div className="my-1 border-t border-neutral-100" />
              <MenuRow
                title="Diese Anordnung merken, um sie später auf andere Seiten anzuwenden"
                onClick={() => void run(() => store.saveLayout(full), 'Layout gespeichert.')}
              >
                Layout speichern
              </MenuRow>
              <MenuRow
                disabled={!store.hasSaved}
                title={
                  store.hasSaved
                    ? 'Das gespeicherte Layout auf diese Seite anwenden'
                    : 'Noch kein Layout gespeichert.'
                }
                onClick={() =>
                  ask({
                    title: 'Gespeichertes Layout anwenden',
                    body: 'Die eigene Anordnung dieser Seite wird durch das gespeicherte Layout ersetzt. Das lässt sich nicht rückgängig machen.',
                    confirm: 'Anwenden',
                    run: store.applySaved,
                    done: 'Gespeichertes Layout angewendet.',
                  })
                }
              >
                Gespeichertes Layout anwenden
              </MenuRow>
              <div className="my-1 border-t border-neutral-100" />
              <MenuRow
                title="Neue Seiten dieses Typs übernehmen künftig diese Anordnung"
                onClick={() => void run(() => store.saveAsDefault(full), 'Als Standard gespeichert.')}
              >
                Als Standard für neue Seiten speichern
              </MenuRow>
              <MenuRow
                disabled={!store.hasOwn}
                title={
                  store.hasOwn
                    ? 'Die eigene Anordnung verwerfen und wieder dem Standard folgen'
                    : 'Diese Seite folgt bereits dem Standard.'
                }
                onClick={() =>
                  ask({
                    title: 'Auf Standard zurücksetzen',
                    body: 'Die eigene Anordnung dieser Seite geht verloren und die Seite folgt wieder dem Standard. Das lässt sich nicht rückgängig machen.',
                    confirm: 'Zurücksetzen',
                    run: store.resetToDefault,
                    done: 'Auf Standard zurückgesetzt.',
                  })
                }
              >
                Auf Standard zurücksetzen
              </MenuRow>
            </div>
          </>,
          document.body,
        )}
      {/* A sibling of the popover, not a child: the menu closes on the click that opens this. */}
      {pending && (
        <Modal
          title={pending.title}
          onClose={() => setPending(null)}
          footer={
            <>
              <Btn onClick={() => setPending(null)}>Abbrechen</Btn>
              <Btn
                variant="danger"
                onClick={() => {
                  void run(pending.run, pending.done);
                  setPending(null);
                }}
              >
                {pending.confirm}
              </Btn>
            </>
          }
        >
          <p className="text-sm text-neutral-600">{pending.body}</p>
        </Modal>
      )}
    </>
  );
}

/**
 * Renders a page's sections in a user-defined layout (order + per-section width),
 * persisted in a settings array of {key,width}. A "Bereiche anordnen" toggle reveals
 * a drag handle (native HTML5 drag-and-drop reorder), ▲/▼ move buttons as a keyboard
 * fallback, and a full/half width toggle. Half-width sections flow into a 2-column grid,
 * so two adjacent halves sit side by side. Unknown/new section keys are appended as full;
 * legacy string[] layouts are read as all-full. Shared by the dashboard, artist and
 * project pages.
 *
 * Where the layout lives is the caller's business: a settings key (`dashboard_layout`), an
 * entity's own `layout` column via `useEntityLayout` (artists and projects, WP-25), or the
 * landing's `seasons.json` blob. No stored layout is shared between pages any more — that was
 * SHL-19, reversed by WP-25 — so every key in an array belongs to the page that wrote it.
 *
 * The layout still keeps two views: `full` (every stored entry, this page's new keys appended)
 * and `display` (`full` filtered to this page's sections, minus the hidden ones). All mutations
 * operate on and persist `full`; rendering uses `display`. What `full` still buys, now that the
 * sharing is gone, is that an entry survives a round trip its page cannot currently render — a
 * widget key inherited from the template, or one whose section is still loading. Retaining those
 * is safe rather than merely tidy: `custom_sections` is AUTOINCREMENT, so a purged `cs<id>` is
 * never handed back inside a season and a stale entry can never be reclaimed by a later widget,
 * which is the hazard `useRemoveLandingSection` has to close for the reusable `lt<id>`.
 *
 * Sections are optional unless listed in `mandatoryKeys`: edit mode offers a 🗑 that hides a
 * built-in (`hidden: true` on its entry) or soft-deletes a custom widget (`onRemoveCustom`).
 * Hidden sections are simply not rendered — re-adding goes through the "+ Bereich" picker,
 * which `addAction` receives the hidden keys and a restore callback for.
 *
 * **Every mutation is computed from `full` and `full` has to be current**, which is why both
 * persistence arms publish the value they write before awaiting it. An arrange action is a
 * click, and the previous one's invalidate → refetch takes hundreds of milliseconds on a real
 * season: without the publish, the second gesture is computed from the pre-first-gesture array
 * and silently replaces it. Drag „Termine" above „Kontakte", then hit „◧ Halbe Breite" on it —
 * the drag was lost; 🗑 a section then toggle a width — the removed section is back (SHL-10).
 */
export interface SectionArrangerProps {
  /** Settings key holding the layout — the default persistence. Omit when `layout` + `onPersist` are given. */
  layoutKey?: LayoutKey;
  /** Stored entries when the page persists elsewhere (the landing: seasons.json via /api/landing). */
  layout?: LayoutEntry[];
  /**
   * Write-back override, paired with `layout`. Must report its own failures and must publish the
   * value it writes before awaiting, the way `useSettingsArray` does — see `Arranger`.
   */
  onPersist?: (next: LayoutEntry[]) => Promise<unknown>;
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
  /**
   * What the confirm dialog promises a filled custom section. The default is the soft-delete
   * story every `custom_sections` page can keep. The landing's sections are registry rows with
   * no `deleted_at` and no Archiv entry, so that page says what is actually true there instead
   * of offering a recovery that does not exist (SHL-03).
   */
  removeCustomCopy?: { body: string; confirm: string };
  /** The "+ Bereich" button, rendered only in edit mode, fed the hidden built-ins to offer. */
  addAction?: (ctx: {
    hiddenKeys: string[];
    restore: (key: string) => void;
    prepend: (key: string) => void;
  }) => ReactNode;
  /**
   * The entity pages' „Layout" menu. Fed `full` rather than the stored array so a save records
   * what is on screen, defaults included. Kept a render prop so this component stays unaware that
   * a saved layout or a standard exist at all — the dashboard and the landing pass nothing.
   */
  layoutAction?: (ctx: { full: LayoutEntry[] }) => ReactNode;
}

/**
 * Two persistence modes, one view. A page either names a settings key or brings its own layout
 * and write-back; the split is here rather than inside the view so the settings hook is called
 * unconditionally in the arm that has a key. No hooks run in this function, so the guard below
 * is a plain argument check.
 */
export function SectionArranger(props: SectionArrangerProps) {
  const { layoutKey, layout, onPersist } = props;
  if (!layoutKey && !onPersist) throw new Error('SectionArranger needs layoutKey or layout+onPersist');
  return layoutKey ? (
    <SettingsArranger {...props} layoutKey={layoutKey} />
  ) : (
    <Arranger {...props} layout={layout ?? []} onPersist={onPersist!} />
  );
}

/** The settings-backed arm: `useSettingsArray` owns the write, the cache publish and the toast. */
function SettingsArranger({ layoutKey, ...rest }: SectionArrangerProps & { layoutKey: LayoutKey }) {
  const { value, write } = useSettingsArray(layoutKey, parseLayoutEntries);
  return <Arranger {...rest} layout={value} onPersist={write} />;
}

function Arranger({
  layout,
  onPersist: persist,
  sections,
  labelKeys,
  titles = {},
  mandatoryKeys,
  defaultHidden = [],
  fullWidthKeys = [],
  nonEmptyKeys = [],
  toolbarAfterKey,
  onRemoveCustom,
  layoutAction,
  removeCustomCopy = {
    body: 'samt Inhalt in den Papierkorb verschieben? Du kannst den Bereich im Archiv wiederherstellen.',
    confirm: 'In den Papierkorb',
  },
  addAction,
}: SectionArrangerProps & {
  layout: LayoutEntry[];
  onPersist: (next: LayoutEntry[]) => Promise<unknown>;
}) {
  const label = useLabel();
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

  const { full, display, hiddenKeys } = useMemo(() => {
    const known = Object.keys(sections);
    // `hidden` only ever applies to built-ins (keys with a LabelKey): custom widgets are
    // soft-deleted rows, and a mandatory section must never disappear even if a stale entry
    // claims so — both self-heal here on read.
    const stored: LayoutEntry[] = layout.map(({ key, width, hidden }) => ({
      key,
      width,
      ...(hidden === true && key in labelKeys && !mandatoryKeys.includes(key) ? { hidden: true } : {}),
    }));
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
  }, [sectionSig, layout, fullWidthSig, mandatorySig, defaultHiddenSig]);

  const idxInFull = (key: string) => full.findIndex((e) => e.key === key);

  const move = (key: string, dir: -1 | 1) => {
    // The neighbour comes from the *visible* list, the move happens in the full one — so one
    // press of ▼ moves this section past the next section the user can see, not past an
    // invisible foreign widget entry that happens to sit between them. Stepping over that entry
    // therefore also moves it relative to this section, which is the accepted trade above.
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
    // Any entry already carrying this key goes first. A landing section id *is* reused — the
    // registry's counter is `max(surviving ids) + 1`, so deleting `lt3` and adding a Textfeld
    // yields `lt3` again — and without this the array is persisted holding the key twice, one
    // of them with a stale `half` width that wins as soon as the order shifts (SHL-18).
    const rest = full.filter((e) => e.key !== key);
    const anchor = toolbarAfterKey != null ? rest.findIndex((e) => e.key === toolbarAfterKey) : -1;
    const next = [...rest];
    next.splice(anchor + 1, 0, entry);
    void persist(next);
  };

  // The toolbar can sit inside the grid after a named section (the dashboard puts it below
  // the Künstler grid — you can't edit that anyway); everywhere else it tops the block.
  const toolbarInGrid = toolbarAfterKey != null && display.some((e) => e.key === toolbarAfterKey);
  /**
   * Where the toolbar's anchor section sits, and therefore the one position in the grid that is
   * fixed. Nothing pinned it before: `mandatoryKeys` only takes the 🗑 away, so ▲ on the section
   * below „Künstler" swapped it above the grid and rendered the toolbar — „✓ Fertig", the only
   * control that leaves arrange mode — halfway down the page (SHL-17).
   */
  const anchorIdx = toolbarInGrid ? display.findIndex((e) => e.key === toolbarAfterKey) : -1;

  const drag = useDragReorder<string>({
    enabled: arranging,
    canDrop: (fromKey, toKey) =>
      anchorIdx < 0 || (fromKey !== toolbarAfterKey && toKey !== toolbarAfterKey),
    onReorder: async (fromKey, toKey) => {
      const next = arrayMoveTo(full, idxInFull(fromKey), idxInFull(toKey));
      // Awaited rather than `void`-ed: the hook awaits what it gets back and toasts a
      // rejection, so a layout that failed to save no longer just snaps back silently (CCL-13).
      if (next !== full) await persist(next);
    },
  });

  const toolbar = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {arranging && addAction?.({ hiddenKeys, restore, prepend })}
      {arranging && layoutAction?.({ full })}
      <Btn variant="subtle" onClick={() => setArranging((a) => !a)}>
        {arranging ? '✓ Fertig' : '✎ Bereiche bearbeiten'}
      </Btn>
    </div>
  );

  return (
    <>
      {!toolbarInGrid && toolbar}
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
        {display.map((entry, i) => {
          const key = entry.key;
          const canHalf = !fullWidthKeys.includes(key);
          // `[&_.section-title]:hidden`: the strip already names the section — hiding the
          // in-card heading (incl. its action buttons) avoids the double title in edit mode.
          // `outline`, not `ring`: Tailwind implements `ring-*` as a box-shadow, which has no
          // dash style, and `ring-dashed` is not a utility at all — it compiled to nothing and
          // every section got a solid 2px ring instead of the dashed "you are arranging these"
          // affordance it was meant to have (SHL-20).
          const arrangeCls = arranging
            ? `select-none rounded-2xl p-3 outline-2 outline-dashed [&_.section-title]:hidden ${
                drag.isDropTarget(key) ? 'outline-neutral-600' : 'outline-neutral-300'
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
                    {/* `opacity-100`: the strip is not a hover `group`, and this handle is the
                        section's only visible grab affordance. The reorderer runs in the default
                        `mode: 'always'` — the whole section div carries `draggable` — so
                        `handleProps` is empty here and the ⠿ is an affordance, not the trigger. */}
                    <DragHandle className="text-base opacity-100" {...drag.handleProps(key)} />
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
                      // The anchor stays put and nothing may pass it, so the section right
                      // below it cannot go up either.
                      disabled={i === 0 || i === anchorIdx || i === anchorIdx + 1}
                      aria-label="nach oben"
                      onClick={() => move(key, -1)}
                    >
                      ▲
                    </button>
                    <button
                      className="rounded px-2 py-0.5 text-lg leading-none text-neutral-500 hover:bg-neutral-200 disabled:opacity-30"
                      disabled={i === display.length - 1 || i === anchorIdx}
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
          // Custom widget: its content belongs to it and goes with it. Where it goes — and
          // therefore what the dialog may promise — is the page's to say, see `removeCustomCopy`.
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
                  {removeCustomCopy.confirm}
                </Btn>
              </>
            }
          >
            <p className="text-sm text-neutral-600">
              „{titles[removing] ?? removing}“ {removeCustomCopy.body}
            </p>
          </Modal>
        ))}
    </>
  );
}
