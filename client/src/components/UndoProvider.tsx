import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useToast } from './Toast';

/**
 * One user-visible change, with both directions stored. `apply` is what the user did (so redo
 * can replay it) and `revert` puts the previous values back.
 */
export interface UndoEntry {
  /** German, names the change itself: „Statusänderung", not „Aufgabe". */
  label: string;
  apply: () => Promise<void>;
  revert: () => Promise<void>;
}

interface UndoApi {
  push: (entry: UndoEntry) => void;
}

const UndoCtx = createContext<UndoApi>({ push: () => {} });

export function useUndo(): UndoApi {
  return useContext(UndoCtx);
}

/** Plenty for a session's worth of edits, and bounded so a long session can't grow unbounded. */
const MAX_DEPTH = 50;

/**
 * Input types that hold no typed text, so there is no native undo to defer to. Clicking a
 * checkbox leaves it focused; treating that as "in a text field" would swallow the very next
 * Cmd+Z, which is exactly when the user wants it.
 */
const NON_TEXT_INPUTS = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'color',
  'range',
  'file',
]);

/**
 * Skip the app-level stack while the caret is in a text field: there the browser's own undo is
 * what the user means, and it operates on characters we never see. The two handlers are
 * complementary rather than competing — which is also why Electron's `{ role: 'editMenu' }`
 * accelerator can stay: outside a text field its native undo is a no-op.
 */
function inTextField(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

export function UndoProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  // Refs, not state: nothing renders from the stacks, so a re-render per edit would be pure cost.
  const undoStack = useRef<UndoEntry[]>([]);
  const redoStack = useRef<UndoEntry[]>([]);

  const push = useCallback((entry: UndoEntry) => {
    undoStack.current.push(entry);
    if (undoStack.current.length > MAX_DEPTH) undoStack.current.shift();
    // A fresh edit forks the history — anything that was undone is no longer reachable.
    redoStack.current = [];
  }, []);

  // Each step is a round trip, so a held-down Cmd+Z would otherwise interleave two runs and
  // let them pop the same stack concurrently.
  const busy = useRef(false);

  const run = useCallback(
    async (from: 'undo' | 'redo') => {
      if (busy.current) return;
      const src = from === 'undo' ? undoStack : redoStack;
      const dst = from === 'undo' ? redoStack : undoStack;
      const entry = src.current.pop();
      if (!entry) return;
      busy.current = true;
      try {
        await (from === 'undo' ? entry.revert() : entry.apply());
        dst.current.push(entry);
        toast.show({
          message: `${entry.label} ${from === 'undo' ? 'rückgängig gemacht' : 'wiederhergestellt'}`,
        });
      } catch {
        // The row was deleted (or the season swapped) since the edit — the entry can never
        // succeed now, so drop it rather than leaving it to fail again on the next keypress.
        toast.show({
          message:
            from === 'undo'
              ? `${entry.label} konnte nicht rückgängig gemacht werden`
              : `${entry.label} konnte nicht wiederhergestellt werden`,
        });
      } finally {
        busy.current = false;
      }
    },
    [toast],
  );

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      if (inTextField()) return;
      e.preventDefault();
      void run(e.shiftKey ? 'redo' : 'undo');
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [run]);

  return <UndoCtx.Provider value={{ push }}>{children}</UndoCtx.Provider>;
}
