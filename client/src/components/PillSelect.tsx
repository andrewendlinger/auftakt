import { useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { contrastText } from '../lib/colors';
import { useAnchoredPopover } from '../lib/popover';
import type { CustomColumnOption } from '../api/types';
import { ChevronRightIcon } from './icons';

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
  muted = false,
}: {
  value: string;
  options: CustomColumnOption[];
  onChange: (v: string) => void;
  allowEmpty?: boolean;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Grey the trigger out — a done task's row (WP-58). The pill's colour comes from the inline
   * `style` below, which no Tailwind text class can outrank, so the only thing that reaches it
   * is a filter. It stays on the trigger and never on the menu: the options are the palette the
   * user is choosing from, and greying those would be a lie about what they will get.
   */
  muted?: boolean;
}) {
  const {
    open,
    pos,
    anchorRef: btnRef,
    menuRef,
    openPopover,
    closePopover,
  } = useAnchoredPopover<HTMLButtonElement, HTMLDivElement>();
  const current = options.find((o) => o.value === value);

  /** Close and hand focus back to the pill, so the keyboard user is where they started. */
  const close = () => {
    closePopover();
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

  // Focus lands on the current option, not the top of the list, so ↑/↓ start from where the
  // value already is — the behaviour the native select had. Positioning is the popover hook's.
  useLayoutEffect(() => {
    if (!open) return;
    const items = optionEls();
    (items.find((el) => el.dataset.value === value) ?? items[0])?.focus();
  }, [open, value]);

  return (
    <div className="inline-block">
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? closePopover() : openPopover())}
        onKeyDown={(e) => {
          if (open || disabled) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            openPopover();
          }
        }}
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition hover:brightness-95 disabled:cursor-default ${
          muted ? 'opacity-60 grayscale' : ''
        }`}
        style={
          current
            ? { background: current.color, color: contrastText(current.color) }
            : { background: '#f1f5f9', color: '#94a3b8' }
        }
      >
        {current ? current.label : placeholder}
        {!disabled && <ChevronRightIcon className="h-3 w-3 rotate-90 opacity-60" />}
      </button>
      {open &&
        !disabled &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-30" onClick={closePopover} />
            <div
              ref={menuRef}
              role="listbox"
              className="fixed z-40 min-w-36 overflow-y-auto rounded-xl bg-white p-1 shadow-lg ring-1 ring-black/10"
              style={{ left: pos.left, top: pos.top, minWidth: pos.minWidth, maxHeight: pos.maxHeight }}
              onKeyDown={(e) => {
                // Escape is the popover hook's — it needs a capture-phase window listener,
                // because not every popover has focus inside its menu.
                if (e.key === 'ArrowDown') {
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
