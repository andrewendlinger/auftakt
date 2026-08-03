import { createPortal } from 'react-dom';
import { useAnchoredPopover } from '../lib/popover';
import { DropletIcon } from './icons';

/** A spectrum of vivid colors; items render them as a soft tint + accent so any pick stays readable. */
const PRESETS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#78716c',
];

/**
 * Small color control for coloring a list item. Trigger shows the current color (or a
 * droplet when unset); the popover offers presets, a native custom picker, and "Keine".
 *
 * The popover goes through `useAnchoredPopover` — plain `absolute` positioning was clipped by
 * the task table's `overflow-x-auto` wrapper whenever the table was short, cutting off the
 * „Keine" / „eigene" row entirely, and there was no Escape (RTE-13).
 */
export function ColorSwatchPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (color: string | null) => void;
}) {
  const { open, pos, anchorRef, menuRef, toggle, closePopover } = useAnchoredPopover<
    HTMLButtonElement,
    HTMLDivElement
  >();
  const pick = (c: string | null) => {
    closePopover();
    anchorRef.current?.focus();
    onChange(c);
  };
  return (
    <div className="relative inline-flex">
      <button
        ref={anchorRef}
        type="button"
        title="Farbe wählen"
        aria-label="Farbe wählen"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        className="flex h-7 w-7 items-center justify-center rounded text-neutral-400 transition hover:bg-black/5 hover:text-neutral-700"
      >
        {value ? (
          <span className="h-4 w-4 rounded-full ring-1 ring-black/20" style={{ background: value }} />
        ) : (
          <DropletIcon className="h-4 w-4" />
        )}
      </button>
      {open &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-30" onClick={closePopover} />
            <div
              ref={menuRef}
              className="fixed z-40 overflow-y-auto rounded-xl bg-white p-2 text-neutral-600 shadow-lg ring-1 ring-black/10"
              style={{ left: pos.left, top: pos.top, maxHeight: pos.maxHeight }}
              onKeyDown={(e) => {
                // Stopped here so dismissing the picker inside a dialog leaves the dialog open.
                if (e.key !== 'Escape') return;
                e.preventDefault();
                e.stopPropagation();
                closePopover();
                anchorRef.current?.focus();
              }}
            >
              <div className="grid grid-cols-8 gap-1">
                {PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={c}
                    aria-label={c}
                    onClick={() => pick(c)}
                    className="h-5 w-5 rounded-full ring-1 ring-black/10 transition hover:scale-110"
                    style={{ background: c }}
                  />
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-xs">
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="color"
                    value={value ?? '#888888'}
                    onChange={(e) => onChange(e.target.value)}
                    className="h-6 w-6 cursor-pointer rounded border border-neutral-300"
                  />
                  <span>eigene</span>
                </label>
                <button type="button" onClick={() => pick(null)} className="rounded px-2 py-1 hover:bg-neutral-100">
                  Keine
                </button>
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
