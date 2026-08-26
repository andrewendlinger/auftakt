// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The renderer half of the runtime log (WP-69e). What is worth pinning is everything that
 * happens *before* the bridge is called, because none of it is observable anywhere else: the
 * module keeps its dedupe window and its send budget in module state, so a fresh import per
 * test is the only honest arrangement — hence `fresh()` rather than a top-level import.
 *
 * The bridge itself is a recorder on `window.auftakt`, the same shape the browser gate's stub
 * installs (`scripts/check-browser/bridge.mjs`). Its absence is the other half of the contract
 * and the one every browser-driven run depends on: no `window.auftakt` must mean no throw.
 *
 * Time is faked because the dedupe reads `Date.now()`; `vi.setSystemTime` moves it explicitly
 * rather than through a timer, since the module schedules nothing.
 */

const START = new Date('2026-08-25T10:00:00.000Z').getTime();

/** A fresh module instance — the dedupe map and the send counter start empty. */
async function fresh(): Promise<typeof import('./logEvent')> {
  vi.resetModules();
  return import('./logEvent');
}

/** Install the recording bridge and hand back what it caught. */
function recorder(): unknown[] {
  const seen: unknown[] = [];
  window.auftakt = { logEvent: (payload: unknown) => void seen.push(payload) };
  return seen;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
  delete window.auftakt;
});

describe('logAppEvent', () => {
  it('hands the bridge one payload with the three fields', async () => {
    const seen = recorder();
    const { logAppEvent } = await fresh();

    logAppEvent('render-error', 'Error: kaputt', 'at Foo\nat Bar');

    expect(seen).toEqual([{ event: 'render-error', msg: 'Error: kaputt', stack: 'at Foo\nat Bar' }]);
  });

  it('does nothing at all without a bridge', async () => {
    delete window.auftakt;
    const { logAppEvent } = await fresh();
    expect(() => logAppEvent('window-error', 'egal')).not.toThrow();

    // …and it is the *member* that is checked, not just the object: a packaged app whose
    // preload predates this member has a `window.auftakt` without a `logEvent` on it.
    window.auftakt = { platform: 'win32' };
    expect(() => logAppEvent('window-error', 'egal')).not.toThrow();
  });

  it('collapses a repeat inside the dedupe window and lets it through after it', async () => {
    const seen = recorder();
    const { logAppEvent } = await fresh();

    logAppEvent('reported-error', 'Server nicht erreichbar');
    logAppEvent('reported-error', 'Server nicht erreichbar');
    vi.setSystemTime(START + 4_999);
    logAppEvent('reported-error', 'Server nicht erreichbar');
    expect(seen).toHaveLength(1);

    vi.setSystemTime(START + 5_001);
    logAppEvent('reported-error', 'Server nicht erreichbar');
    expect(seen).toHaveLength(2);
  });

  it('keys the dedupe on both halves', async () => {
    const seen = recorder();
    const { logAppEvent } = await fresh();

    logAppEvent('reported-error', 'eins');
    logAppEvent('reported-error', 'zwei');
    logAppEvent('window-error', 'eins');
    // The stack is not part of the key: two renders of one broken component differ only there,
    // and that is exactly the burst the dedupe exists for.
    logAppEvent('reported-error', 'eins', 'ein anderer Stack');

    expect(seen).toHaveLength(3);
  });

  it('goes silent past the per-page budget', async () => {
    const seen = recorder();
    const { logAppEvent } = await fresh();

    for (let i = 0; i < 120; i++) logAppEvent('window-error', `Fehler ${i}`);

    expect(seen).toHaveLength(50);
    // The budget counts sends, not calls: the deduped ones above never reached the bridge, so
    // they must not have been paid for either.
    expect(seen[49]).toEqual({ event: 'window-error', msg: 'Fehler 49', stack: undefined });
  });

  it('swallows a bridge that throws', async () => {
    window.auftakt = {
      logEvent: () => {
        throw new Error('IPC ist weg');
      },
    };
    const { logAppEvent } = await fresh();

    expect(() => logAppEvent('window-error', 'kaputt')).not.toThrow();
  });
});

describe('errorParts', () => {
  it('reads an Error', async () => {
    const { errorParts } = await fresh();
    const err = new TypeError('nicht aufrufbar');
    expect(errorParts(err)).toEqual({ msg: 'TypeError: nicht aufrufbar', stack: err.stack });
  });

  it('reads everything else without inventing detail', async () => {
    const { errorParts } = await fresh();
    expect(errorParts('kaputt')).toEqual({ msg: 'kaputt' });
    expect(errorParts(undefined)).toEqual({ msg: 'undefined' });
    expect(errorParts(42)).toEqual({ msg: '42' });
    // A rejection value carrying app data stays unread — the diagnostics bundle promises it
    // holds none, and „[object Object]" is the answer that keeps that promise.
    expect(errorParts({ title: 'Vertrag Kollektiv Halbton' })).toEqual({ msg: '[object Object]' });
  });

  it('survives a value that throws while being read', async () => {
    const { errorParts } = await fresh();
    const hostile = new Error('egal');
    Object.defineProperty(hostile, 'message', {
      get() {
        throw new Error('nope');
      },
    });
    expect(errorParts(hostile)).toEqual({ msg: '[unreadable error value]' });
  });
});
