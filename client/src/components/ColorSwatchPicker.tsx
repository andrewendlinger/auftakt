import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGuardedAction } from '../hooks';
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
 *
 * The „eigene" input is a *draft* until the popover closes; see `draft` below.
 */
export function ColorSwatchPicker({
  value,
  onChange,
}: {
  value: string | null;
  /** Return the promise — the picker owns the failure arm for all three call sites. */
  onChange: (color: string | null) => void | Promise<void>;
}) {
  const guard = useGuardedAction();
  const write = (c: string | null) =>
    void guard('Die Farbe konnte nicht gespeichert werden.', () => Promise.resolve(onChange(c)));
  /**
   * The native colour input's live value, held back from the write path.
   *
   * `<input type="color">` fires continuously while the user drags through the OS colour
   * wheel, and every tick used to go straight to `onChange` → a PATCH, a full query
   * invalidation and one undo entry *per frame*. Afterwards Cmd+Z stepped back one
   * imperceptible shade at a time and the toast stack was full of identical „Farbänderung"
   * entries (RTE-08). The trigger swatch previews the draft, so closing the popover is the
   * commit — by any route, matching the preset buttons, which also pick and close.
   */
  const [draft, setDraft] = useState<string | null>(null);
  // Read by the close callback, which is registered once per open.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const commitDraft = () => {
    const next = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (next !== null && next !== value) write(next);
  };

  const { open, pos, anchorRef, menuRef, toggle, closePopover } = useAnchoredPopover<
    HTMLButtonElement,
    HTMLDivElement
  >(commitDraft);
  const pick = (c: string | null) => {
    draftRef.current = null;
    setDraft(null);
    closePopover();
    anchorRef.current?.focus();
    write(c);
  };
  const shown = draft ?? value;
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
        {shown ? (
          <span className="h-4 w-4 rounded-full ring-1 ring-black/20" style={{ background: shown }} />
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
                    value={shown ?? '#888888'}
                    onChange={(e) => setDraft(e.target.value)}
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
