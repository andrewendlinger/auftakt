import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface ToastInput {
  message: string;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  duration?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastApi {
  show: (t: ToastInput) => void;
}

const ToastCtx = createContext<ToastApi>({ show: () => {} });

export function useToast(): ToastApi {
  return useContext(ToastCtx);
}

/**
 * How many toasts may share the screen. The column grows upward from `bottom-4`, so an
 * uncapped burst — a held-down Cmd+Z emits one per step — pushes the oldest cards above the
 * fold, and those are precisely the ones whose „Rückgängig" is about to expire. Dropping the
 * oldest is therefore the right end to drop. Mirrors `UndoProvider`'s `MAX_DEPTH`.
 */
const MAX_TOASTS = 5;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const timers = useRef<Map<number, number>>(new Map());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
    setItems((s) => s.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (t: ToastInput) => {
      const id = ++counter.current;
      setItems((s) => [...s, { ...t, id }].slice(-MAX_TOASTS));
      const ms = t.duration ?? 6000;
      // A toast the slice dropped keeps its timer; it fires within the duration, finds nothing
      // to filter and clears its own entry, so the map stays as short as the burst is long.
      timers.current.set(id, window.setTimeout(() => dismiss(id), ms));
    },
    [dismiss],
  );

  // Memoised: `items` changes on every appearance and dismissal, and a fresh `{ show }` there
  // would re-render every consumer in the app — including UndoProvider, which would then hand
  // out a fresh value of its own and take the rest of the tree with it (SHL-25).
  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      {/* no-print: the layer is always mounted and outside `Layout`, so a live toast — the
          undo pill after a delete, say — was painted onto the first page of a print or PDF.
          `window.print()` blocks, so the 6 s timer cannot rescue it. */}
      <div className="no-print pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-center gap-4 rounded-xl bg-neutral-900 px-4 py-2.5 text-sm text-white shadow-lg"
          >
            <span>{t.message}</span>
            {t.actionLabel && (
              <button
                className="font-semibold text-sky-300 hover:text-sky-200"
                onClick={async () => {
                  dismiss(t.id);
                  await t.onAction?.();
                }}
              >
                {t.actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
