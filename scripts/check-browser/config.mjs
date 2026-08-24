/**
 * The constants the whole gate is measured against: the two ports, the run's own tag, and the
 * three waits that are decisions rather than guesses.
 *
 * In a module of its own because everything else here imports from it and it imports nothing —
 * which is what keeps `stack.mjs` and `browser.mjs` free of a cycle.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Two levels up, not one: this file sits in `scripts/check-browser/`, not in `scripts/`. */
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// 4317 is the dev server, 4319/4321/4323 belong to check:backup/check:dates/check:api. The
// client cannot move: ALLOWED_ORIGINS is built from CLIENT_DEV_PORT = 5317, so a Vite on any
// other port makes every write fail with a bare 403 that reads exactly like a broken feature.
export const PORT = 4325;
export const UI = 'http://localhost:5317';
export const API = `http://localhost:${PORT}/api`;

export const RUN = Date.now().toString(36).slice(-5);
/**
 * The „nothing found" arm of an optional chain used as a needle. A bare `''` would make every
 * `includes` and every `hasText` match *everything*, so a fixture that had gone missing would
 * report itself as present — this makes it report itself as missing instead.
 */
export const NO_MATCH = 'kein solcher Eintrag';

/**
 * How long a dialog or an inline editor may take to leave the screen after its write has already
 * landed on the server — and why the landing cases wait for that rather than for the server.
 *
 * Every write on `#/` resolves only after a blanket `invalidate()`, and the surfaces that own the
 * gesture close on *that* promise: `RecordFormModal` closes when `useGuardedAction` returns,
 * `InlineInput` calls `onDone` when the write resolves. `invalidate()` refetches every active
 * query of its page **and broadcasts**, so every other window refetches too — and this gate keeps
 * a run's worth of windows open against one Express process. Measured on a throttled run with 24
 * pages: the server had the row after ~200 ms and the dialog stayed up **20 s**; the rename's
 * input stayed open **5.6 s** past the server. On the CI runner both are longer.
 *
 * So „the server has it" is not „the gesture is finished", and a case that proceeds on the former
 * clicks into a backdrop (AQ: `saisons: keine`) or reads a heading whose text is inside an open
 * `<input>` and therefore empty (AS: „ / ABLAGE …"). Both are how this slice failed on CI while
 * being green locally 40 times.
 *
 * **And it cannot simply be waited out.** Measured on the runner: sixty seconds was not enough for
 * either, with **no error toast** beside it — so the write was not refused, it was *unsettled*.
 * Chromium holds ~6 sockets to one origin for the whole browser, this gate keeps ~30 windows open,
 * and every invalidate fans out over all of them; a refetch can queue behind a hundred others.
 * Twenty seconds is therefore a *decision point*, not a ceiling: past it, `surfaceSettled` takes
 * the page the way a user would — a reload — and says which route it took in the failure detail.
 */
export const EDITOR_GONE_MS = 20_000;
/** The same allowance for the polls that read what an editor's close reveals. */
export const SETTLED_MS = 25_000;
/** Every fixture season carries this prefix, so `finally` can sweep leftovers of a killed run. */
export const FIXTURE = 'check:browser';
