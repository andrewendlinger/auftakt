import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { contrastText } from '../lib/colors';
import type { CustomColumnOption } from '../api/types';

/**
 * A compact, modern colored-category dropdown used for the Status, Priorität and
 * custom "Auswahl" columns. The trigger is a colored pill; the menu lists options
 * with colored swatches. Native <select> can't style its option list, hence this.
 *
 * The menu is rendered in a portal with fixed positioning so it can't be clipped by
 * the task table's `overflow-x-auto` container (which happens when the table is short).
 */
export function PillSelect({
  value,
  options,
  onChange,
  allowEmpty = false,
  placeholder = '—',
  disabled = false,
}: {
  value: string;
  options: CustomColumnOption[];
  onChange: (v: string) => void;
  allowEmpty?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; minWidth: number; maxHeight?: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, top: r.bottom + 4, minWidth: r.width });
    setOpen(true);
  };
  const pick = (v: string) => {
    setOpen(false);
    if (v !== value) onChange(v);
  };

  // Once the menu is in the DOM, refine its position: flip above the trigger when there's
  // more room there, clamp horizontally to stay on screen, and cap the height to the
  // available space (the menu scrolls internally) so long option lists stay reachable.
  // A scroll of the page invalidates the anchor rect, so close — but ignore scrolls that
  // originate inside the menu itself (its own overflow-y-auto), which must not close it.
  useLayoutEffect(() => {
    if (!open) return;
    const btn = btnRef.current;
    const menu = menuRef.current;
    if (btn && menu) {
      const margin = 8;
      const r = btn.getBoundingClientRect();
      const menuW = menu.offsetWidth;
      const spaceBelow = window.innerHeight - r.bottom - margin;
      const spaceAbove = r.top - margin;
      const flipUp = menu.scrollHeight > spaceBelow && spaceAbove > spaceBelow;
      const maxHeight = Math.max(80, Math.floor(flipUp ? spaceAbove : spaceBelow));
      const left = Math.max(margin, Math.min(r.left, window.innerWidth - menuW - margin));
      const top = flipUp ? Math.max(margin, r.top - 4 - Math.min(menu.scrollHeight, maxHeight)) : r.bottom + 4;
      setPos({ left, top, minWidth: r.width, maxHeight });
    }
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <div className="inline-block">
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition hover:brightness-95 disabled:cursor-default"
        style={
          current
            ? { background: current.color, color: contrastText(current.color) }
            : { background: '#f1f5f9', color: '#94a3b8' }
        }
      >
        {current ? current.label : placeholder}
        {!disabled && <span className="text-[9px] opacity-60">▾</span>}
      </button>
      {open &&
        !disabled &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <div
              ref={menuRef}
              className="fixed z-40 min-w-36 overflow-y-auto rounded-xl bg-white p-1 shadow-lg ring-1 ring-black/10"
              style={{ left: pos.left, top: pos.top, minWidth: pos.minWidth, maxHeight: pos.maxHeight }}
            >
              {allowEmpty && (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-neutral-100"
                  onClick={() => pick('')}
                >
                  <span className="h-3 w-3 shrink-0 rounded-full ring-1 ring-inset ring-neutral-300" />
                  <span className="text-neutral-400">—</span>
                </button>
              )}
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-neutral-100 ${
                    o.value === value ? 'bg-neutral-50 font-semibold' : ''
                  }`}
                  onClick={() => pick(o.value)}
                >
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: o.color }} />
                  <span className="text-neutral-700">{o.label}</span>
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
