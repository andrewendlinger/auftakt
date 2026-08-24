/**
 * Chromium, the windows opened in it, and the locators every scenario file reaches for.
 *
 * Every wait and selector here is a trap out of `docs/VERIFYING.md`; each produced a wrong
 * verification result at least once. That file stays the specification — a new trap is written
 * down there first and encoded here second.
 */
import { sleep } from '../lib/wait.mjs';
import { EDITOR_GONE_MS, UI } from './config.mjs';
import { check } from './report.mjs';
import { chromium } from 'playwright-core';

/** The window every case but L runs in — comfortably wider than anything the app needs. */
export const WIDE = { width: 1400, height: 1000 };

/**
 * The two viewports the smallest window the app allows really produces (WP-55, case L).
 *
 * `MINIMUM` is 624×560, but that is the *window*: `useContentSize` is false, so the frame comes
 * off before the renderer sees anything. Driving at 624×560 checks a window nobody has.
 */
export const NARROW = [
  // Windows 11, whose frame a customer's boot log measures at 14×62.
  { label: 'Windows', width: 610, height: 498 },
  // macOS takes nothing off the sides.
  { label: 'macOS', width: 624, height: 532 },
];

/**
 * The width `TaskSortEditor`'s `<select>` has while it still holds nothing but „Spalte wählen…" —
 * measured at both narrow viewports. It is the *stuck* state case L must not measure in, and the
 * reference the precondition there asks to have been left behind; the healthy width is a layout
 * number (412 px at 610, 424 at 624) and deliberately not asserted.
 */
export const PLACEHOLDER_SELECT_PX = 181;

/**
 * One context per window *size*. `reducedMotion: 'reduce'` is the documented escape hatch: it
 * removes the boot overlay outright (DECISIONS.md) instead of racing its phases. The overlay does
 * not exist on the dev server anyway, but row animations do.
 *
 * A second context is only ever *wrong* for the cross-window cases — see `windows`, where the
 * whole point is that BroadcastChannel is partitioned per context. A viewport is the one thing
 * that cannot be shared, and `setViewportSize` on a page laid out at 1400 measures a reflow
 * rather than a first layout, which is not the state a user's window is ever in.
 */
export const windowContext = (browser, viewport) =>
  browser.newContext({ reducedMotion: 'reduce', viewport });

export async function launch() {
  const browser = await chromium.launch();
  return { browser, context: await windowContext(browser, WIDE) };
}

/** Interactive, not `networkidle` — which lies when a query 500s or hangs. */
export const ready = (page, timeout = 20_000) =>
  page.waitForSelector('html[data-app-ready]', { timeout }).then(() => page);

/**
 * `#/dashboard` is Übersicht; bare `#/` is the season landing page — different screens.
 *
 * `prepare` runs on the fresh page *before* the first navigation, which is the only moment an
 * init script can be installed — `stubElectron` below has to be in place before the renderer
 * looks for `window.auftakt`, and a page that has already loaded cannot be given one.
 */
export async function open(context, hashPath = '/dashboard', prepare) {
  const page = await context.newPage();
  page.on('pageerror', (e) => check(`no page error (${hashPath})`, false, e.message));
  if (prepare) await prepare(page);
  await page.goto(`${UI}/#${hashPath}`);
  return ready(page);
}

/**
 * Several Electron-shaped windows: one context, N pages. Never `newContext()` twice —
 * BroadcastChannel is partitioned per context, so a cross-window check against two contexts
 * passes vacuously, nothing having been delivered and nothing expected.
 */
export async function windows(context, n = 2, hashPath = '/dashboard') {
  const pages = [];
  for (let i = 0; i < n; i++) pages.push(await open(context, hashPath));
  return pages;
}

/**
 * Pin a window to a season. The pin — and the fresh QueryClient that goes with it — apply only
 * with a *document* reload; a hash `goto` after setting it renders the old season's cache and
 * reads as "pinning is broken" against working code.
 */
export async function pin(page, id, hashPath = '/dashboard') {
  await page.evaluate((v) => sessionStorage.setItem('auftakt-season', v), String(id));
  await page.goto(`${UI}/#${hashPath}`);
  await page.reload();
  return ready(page);
}

export const seasonPin = (page) => page.evaluate(() => sessionStorage.getItem('auftakt-season'));

/** The header switcher's chip, minus its ▾. */
export const chip = async (page) =>
  (await page.locator('button[title$="wechseln"]').first().innerText()).replace('▾', '').trim();

/**
 * Toasts stack and hold 6 s, so filter by the text under test — never `.first()`, never a sleep.
 *
 * Six seconds is also a *deadline*: `ToastProvider` dismisses on a plain `setTimeout` and hovering
 * does not pause it, so anything that has to click a toast's own button must do so before the
 * assertions that merely read the state it announced.
 */
export const toast = (page, re) => page.locator('.pointer-events-auto').filter({ hasText: re });

