import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BROADCAST_CHANNEL,
  closeBroadcast,
  coalesced,
  onBroadcast,
  parseBroadcastMessage,
  postBroadcast,
  type BroadcastMessage,
} from './broadcast';

/**
 * Runs in the default node environment on purpose: Node ≥18 ships the real BroadcastChannel
 * with browser-matching suppression semantics (delivery skips only the posting *object*),
 * while jsdom has none — so node is the environment that can actually falsify the module's
 * one load-bearing claim, the self-suppression via the singleton.
 *
 * Every channel opened here MUST be closed in afterEach: an open Node BroadcastChannel keeps
 * the process alive, and a leaked one turns `vitest run` into a hang, not a failure.
 */

const peers: BroadcastChannel[] = [];
function peer(): BroadcastChannel {
  const ch = new BroadcastChannel(BROADCAST_CHANNEL);
  peers.push(ch);
  return ch;
}

/** Resolves with the next message the channel receives. */
function nextMessage(ch: BroadcastChannel): Promise<unknown> {
  return new Promise((resolve) => {
    ch.addEventListener('message', (ev) => resolve((ev as MessageEvent).data), { once: true });
  });
}

afterEach(() => {
  closeBroadcast();
  for (const ch of peers.splice(0)) ch.close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('parseBroadcastMessage', () => {
  it('accepts the known shape', () => {
    expect(parseBroadcastMessage({ v: 1, type: 'invalidate' })).toEqual({ v: 1, type: 'invalidate' });
  });

  it('rejects foreign and future shapes without throwing', () => {
    for (const raw of [null, undefined, 'invalidate', 42, {}, [], { v: 2, type: 'invalidate' }, { v: 1, type: 'reload' }, { type: 'invalidate' }]) {
      expect(parseBroadcastMessage(raw)).toBeNull();
    }
  });
});

describe('postBroadcast / onBroadcast', () => {
  it('delivers to another channel object', async () => {
    const other = peer();
    const arrived = nextMessage(other);
    postBroadcast({ v: 1, type: 'invalidate' });
    expect(await arrived).toEqual({ v: 1, type: 'invalidate' });
  });

  it('never delivers a post back to its own window', async () => {
    const received: BroadcastMessage[] = [];
    const unsub = onBroadcast((m) => received.push(m));
    const other = peer();
    const otherGotOurs = nextMessage(other);

    // Our own post first; the peer receiving it proves it was really sent...
    postBroadcast({ v: 1, type: 'invalidate' });
    await otherGotOurs;
    // ...then the peer posts the sentinel. If the singleton did not suppress, our own post
    // would have been queued for us BEFORE the sentinel, so exactly-one-message is the
    // ordered proof of suppression, without sleeping.
    other.postMessage({ v: 1, type: 'invalidate' });
    await vi.waitFor(() => expect(received.length).toBeGreaterThan(0));
    expect(received).toHaveLength(1);
    unsub();
  });

  it('stops delivering after unsubscribe', async () => {
    const received: BroadcastMessage[] = [];
    const unsub = onBroadcast((m) => received.push(m));
    unsub();
    const other = peer();
    // A second subscriber both proves delivery happened and bounds the wait.
    const stillListening: BroadcastMessage[] = [];
    const unsub2 = onBroadcast((m) => stillListening.push(m));
    other.postMessage({ v: 1, type: 'invalidate' });
    await vi.waitFor(() => expect(stillListening).toHaveLength(1));
    expect(received).toHaveLength(0);
    unsub2();
  });

  it('drops unparseable messages before the handler', async () => {
    const received: BroadcastMessage[] = [];
    const unsub = onBroadcast((m) => received.push(m));
    const other = peer();
    other.postMessage({ v: 99, type: 'invalidate' });
    other.postMessage({ v: 1, type: 'invalidate' });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toEqual({ v: 1, type: 'invalidate' });
    unsub();
  });

  it('is a silent no-op where BroadcastChannel does not exist (jsdom)', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    vi.resetModules();
    const mod = await import('./broadcast');
    expect(() => mod.postBroadcast({ v: 1, type: 'invalidate' })).not.toThrow();
    const unsub = mod.onBroadcast(() => {});
    expect(() => unsub()).not.toThrow();
    mod.closeBroadcast();
  });
});

describe('coalesced', () => {
  it('runs on the leading edge, collapses a burst, flushes once at the end', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const run = coalesced(fn, 150);

    run();
    expect(fn).toHaveBeenCalledTimes(1); // leading edge, immediately

    run();
    run();
    run();
    expect(fn).toHaveBeenCalledTimes(1); // burst swallowed

    vi.advanceTimersByTime(149);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(2); // one trailing flush

    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(2); // quiet afterwards — nothing pending
  });

  it('runs immediately again once the window has passed', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const run = coalesced(fn, 150);
    run();
    vi.advanceTimersByTime(151);
    run();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
