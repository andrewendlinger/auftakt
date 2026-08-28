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
 * menu scrolls internally), following the anchor when a layout reflow moves it, and closing
 * on Escape, page scroll or resize. What it does not own: the trigger, the backdrop and the
 * menu contents — those differ per popover.
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

/**
 * The layer every popover menu renders at — its one source, so the order is decided once.
 *
 * Top → bottom of the app's overlays: the boot splash (`z-index:9999` in `index.html`), the
 * announcement overlay (`z-[60]`), **the popover menus (`z-[55]`)**, the toast stack (`z-50`),
 * the `Modal` layer (`z-40`), the menus' click-away backdrops (`z-30`, deliberately left there),
 * the sticky header (`z-20`). A menu the user is actively choosing from outranks a transient
 * toast — a notification must not steal the menu's clicks (#175). See docs/ARCHITECTURE.md.
 */
export const POPOVER_LAYER = 'z-[55]';

const MARGIN = 8;

export function useAnchoredPopover<A extends HTMLElement, M extends HTMLElement>(
  onClose?: () => void,
): AnchoredPopover<A, M> {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PopoverPos | null>(null);
  const anchorRef = useRef<A>(null);
  const menuRef = useRef<M>(null);
  /**
   * Where the anchor sat when the menu was last positioned against it — the reference `onScroll`
   * below decides against. Kept in a ref rather than in state: nothing renders from it, and it is
   * written from a layout effect that must not schedule a second pass.
   */
  const anchorAtRef = useRef<{ left: number; top: number } | null>(null);
  // Read from listeners registered once per open, so a changing callback never re-binds them.
  const onCloseRef = useRef(onClose);
  const openRef = useRef(open);
  onCloseRef.current = onClose;
  openRef.current = open;

  const openPopover = useCallback(() => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (r) {
      anchorAtRef.current = { left: r.left, top: r.top };
      setPos({ left: r.left, top: r.bottom + 4, minWidth: r.width });
    }
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

  /**
   * Measure the anchor and place the menu against it: flip above when there is more room there,
   * clamp horizontally to stay on screen, cap the height to the space left (the menu scrolls
   * internally). Runs once when the menu mounts and again whenever a reflow moves the anchor (the
   * `ResizeObserver` below). A no-op when the menu is on its way out or not yet mounted, and it
   * returns the previous `pos` unchanged when nothing moved, so a burst of observer callbacks
   * during a reflow does not churn renders.
   */
  const reposition = useCallback(() => {
    if (!openRef.current) return;
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    const r = anchor.getBoundingClientRect();
    anchorAtRef.current = { left: r.left, top: r.top };
    const spaceBelow = window.innerHeight - r.bottom - MARGIN;
    const spaceAbove = r.top - MARGIN;
    const flipUp = menu.scrollHeight > spaceBelow && spaceAbove > spaceBelow;
    const maxHeight = Math.max(80, Math.floor(flipUp ? spaceAbove : spaceBelow));
    const left = Math.max(MARGIN, Math.min(r.left, window.innerWidth - menu.offsetWidth - MARGIN));
    const top = flipUp
      ? Math.max(MARGIN, r.top - 4 - Math.min(menu.scrollHeight, maxHeight))
      : r.bottom + 4;
    setPos((prev) =>
      prev && prev.left === left && prev.top === top && prev.minWidth === r.width && prev.maxHeight === maxHeight
        ? prev
        : { left, top, minWidth: r.width, maxHeight },
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    /**
     * A page scroll invalidates the anchor rect — but a scroll *inside* the menu is its own
     * `overflow-y-auto` doing its job and must not close it.
     *
     * **And neither must a scroll nobody performed (WP-83).** The task table's wrapper is
     * `overflow-x-auto`, and an inline editor is wider than the value it commits
     * (`InlineInput` is `min-w-48`, the date cell `w-40`), so the moment an editor closes the
     * table gets ~70–150 px narrower. When the wrapper is scrolled to its right-hand end — which
     * it is whenever the user has reached one of the last columns — the browser has to pull
     * `scrollLeft` back into range, and *that* is dispatched as a `scroll` event with no user
     * behind it. `InlineInput` only closes once its write's blanket `invalidate()` resolves, so
     * with several windows open that arrives seconds later, landing on whatever popover happens
     * to be open. Measured on `#/project/2`: `editor-` at 217 ms, `scroll` (wrapper, left
     * 269 → 200, scrollWidth 1501 → 1432) at 229 ms, the menu gone at 238 ms.
     *
     * The tell is that the anchor does **not** move: the table shrinks by exactly what the clamp
     * takes back, so a pill to the right of the shrink stays where it was — measured at 0 px in
     * both axes. So the rule is not „did something scroll" but „did the menu come loose from its
     * anchor": re-measure, and only close when the pill has actually gone somewhere. A real page
     * scroll still moves it, and still closes the menu.
     */
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      const now = anchorRef.current?.getBoundingClientRect();
      const was = anchorAtRef.current;
      // Half a pixel: below that nothing has visibly moved, and sub-pixel layout noise is not a
      // reason to take a menu away from someone mid-choice. No anchor at all means the trigger has
      // gone — close, the way this always did.
      if (now && was && Math.abs(now.left - was.left) < 0.5 && Math.abs(now.top - was.top) < 0.5) return;
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
    /**
     * A layout reflow can move the anchor with no scroll behind it — a column left of it in the
     * task table's `overflow-x-auto` wrapper narrows as an inline editor closes, and when the
     * wrapper needs no `scrollLeft` clamp nothing is dispatched at all (#176). `onScroll` never
     * runs, so the menu would sit frozen where it opened, now detached from its button. A
     * `ResizeObserver` fills exactly that gap: it fires on the reflow and never on a scroll, so the
     * menu follows the anchor here while a real scroll still closes it above. The wrapper keeps its
     * own width when an inner column shrinks — the element that resizes is the `<table>`, which is
     * on the anchor's ancestor path — so we watch the anchor and every ancestor up to and including
     * its nearest scrollable one.
     */
    const ro = new ResizeObserver(() => reposition());
    const anchorEl = anchorRef.current;
    if (anchorEl) {
      ro.observe(anchorEl);
      for (let el = anchorEl.parentElement; el; el = el.parentElement) {
        ro.observe(el);
        const s = getComputedStyle(el);
        if (/auto|scroll/.test(s.overflowX + s.overflowY)) break;
      }
    }
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', closePopover);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', closePopover);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, closePopover, reposition]);

  const toggle = useCallback(() => {
    if (openRef.current) closePopover();
    else openPopover();
  }, [closePopover, openPopover]);

  return { open, anchorRef, menuRef, pos, openPopover, closePopover, toggle };
}
