import { useRef } from 'react';

/**
 * The next item in a wrapping group, or `-1` when there is nothing to move to.
 *
 * Split out of the hook so `check:unit` can reach it: the wrap is the part that is easy to get
 * subtly wrong (`(at + delta) % len` walks off the front, `-1 % 5` is `-1` in JavaScript), and it
 * is the part with no DOM in it.
 */
export function stepIndex(at: number, delta: number, len: number): number {
  if (len <= 0) return -1;
  // Focus is somewhere else in the group's container — start at whichever end we are heading for.
  if (at < 0) return delta > 0 ? 0 : len - 1;
  return (at + delta + len) % len;
}

/**
 * One tab stop for a group of equivalent buttons; the arrow keys walk it.
 *
 * A row of pills, a grid of emoji or of colour swatches is *one* control that happens to be drawn
 * as a dozen buttons, and Tab treated every one of them as a stop: the „Spalte bearbeiten" dialog
 * put seventeen between the Name field and the options below it, and the link dialog's categories
 * cost one press each. The rich-text toolbar solved this for itself by opting out of the tab order
 * entirely (`tabIndex={-1}` on every button), which works because its buttons have a keyboard
 * route of their own. These have none, so they get the standard one instead: exactly one item is
 * tabbable, and ←/→/↑/↓ move focus inside the group.
 *
 * The tabbable item is the **selected** one (the first, when nothing is selected) rather than the
 * last focused one — no state, and Tab back into the group lands on the current value rather than
 * wherever the user last looked. Arrows only move focus; picking stays with the button's own
 * click/Enter/Space, so an arrow can never write a value in passing (the same rule that keeps
 * `PillSelect`'s Tab from committing, RTE-11).
 *
 * Both directions are accepted for „next" because these groups wrap: a flex-wrapped pill row is a
 * line or three depending on the label lengths, so → and ↓ have to mean the same thing.
 *
 * Put `ref`/`onKeyDown` on the element that holds **only** the group — an `IconPicker`'s preset
 * grid, not the wrapper it shares with the free-text field, whose ←/→ belong to the caret. The
 * handler stays out of the way regardless: it acts only while focus is on a `[data-roving]` item.
 *
 * `Modal`'s Tab cycle needs no teaching — `tabbables()` filters on `tabIndex >= 0`, so the
 * inactive items drop out of the dialog's cycle by the same mechanism.
 */
export function useRovingFocus<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);

  const onKeyDown = (e: React.KeyboardEvent<T>) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-roving]') ?? []).filter(
      (el) => !el.hasAttribute('disabled'),
    );
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? stepIndex(at, 1, items.length)
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? stepIndex(at, -1, items.length)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? items.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    items[next]?.focus();
  };

  return { ref, onKeyDown };
}

/** Spread onto each button of the group: `<button {...rovingItem(o.value === current)}>`. */
export function rovingItem(active: boolean) {
  return { 'data-roving': '', tabIndex: active ? 0 : -1 };
}
