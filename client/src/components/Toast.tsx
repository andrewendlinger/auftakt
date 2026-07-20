import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((s) => s.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (t: ToastInput) => {
      const id = ++counter.current;
      setItems((s) => [...s, { ...t, id }]);
      const ms = t.duration ?? 6000;
      window.setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );

  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2">
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
