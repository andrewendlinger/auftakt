import { useEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react';
import { useErrorToast, useInvalidateAll } from '../hooks';
import { arrayMoveTo } from './arrays';

/** Whatever identifies one draggable item — a section key, or a row id. */
type Key = string | number;

/**
 * Payload type for a reorder gesture. Private on purpose: `text/plain` made every drag a native
 * *text* drag, which any editable element accepts without a line of JS — releasing a row over the
 * global search field, an inline Titel/Kommentar editor or the RichTextEditor inserted the raw row
 * id („17") into it, and an inline editor that commits on blur then saved it (CCL-15).
 *
 * The payload is never read back — the hook tracks the dragged item in `dragKey` — but something
 * has to be set: Firefox refuses to start a drag with an empty dataTransfer.
 */
const DRAG_MIME = 'application/x-auftakt-row';

export interface DragReorderOptions<K extends Key> {
  /**
   * Commit a move: the item `from` was dropped onto `to`. May be async — the hook awaits it and
   * reports a rejection, so a caller does not need its own catch arm.
   */
  onReorder: (from: K, to: K) => void | Promise<void>;
  /**
   * Reject a pairing before it becomes a drop target. Used by the task table, where a row may
   * only be dropped on a sibling of equal rank. A `false` here both hides the drop highlight
   * and drops the event on the floor.
   */
  canDrop?: (from: K, to: K) => boolean;
  /** Turn dragging off wholesale (e.g. only inside SectionArranger's "anordnen" mode). */
  enabled?: boolean;
  /**
   * `'always'` — every item is draggable while enabled. Right for cards that own their whole
   * surface.
   * `'armed'` — an item becomes draggable only after `handleProps` fires on its grab handle.
   * Required wherever the item contains text or inline inputs, because a permanently
   * `draggable` ancestor swallows text selection and click-to-edit.
   */
  mode?: 'always' | 'armed';
}

/**
 * Native HTML5 drag-to-reorder, with no dnd library. Extracted from SectionArranger so the
 * section, project-card and task-row reorderers share one implementation.
 *
 * Positional only — it reports which item was dropped on which, and the caller decides what
 * that means for its own list and how to persist it.
 */
export function useDragReorder<K extends Key>({
  onReorder,
  canDrop,
  enabled = true,
  mode = 'always',
}: DragReorderOptions<K>) {
  const report = useErrorToast();
  const [dragKey, setDragKey] = useState<K | null>(null);
  const [overKey, setOverKey] = useState<K | null>(null);
  const [armedKey, setArmedKey] = useState<K | null>(null);
  // Whether a native drag is actually running, as a ref: the window listener below has to read
  // the live value, not the one its render closed over.
  const dragging = useRef(false);

  const allowed = (from: K, to: K) => from !== to && (!canDrop || canDrop(from, to));

  const reset = () => {
    dragging.current = false;
    setDragKey(null);
    setOverKey(null);
    setArmedKey(null);
  };

  /**
   * Disarm from the window, not from the handle. A grab released anywhere but on the ⠿ — outside
   * the browser window, after a sub-threshold slip, a right-click, a cancelled touch — never
   * fired the handle's own `pointerup` and never started a drag, so no `dragend` followed either:
   * the row stayed `draggable` for good, which swallows text selection and misfires the inline
   * click-to-edit cells until some other row happens to be armed (CCL-19).
   *
   * `dragging` is the exception that has to survive: Chromium fires `pointercancel` at the very
   * moment a native drag begins, and disarming there would flip `draggable` off underneath the
   * drag it just started. `onDragEnd` owns that path.
   */
  useEffect(() => {
    if (armedKey === null) return;
    const disarm = () => {
      if (!dragging.current) setArmedKey(null);
    };
    window.addEventListener('pointerup', disarm);
    window.addEventListener('pointercancel', disarm);
    window.addEventListener('blur', disarm);
    return () => {
      window.removeEventListener('pointerup', disarm);
      window.removeEventListener('pointercancel', disarm);
      window.removeEventListener('blur', disarm);
    };
  }, [armedKey]);

  return {
    isDragging: (key: K) => dragKey === key,
    /** True only for an item that would actually accept the current drag. */
    isDropTarget: (key: K) => overKey === key && dragKey !== null && allowed(dragKey, key),

    /**
     * Spread onto the grab handle in `'armed'` mode. A primary-button pointer-down arms the item;
     * `onDragEnd` or the window listener above disarms it again — leaving a row armed would keep
     * it `draggable`, which swallows text selection inside it.
     *
     * Secondary buttons are ignored outright: a right-click on the handle used to arm the row
     * while opening the context menu, and the release that follows is a `contextmenu`, not a
     * gesture that could ever disarm it.
     */
    handleProps: (key: K) =>
      mode === 'armed' && enabled
        ? {
            onPointerDown: (e: PointerEvent) => {
              if (e.button !== 0 || !e.isPrimary) return;
              setArmedKey(key);
            },
          }
        : {},

    /** Spread onto the draggable item itself. */
    itemProps: (key: K) => {
      if (!enabled) return {};
      return {
        draggable: mode === 'always' || armedKey === key,
        onDragStart: (e: DragEvent) => {
          // Same condition that gates `draggable` above. The row itself is not draggable until
          // its handle arms it, but a drag started *inside* it — a text selection in a Titel or
          // Kommentar cell, an image — is native and bubbles up to this handler anyway. Without
          // the guard that stray gesture set `dragKey` and a release on a sibling row reordered
          // and persisted the list: the user tried to copy a word and reshuffled the table,
          // with no undo affordance (CCL-01).
          if (mode === 'armed' && armedKey !== key) return;
          // Nested reorderers (a project card inside an arrangeable section) must not both
          // claim the same gesture.
          e.stopPropagation();
          dragging.current = true;
          setDragKey(key);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData(DRAG_MIME, String(key));
        },
        onDragOver: (e: DragEvent) => {
          // No dragKey means the drag started outside this list — leave it to someone else.
          if (dragKey === null || !allowed(dragKey, key)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          if (overKey !== key) setOverKey(key);
        },
        onDragLeave: (e: DragEvent) => {
          // Without this the highlight sticks when the pointer moves on to an item that
          // `canDrop` refuses, since those never run the `setOverKey` above. Ignore the
          // dragleave that bubbles from moving between an item's own descendants.
          const to = e.relatedTarget;
          if (to instanceof Node && e.currentTarget.contains(to)) return;
          if (overKey === key) setOverKey(null);
        },
        onDrop: (e: DragEvent) => {
          if (dragKey !== null && allowed(dragKey, key)) {
            e.preventDefault();
            e.stopPropagation();
            // Every call site is async (a reorder request plus an invalidate). Dropping the
            // promise here turned a rejected reorder — a restarted server, a season swapped
            // mid-drag, a row purged since the list was fetched — into an unhandled rejection:
            // the invalidate never ran, the row snapped back on the next refetch, and nothing
            // told the user, so a refused reorder looked exactly like a mis-drop (CCL-13).
            void Promise.resolve(onReorder(dragKey, key)).catch((err: unknown) =>
              report(err, 'Die neue Reihenfolge konnte nicht gespeichert werden.'),
            );
          }
          reset();
        },
        onDragEnd: (e: DragEvent) => {
          e.stopPropagation();
          reset();
        },
      };
    },
  };
}

/** The props bundle `useDragReorder`/`useListReorder` hand back, for components that take it. */
export type DragReorder<K extends string | number = number> = ReturnType<typeof useDragReorder<K>>;

/**
 * The whole-list case of `useDragReorder`: every item is a sibling of every other, so a drop is
 * „lift `from` out and re-insert it where `to` sits", and the new order is persisted by sending
 * the ids in display order to a batch `reorder` endpoint.
 *
 * That closure sat verbatim in two places — the landing page's season cards and the artist page's
 * project cards, differing only in the array and the `api.*.reorder` call — so every change to the
 * drag semantics had to be made twice and whichever copy was missed kept the old behaviour
 * (PGS-29). The out-of-range case the finding worried about is already handled: `arrayMoveTo`
 * returns the list unchanged when a `findIndex` came back `-1`, and the identity check below then
 * skips the request.
 *
 * Not for the task table, whose rows are *not* one flat list — it reorders within one sibling
 * group of a tree and has its own `canDrop`.
 */
export function useListReorder<T extends { id: number }>(
  items: T[],
  reorder: (ids: number[]) => Promise<unknown>,
) {
  const invalidate = useInvalidateAll();
  return useDragReorder<number>({
    mode: 'armed',
    onReorder: async (fromId, toId) => {
      const next = arrayMoveTo(
        items,
        items.findIndex((i) => i.id === fromId),
        items.findIndex((i) => i.id === toId),
      );
      if (next === items) return;
      await reorder(next.map((i) => i.id));
      await invalidate();
    },
  });
}
