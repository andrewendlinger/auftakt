/**
 * The three probes a case runs *inside* the page: where the focus sits, what overflows, and what
 * a sweep of injected markup does to the layout.
 */
/**
 * Where the focus sits **in the topmost dialog's own tab order** — the index into exactly the list
 * `Modal`'s trap walks, so the WP-42 promises can be asserted as positions instead of as element
 * names that a re-worded button would break.
 *
 * `at: -1` is the answer that matters: focus is on `<body>`, on the page behind the backdrop, or
 * in a portal — all three are „the trap let go", and the first is the state the focus effect
 * exists to prevent. Index 0 is always the header's ✕, so „the dialog focused its first *field*"
 * is `at === 1` and „the forward wrap skipped the ✕" is a walk that never returns to 0.
 *
 * The filter is `tabbables()`'s from `client/src/components/fields.tsx`: a positive `tabIndex`
 * exists nowhere in this app, `[inert]` drops the form while „Änderungen verwerfen?" is up, a
 * disabled „Speichern" would otherwise make the cycle wrap one element early, and
 * `getClientRects()` drops what is rendered but not shown.
 */
export const tabStop = (page) =>
  page.evaluate(() => {
    // The **last** card, not the first: a Modal opened out of another one is rendered inside it
    // (`CustomColumnManager`'s „ausblenden/löschen" questions), so document order puts the
    // topmost last. A `PillSelect` menu's click-away layer is a `.fixed.inset-0` with no card
    // in it and never matches here.
    const card = [...document.querySelectorAll('.fixed.inset-0 > div')].pop() ?? null;
    const items = card
      ? Array.from(
          card.querySelectorAll(
            'a[href], button, input, select, textarea, [contenteditable="true"], [tabindex]',
          ),
        ).filter(
          (el) =>
            /** @type {HTMLElement} */ (el).tabIndex >= 0 &&
            !el.hasAttribute('disabled') &&
            !el.closest('[inert]') &&
            el.getClientRects().length > 0,
        )
      : [];
    // No `activeElement` at all is the same answer as one that is not in the list: `-1`, „the trap
    // let go". Spelled out rather than left to `indexOf(null)` finding nothing, which reads like a
    // near miss when it is the plainest case of all.
    const active = document.activeElement;
    const at = active ? items.indexOf(active) : -1;
    const el = items[at];
    return {
      at,
      n: items.length,
      tag: el?.tagName ?? document.activeElement?.tagName ?? 'BODY',
      text: (el?.textContent ?? '').trim().slice(0, 24),
    };
  });

/**
 * „Is anything on this page out of reach at this width?" — evaluated inside the page, so both
 * halves sample one layout. Serialised to Chromium by `page.evaluate`, so it may close over
 * nothing but the DOM.
 *
 * The first half is `documentElement.scrollWidth <= clientWidth`. On its own it is not enough:
 * an element that overhangs inside a box that *clips* never grows the document at all, so a page
 * would pass while a card row is cut off and unreachable — which is the WP-55 defect class this
 * case exists for.
 *
 * The second half is the sweep, and what it has to get right is **why** a box may be wider than
 * the window. Three verdicts, taken at the nearest ancestor that constrains the horizontal axis:
 *
 * - `auto` / `scroll` → the content is reachable by scrolling, which is exactly what the task
 *   table does by design (WP-55). Exempt. Note that a box with `overflow-y: auto` and nothing set
 *   on x computes to `auto` on x as well (CSS: a `visible` paired with a non-`visible` becomes
 *   `auto`), so every dialog and popover with a vertical scroller exempts its subtree too. That
 *   is still „reachable by scrolling", but it is the sweep's blind spot and worth knowing.
 * - `hidden` / `clip` → the box cuts the content off instead of offering it. Reported, but only
 *   when the element really is cut: an element that fits *inside* its clipper is fine, and if the
 *   clipper itself overhangs the window then the clipper is the offender and reports itself on
 *   its own turn through the loop.
 * - nothing at all → the element is simply wider than the page. Reported.
 */
export function overflowReport() {
  const de = document.documentElement;
  const vw = de.clientWidth;
  /** @type {string[]} */
  const offenders = [];
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const r = el.getBoundingClientRect();
    // A zero box is `hidden`, a collapsed wrapper or an unmounted portal — never an overhang.
    if (r.width === 0 || r.height === 0) continue;
    // One pixel of slack: a fractional layout width rounds up against an integer viewport.
    if (r.right <= vw + 1) continue;
    let verdict = 'page';
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'visible') continue;
      if (ox === 'auto' || ox === 'scroll' || ox === 'overlay') {
        verdict = 'scrollbar';
        break;
      }
      verdict = r.right <= p.getBoundingClientRect().right + 1 ? 'inside' : 'cut';
      break;
    }
    if (verdict === 'scrollbar' || verdict === 'inside') continue;
    const id = el.id ? `#${el.id}` : '';
    const cls =
      typeof el.className === 'string' && el.className
        ? `.${el.className.split(' ').slice(0, 2).join('.')}`
        : '';
    offenders.push(
      `${el.tagName.toLowerCase()}${id}${cls} bis ${Math.round(r.right)}${verdict === 'cut' ? ' (abgeschnitten)' : ''}`,
    );
  }
  return { scrollWidth: de.scrollWidth, clientWidth: vw, offenders };
}

/**
 * Hang a probe off `body`, measure it with **the shipped sweep**, take it away again.
 *
 * The measurement has to go through `overflowReport` itself rather than through a second copy of
 * its loop: a control that re-implements the thing it is controlling validates the copy. The
 * function closes over nothing, so `page.evaluate` can serialise it as it stands.
 */
export async function sweepWithProbe(page, markup) {
  await page.evaluate((html) => {
    const host = document.createElement('div');
    host.id = 'auftakt-probe-host';
    host.innerHTML = html;
    document.body.appendChild(host);
  }, markup);
  const report = await page.evaluate(overflowReport);
  await page.evaluate(() => document.getElementById('auftakt-probe-host')?.remove());
  return report;
}

/** `staleTime: 5_000` — a focus inside five seconds of the last fetch legitimately refetches nothing. */
export const STALE_MS = 5_000;
