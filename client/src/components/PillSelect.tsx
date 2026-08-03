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
 *
 * Replacing a `<select>` means re-implementing the keyboard contract it came with, and none
 * of it was there: no Escape, no arrow keys, no focus moved into the menu, no listbox roles.
 * Because the menu portals to `document.body`, its options sat at the very end of the tab
 * order behind the entire rest of the page, so Tab from the pill walked to the next cell
 * control instead — and the menu, with its full-screen backdrop, stayed open over the table
 * (RTE-11). Escape, ArrowUp/ArrowDown/Home/End, Enter and focus return are below.
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
  /** Close and hand focus back to the pill, so the keyboard user is where they started. */
  const close = () => {
    setOpen(false);
    btnRef.current?.focus();
  };
  const pick = (v: string) => {
    close();
    if (v !== value) onChange(v);
  };

  const optionEls = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
  const moveFocus = (delta: number) => {
    const items = optionEls();
    if (!items.length) return;
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = at < 0 ? (delta > 0 ? 0 : items.length - 1) : (at + delta + items.length) % items.length;
    items[next]?.focus();
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
      // Focus lands on the current option, not the top of the list, so ↑/↓ start from where
      // the value already is — the behaviour the native select had.
      const items = optionEls();
      (items.find((el) => el.dataset.value === value) ?? items[0])?.focus();
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
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(e) => {
          if (open || disabled) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            openMenu();
          }
        }}
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
              role="listbox"
              className="fixed z-40 min-w-36 overflow-y-auto rounded-xl bg-white p-1 shadow-lg ring-1 ring-black/10"
              style={{ left: pos.left, top: pos.top, minWidth: pos.minWidth, maxHeight: pos.maxHeight }}
              onKeyDown={(e) => {
                // Escape must not travel on: a `Modal` listens for it on window and would
                // close the whole dialog instead of just this menu.
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  close();
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  moveFocus(1);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  moveFocus(-1);
                } else if (e.key === 'Home' || e.key === 'End') {
                  e.preventDefault();
                  const items = optionEls();
                  (e.key === 'Home' ? items[0] : items[items.length - 1])?.focus();
                } else if (e.key === 'Tab') {
                  // The portal sits at the end of the document, so Tab out of it lands
                  // nowhere useful — treat it as "done here" instead.
                  e.preventDefault();
                  close();
                }
              }}
            >
              {allowEmpty && (
                <button
                  type="button"
                  role="option"
                  data-value=""
                  aria-selected={value === ''}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-neutral-100 focus:bg-neutral-100 focus:outline-none"
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
                  role="option"
                  data-value={o.value}
                  aria-selected={o.value === value}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-neutral-100 focus:bg-neutral-100 focus:outline-none ${
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
