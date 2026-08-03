import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * An anchored popover that cannot be clipped by its surroundings.
 *
 * Both of the app's popovers hang off a control inside the task table, whose wrapper is
 * `overflow-x-auto` — so a plain `absolute` menu is cut off by the container's edge whenever
 * the table is short, and the last row of the popover becomes unreachable. `PillSelect` solved
 * that with a portal and fixed positioning; `ColorSwatchPicker` did not, and also had no
 * Escape (RTE-13). The logic lives here so there is one implementation rather than two, the
 * second of them weaker.
 *
 * What it owns: measuring the anchor, flipping above it when there is more room there,
 * clamping horizontally to stay on screen, capping the height to the space available (the
 * menu scrolls internally), and closing on Escape, page scroll or resize. What it does not
 * own: the trigger, the backdrop and the menu contents — those differ per popover.
 *
 * Rendering is two-phase by design: `pos` is seeded from the anchor rect before the portal
 * mounts, then refined once the menu is in the DOM and can be measured.
 */

export interface PopoverPos {
  left: number;
  top: number;
  minWidth: number;
  maxHeight?: number;
}

export interface AnchoredPopover<A extends HTMLElement, M extends HTMLElement> {
  open: boolean;
  /** Attach to the trigger — the rect the menu is positioned against. */
  anchorRef: React.RefObject<A | null>;
  /** Attach to the menu element itself, so it can be measured and scroll-tested. */
  menuRef: React.RefObject<M | null>;
  /** Non-null exactly when the menu should render. */
  pos: PopoverPos | null;
  openPopover: () => void;
  /** Close it. `onClose` runs first, so a caller can commit a draft on the way out. */
  closePopover: () => void;
  toggle: () => void;
}

const MARGIN = 8;

export function useAnchoredPopover<A extends HTMLElement, M extends HTMLElement>(
  onClose?: () => void,
): AnchoredPopover<A, M> {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PopoverPos | null>(null);
  const anchorRef = useRef<A>(null);
  const menuRef = useRef<M>(null);
  // Read from listeners registered once per open, so a changing callback never re-binds them.
  const onCloseRef = useRef(onClose);
  const openRef = useRef(open);
  onCloseRef.current = onClose;
  openRef.current = open;

  const openPopover = useCallback(() => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, top: r.bottom + 4, minWidth: r.width });
    openRef.current = true;
    setOpen(true);
  }, []);

  /** Idempotent: `onClose` may commit a draft, so it must fire exactly once per open. */
  const closePopover = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = false;
    setOpen(false);
    onCloseRef.current?.();
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (anchor && menu) {
      const r = anchor.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom - MARGIN;
      const spaceAbove = r.top - MARGIN;
      const flipUp = menu.scrollHeight > spaceBelow && spaceAbove > spaceBelow;
      const maxHeight = Math.max(80, Math.floor(flipUp ? spaceAbove : spaceBelow));
      const left = Math.max(MARGIN, Math.min(r.left, window.innerWidth - menu.offsetWidth - MARGIN));
      const top = flipUp
        ? Math.max(MARGIN, r.top - 4 - Math.min(menu.scrollHeight, maxHeight))
        : r.bottom + 4;
      setPos({ left, top, minWidth: r.width, maxHeight });
    }
    // A page scroll invalidates the anchor rect — but a scroll *inside* the menu is its own
    // `overflow-y-auto` doing its job and must not close it.
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      closePopover();
    };
    /**
     * Escape is caught here rather than with a React `onKeyDown` on the menu, because focus is
     * not necessarily inside it — `ColorSwatchPicker` opens from a click and leaves focus on
     * the trigger, so a React handler on the menu would never see the key at all.
     *
     * Capture phase on `window`, so it runs before `Modal`'s bubble-phase listener and can
     * stop it: dismissing a popover inside a dialog must not dismiss the dialog. The
     * `preventDefault` is belt-and-braces — `Modal` also checks `defaultPrevented`.
     */
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closePopover();
      anchorRef.current?.focus();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', closePopover);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', closePopover);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, closePopover]);

  const toggle = useCallback(() => {
    if (openRef.current) closePopover();
    else openPopover();
  }, [closePopover, openPopover]);

  return { open, anchorRef, menuRef, pos, openPopover, closePopover, toggle };
}
