/**
 * The app's half of the boot handshake.
 *
 * The boot screen lives in `client/index.html`, outside the bundle, because it has to be
 * on screen before any of this code exists. It holds a still frame until the app says it
 * is ready, and only then plays the Auftakt gesture — the whole point being that the
 * gesture never animates while the renderer is busy parsing the bundle and mounting
 * React. This module is what it listens to.
 *
 * Deliberately framework-free and dependency-free: the overlay's inline script must be
 * able to consume it with no knowledge of React, and this must keep working if the tree
 * above it collapses.
 *
 * Two signals rather than one, because they answer different questions:
 *
 *   mounted — React has committed and a frame has been presented. Enough to reveal the
 *             app if the user is impatient and clicks; not enough to start animating.
 *   ready   — mounted, the bootstrap queries have settled (or given up), and the main
 *             thread had an idle slot. The gesture waits for this.
 *
 * Each is published twice: as an event for the overlay, and as a `<html>` attribute.
 * The attribute is not redundant — it is the only form a Playwright script can poll, and
 * it survives being set before anyone subscribed.
 */

let mounted = false;
let ready = false;

function mark(signal: 'mounted' | 'ready'): void {
  const el = document.documentElement;
  if (signal === 'mounted') el.dataset.appMounted = '1';
  else el.dataset.appReady = '1';
  document.dispatchEvent(new Event(`auftakt:${signal}`));
}

/** React has committed once and the browser has painted it. Idempotent. */
export function signalMounted(): void {
  if (mounted) return;
  mounted = true;
  mark('mounted');
}

/**
 * The app is as ready as it is going to get. Idempotent, and implies `mounted` — the
 * failure paths (a throw above the ErrorBoundary, a caught render error) jump straight
 * here without a healthy mount ever happening, and the overlay must still come down.
 */
export function signalReady(): void {
  signalMounted();
  if (ready) return;
  ready = true;
  mark('ready');
}

/**
 * Ready, but by collapsing rather than by finishing.
 *
 * The overlay has to come down for a dead app exactly as it does for a live one, so the
 * failure paths cannot simply stay silent — but plain `signalReady()` was indistinguishable
 * from a healthy boot, and the overlay answered a window that had just thrown away its
 * whole tree with a full three seconds of celebration before revealing the blank. The flag
 * goes up *before* the event so the overlay's synchronous listener sees it, and it is an
 * attribute rather than an event argument because that is the form the inline script in
 * `client/index.html` can read without knowing anything about this module.
 */
export function signalFailed(): void {
  document.documentElement.dataset.appFailed = '1';
  signalReady();
}

/** Test seam. The signals are module state, which no test should carry between cases. */
export function resetBootSignalsForTest(): void {
  mounted = false;
  ready = false;
  delete document.documentElement.dataset.appMounted;
  delete document.documentElement.dataset.appReady;
  delete document.documentElement.dataset.appFailed;
}
