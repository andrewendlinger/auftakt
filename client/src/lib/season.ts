/**
 * The window's season pin. With several windows on one server, "the" season stopped being a
 * server-global: each window pins its season here and http() (api/client.ts) sends it as
 * X-Auftakt-Season on every request. sessionStorage is the right store — per-BrowserWindow
 * (and per-tab), survives a reload, dies with the window — the same mechanism the boot
 * gate in index.html uses.
 *
 * Nothing else may read the storage key or call api.activateSeason directly: switching goes
 * through switchSeason() (window-local + moves the default for future windows), and a pin
 * whose season was deleted comes back through seasonGone() → the landing page.
 */

// Deliberate import cycle with api/client.ts (which imports the pin accessors): both sides
// touch the other only inside function bodies, never during module evaluation.
import { api } from '../api/client';
import { postBroadcast } from './broadcast';

const KEY = 'auftakt-season';
/** Relay for the „Saison wurde gelöscht" toast — a toast cannot survive the reload. */
const GONE_KEY = 'auftakt-season-gone';

function storage(): Storage | null {
  // Absent in node-env unit tests that transitively import this module; try/catch for the
  // (configurable) browser states where touching sessionStorage itself throws.
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** The pinned season id, or null when unpinned (garbage tolerated as unpinned). */
export function getWindowSeason(): number | null {
  const raw = storage()?.getItem(KEY);
  if (!raw) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function setWindowSeason(id: number): void {
  storage()?.setItem(KEY, String(id));
}

export function clearWindowSeason(): void {
  storage()?.removeItem(KEY);
}

/**
 * Adopt the server's echo — but only when unpinned. Every response names the season it
 * resolved to; a fresh window's pre-pin requests all resolved to the same default, so the
 * first echo pins the window consistently without an extra bootstrap request. Once pinned,
 * later echoes (all equal to what we sent) must not overwrite a switch in flight.
 */
export function pinFromResponse(header: string | null): void {
  if (header === null || getWindowSeason() !== null) return;
  const id = Number(header);
  if (Number.isInteger(id) && id > 0) setWindowSeason(id);
}

/**
 * Set by seasonGone() in the document it is navigating away from — module state, so the
 * reloaded document starts false again. sessionStorage cannot express this: both documents
 * share it, and „which document am I" is exactly the question.
 */
let leaving = false;

/**
 * This window's season no longer exists (a 410 — deleted, possibly from another window):
 * drop the pin, leave the toast relay flag and start over on the landing page, where the
 * next requests resolve the default season.
 */
export function seasonGone(): void {
  const s = storage();
  // A dashboard refetches ~10 queries at once, so the 410s land as a burst and every one
  // of them calls this; the flag makes the burst one reload instead of a navigation storm.
  if (s?.getItem(GONE_KEY)) return;
  clearWindowSeason();
  s?.setItem(GONE_KEY, '1');
  leaving = true;
  window.location.replace('#/');
  window.location.reload();
}

/**
 * Read-and-clear the relay flag; true exactly once after a seasonGone() reload.
 *
 * Never in the document seasonGone() just left. That document is not dead yet: the hash-only
 * `replace('#/')` above fires a hashchange, HashRouter mounts LandingPage in it, and its
 * effect read the flag a beat before the reload wiped the toast off the screen — so the flag
 * was spent, the reloaded document had nothing to say, and the user arrived on the landing
 * page with no explanation of why. Whether that happened at all was a race between React's
 * effect flush and the navigation commit, which is why it only sometimes swallowed the toast.
 */
export function consumeSeasonGone(): boolean {
  if (leaving) return false;
  const s = storage();
  if (!s?.getItem(GONE_KEY)) return false;
  s.removeItem(GONE_KEY);
  return true;
}

/**
 * The whole database changed — reload the app at the dashboard so every view
 * refetches against the newly chosen season. The server keeps running (no restart).
 *
 * `replace`, not an assignment to `location.hash`: assigning *pushes* a history entry, so the
 * route the user was on before the switch survived the reload and one Back re-resolved that
 * deep link against the new season's database — a different artist under the same id, or (the
 * common case, since a new season copies no artists by default) a spinner that never resolves,
 * with the header still naming the new season (SHL-09). Both calls are needed: replacing a
 * hash-only URL does not reload the document.
 */
export function reloadToDashboard(): void {
  // Never over a recovery. seasonGone() has already sent this document to the landing page,
  // and replacing that with '#/dashboard' is what stopped LandingPage from ever mounting —
  // relay flag unconsumed, every later 410 in the window swallowed by the burst guard
  // (PR50-01). The guard sits here, on the navigation, because that is where the harm is.
  if (leaving) return;
  window.location.replace('#/dashboard');
  window.location.reload();
}

/**
 * Switch THIS window to another season — the only legal way to change seasons from the
 * client. Window-local: other windows keep their own pins and are merely nudged to refresh
 * their season lists. The reload is mandatory, not an optimisation — a fresh document means
 * a fresh QueryClient, which is why per-window caches never need season-prefixed keys.
 */
export async function switchSeason(id: number): Promise<void> {
  setWindowSeason(id);
  // Moving the DEFAULT (what new windows and headerless callers resolve) is best-effort:
  // the local switch above cannot fail, so a rejected activate — a server mid-restart —
  // must not block it. The SHL-13 silence this call used to guard against (app stuck on
  // the old season, nothing said) is structurally gone: the pin IS the switch. Awaited
  // before the reload, because a fetch fired from an unloading document is cancelled.
  try {
    await api.activateSeason(id);
  } catch {
    /* keep the local switch */
  }
  // Unless a 410 landed in this document while we were away — this activate's own (the season
  // clicked was already deleted), or any query that raced it. seasonGone() has then dropped the
  // pin and sent the document to the landing page, and everything below would talk over that
  // recovery: the broadcast is about a switch that did not happen, and the reload would send a
  // window that must land on '#/' to '#/dashboard' instead (PR50-01). Keyed on the recovery
  // having started, not on the shape of our own rejection, because the 410 need not be ours.
  if (leaving) return;
  // Other windows refresh their ['seasons'] markers (the default moved); their pins stay.
  postBroadcast({ v: 1, type: 'invalidate' });
  reloadToDashboard();
}
