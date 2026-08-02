import { useState, type DragEvent } from 'react';

/** Whatever identifies one draggable item — a section key, or a row id. */
type Key = string | number;

export interface DragReorderOptions<K extends Key> {
  /** Commit a move: the item `from` was dropped onto `to`. */
  onReorder: (from: K, to: K) => void;
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
  const [dragKey, setDragKey] = useState<K | null>(null);
  const [overKey, setOverKey] = useState<K | null>(null);
  const [armedKey, setArmedKey] = useState<K | null>(null);

  const allowed = (from: K, to: K) => from !== to && (!canDrop || canDrop(from, to));

  const reset = () => {
    setDragKey(null);
    setOverKey(null);
    setArmedKey(null);
  };

  return {
    isDragging: (key: K) => dragKey === key,
    /** True only for an item that would actually accept the current drag. */
    isDropTarget: (key: K) => overKey === key && dragKey !== null && allowed(dragKey, key),

    /**
     * Spread onto the grab handle in `'armed'` mode. Pointer-down arms the item, and either
     * `onDragEnd` or a pointer-up that never became a drag disarms it again — leaving a row
     * armed would keep it `draggable`, which swallows text selection inside it.
     */
    handleProps: (key: K) =>
      mode === 'armed' && enabled
        ? { onPointerDown: () => setArmedKey(key), onPointerUp: () => setArmedKey(null) }
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
          setDragKey(key);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(key));
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
            onReorder(dragKey, key);
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