/**
 * A card, addressed by text it contains — `Card` is the app's `div.rounded-2xl`, and the headings
 * inside it are CSS-uppercased, so `hasText` (case-insensitive, substring) is the handle that
 * survives that. Every selector inside a settings card goes through this rather than through the
 * page: „Speichern", `input[type="number"]` and `<select>` are all ambiguous on a tab that holds
 * four cards.
 */
export const cardWith = (page, text) => page.locator('div.rounded-2xl').filter({ hasText: text });

/**
 * The topmost dialog. Every `Modal` is a `div.fixed.inset-0` and the newest is the last of them.
 *
 * Scoping to it is not tidiness: the task table's row 🗑 carries `title="Löschen"`, so a page-wide
 * button selector is ambiguous on any page that has tasks on it — and this is also what makes
 * „Löschen" addressable inside *two stacked* dialogs.
 */
export const topDialog = (page) => page.locator('.fixed.inset-0').last();

/**
 * „It is there" — and the reason it is a wait rather than a `count()`.
 *
 * `ready()` resolves on `html[data-app-ready]`, which `BootReady` also sets from an
 * **unconditional** 700 ms budget (`DATA_BUDGET_MS`, the escape hatch for a first load whose query
 * is retrying), so a page can be „ready" with its queries still in flight. A one-shot count taken
 * straight after `reload()` therefore reads 0 against working code on a slow runner. Wait for the
 * node, then count it.
 */
export const shown = (locator, timeout = 10_000) =>
  locator
    .first()
    .waitFor({ timeout })
    .then(() => true)
    .catch(() => false);

/**
 * „It is gone", as a wait rather than as a count.
 *
 * An undo toast commits a React round *before* the unmount it announces — the toast's setState
 * and TanStack's cache notification land in different batches — so a `count()` read the moment
 * the toast is on screen races the second batch and fails against working code. A locator that
 * matches nothing satisfies `detached` immediately, which is why every caller below asserts the
 * node was there *first*.
 */
export const gone = (locator, timeout = 10_000) =>
  locator
    .first()
    .waitFor({ state: 'detached', timeout })
    .then(() => true)
    .catch(() => false);

/**
 * Click something a broken build may simply not have.
 *
 * Every button a case addresses is one a reverted fix can delete, and an unguarded `click()` on a
 * locator that matches nothing waits out its timeout and then **throws** — which takes the whole
 * run down at the first red instead of letting the assertions after it report. A canary has to go
 * red by assertion, and a canary that removes one button should not hide what the other fourteen
 * still do.
 *
 * Up here beside `shown` and `gone` rather than inside the run: the cases are one `const` scope,
 * so a helper declared among them is in its own temporal dead zone for every case *above* it —
 * and U2, four hundred lines earlier, needs this one too. That reads as
 * „Cannot access 'clickIfThere' before initialization" and ends the run at the case that reached
 * for it.
 */
export const clickIfThere = (locator, timeout = 5000) =>
  locator
    .first()
    .click({ timeout })
    .then(() => true)
    .catch(() => false);

/**
 * Poll `read()` until `ok` accepts the answer, then hand the last value back — the *caller* still
 * makes the assertion, so a run that never reaches the expected state fails with the value that
 * was really there instead of with a bare timeout.
 *
 * Every drag and every undo below is one request behind the gesture that triggered it, and a
 * fixed sleep there is a coin toss in both directions (the scratchpad scripts this gate lifts
 * slept 600 ms after each drag and 200 ms × 20 after an undo).
 *
 * @template T
 * @param {() => Promise<T>} read
 * @param {(v: T) => boolean} ok
 * @returns {Promise<T>}
 */
export async function until(read, ok, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let last = await read();
  while (!ok(last) && Date.now() < deadline) {
    await sleep(150);
    last = await read();
  }
  return last;
}

/** Where a live ⠿ says what it is. The one under a header-click sort says something else — see AT. */
export const HANDLE = '[title^="Zum Verschieben ziehen"]';

/**
 * Press and hold the primary button on a row's ⠿ — the first half of a drag, and the half that
 * decides whether there is one at all.
 *
 * Every reorderer but the arranger's runs `useDragReorder` in `mode: 'armed'`, so the row is not
 * `draggable` until a primary-button `pointerdown` lands on its handle: `locator.dragTo()` on the
 * row body is a silent no-op that reads as „reordering is broken". Match the title with `^=`,
 * never `=` — in a link list *with* categories the tooltip carries the qualifier and an exact
 * match finds nothing.
 *
 * **The return value is the gesture's own report.** A handle that is not there is a legitimate
 * state on one of these surfaces (the task table under a header-click sort renders a *disabled*
 * one with a different tooltip), and an unguarded `boundingBox()` there costs 30 s and then ends
 * the run. So a missing handle reddens a line instead: every case below whose assertion is that
 * *nothing* moved folds this boolean into its check, because „nothing moved" is also what a
 * gesture that never started looks like. Where the assertion is that something did move, the
 * assertion itself is that proof.
 */
export async function grabHandle(page, row, handle = HANDLE, timeout = 5000) {
  // Both bounded: a locator that matches nothing waits out Playwright's 30 s default here as
  // readily as anywhere else, and this function's whole contract is that it *reports* instead.
  await row.scrollIntoViewIfNeeded({ timeout }).catch(() => {});
  await row.hover({ timeout }).catch(() => {}); // `opacity-40` at rest (WP-35), hit-testable either way
  const h = await row
    .locator(handle)
    .first()
    .boundingBox({ timeout })
    .catch(() => null);
  if (!h) return false;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  return true;
}

/**
 * Carry a held pointer onto `target`: interpolated steps, then a 2-px nudge.
 *
 * Both halves are load-bearing. Chromium only turns a press into a native drag once the pointer
 * has actually travelled, so a single `mouse.move` to the destination starts nothing; and the
 * last `dragover` before the release is what sets the drop target, so a move that ends exactly on
 * the previous coordinate can leave `overKey` where the run before it was.
 *
 * The point is the target's *hittable* middle, not its geometric one. A section in „Bereiche
 * bearbeiten" is taller than the window, and the middle of one that has been scrolled up sits
 * behind the app's sticky header (62 px) — `mouse.move` then lands on the header, no `dragover`
 * ever reaches the section, and the release reads exactly like a refused drop. Clamped to the
 * visible band; when the target has nothing in that band the geometric centre is kept, so every
 * short row behaves as it did before.
 */
export async function dragOver(page, target, timeout = 5000) {
  /** The hittable middle, or `null` when nothing of the target is in the band. */
  const aim = () =>
    target
      .first()
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        const top = Math.max(r.top, 110);
        const bottom = Math.min(r.bottom, window.innerHeight - 12);
        return bottom > top ? { x: r.left + r.width / 2, y: (top + bottom) / 2 } : null;
      }, undefined, { timeout })
      .catch(() => null);

  let t = await aim();
  // Nothing in the band means the target is off screen — scroll it in and measure again rather
  // than aiming at a midpoint no pointer can reach. Scrolling mid-drag is fine; Chromium does it
  // itself at the viewport edges.
  if (!t) {
    await target.first().scrollIntoViewIfNeeded({ timeout }).catch(() => {});
    t = await aim();
  }
  // A target that is not there at all is a legitimate state for a case driving a broken build, and
  // an unguarded `evaluate` would wait out its timeout and then **throw** — ending the run with
  // the pointer still down. Report it instead, and let go first: a held button outlives the case.
  if (!t) {
    await page.mouse.up().catch(() => {});
    return false;
  }
  await page.mouse.move(t.x, t.y, { steps: 25 });
  await page.mouse.move(t.x, t.y + 2, { steps: 5 });
  return true;
}

/**
 * The whole gesture: grab the ⠿, carry, release. `false` means it did not happen — no handle to
 * take hold of, or no target to carry to — and in both cases the pointer has been let go again.
 */
export async function dragHandleOnto(page, source, target, handle = HANDLE) {
  if (!(await grabHandle(page, source, handle))) return false;
  if (!(await dragOver(page, target))) return false; // `dragOver` released it
  await page.mouse.up();
  return true;
}

/**
 * `arrayMoveTo` spelled out over ids — the drag semantic („lift `from` out, re-insert it where
 * `to` sits"), so an expectation below is *computed* from the order that was really on screen
 * rather than written down as a literal that a fixture change would quietly invalidate.
 */
export function moveTo(ids, from, to) {
  const i = ids.indexOf(from);
  const j = ids.indexOf(to);
  if (i < 0 || j < 0 || i === j) return ids;
  const next = [...ids];
  next.splice(i, 1);
  next.splice(j, 0, from);
  return next;
}

/**
 * How often `surfaceSettled` had to fall back to a reload. Printed with the summary, because the
 * fallback is the one path here that cannot fail: see there.
 */
export let reloadedSurfaces = 0;

/**
 * Wait for an editing surface to leave the screen, and if it will not, reload the page.
 *
 * „zu" is the surface closing on its own; „neu geladen" is the same screen reached the way a user
 * reaches a window that has been left waiting. What the assertion reads afterwards is the same
 * either way — the page renders from the same server — which is what makes the fallback sound.
 *
 * **„offen" is nearly unreachable, and that is the honest limit of this helper.** Editing state is
 * component-local `useState`, so a reload destroys it by definition: past the fallback `gone()` is
 * true because the whole document is new, not because the editor gave up its write. „offen"
 * therefore reports a *reload that failed*, never the stuck editor it nominally guards — so a
 * genuinely wedged editor would ride through as a green line whose only trace is a word in the
 * detail. Hence the counter: every fallback says so on its own line as it happens and again in the
 * summary, so „this run reloaded its way to green" can never be read as „this run was green".
 */
export const surfaceSettled = async (page, editor) => {
  if (await gone(editor, EDITOR_GONE_MS)) return 'zu';
  reloadedSurfaces++;
  console.log(
    `  ⚠     ein Editor ging ${EDITOR_GONE_MS / 1000} s lang nicht zu — Seite neu geladen ` +
      `(${page.url().replace(UI, '') || '?'})`,
  );
  await page.reload().catch(() => {});
  await ready(page).catch(() => {});
  return (await gone(editor, 10_000)) ? 'neu geladen' : 'offen';
};
