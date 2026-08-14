import { afterEach, describe, expect, it } from 'vitest';
import { clearPending, pendingKey, settlePending, trackPending } from './pending';

/**
 * The assertion that matters is the ordering one: a refresh issued while a write is in flight
 * must not read before that write is answered. Everything else here guards the bookkeeping that
 * makes it safe to have module state at all — a leaked entry would make every later refresh await
 * a promise that can never clear, which is a hang, not a wrong value.
 */

afterEach(clearPending);

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('pendingKey', () => {
  it('gives equal keys to equal query keys', () => {
    expect(pendingKey(['settings'])).toBe(pendingKey(['settings']));
    expect(pendingKey(['artist', 1])).toBe(pendingKey(['artist', 1]));
  });

  it('separates stores that must not wait for each other', () => {
    expect(pendingKey(['artist', 1])).not.toBe(pendingKey(['artist', 2]));
    expect(pendingKey(['settings'])).not.toBe(pendingKey(['landing']));
  });
});

describe('settlePending', () => {
  it('resolves at once when nothing is in flight', async () => {
    await expect(settlePending(pendingKey(['settings']))).resolves.toBeUndefined();
  });

  it('waits for a write that is still in flight', async () => {
    const key = pendingKey(['settings']);
    const write = deferred<string>();
    trackPending(key, write.promise);

    const order: string[] = [];
    const waiter = settlePending(key).then(() => order.push('refresh'));
    // Let the microtask queue drain — if the wait were a no-op, 'refresh' would land here.
    await Promise.resolve();
    expect(order).toEqual([]);

    write.resolve('written');
    order.push('write');
    await waiter;
    expect(order).toEqual(['write', 'refresh']);
  });

  it('does not hang on a rejected write', async () => {
    const key = pendingKey(['settings']);
    const write = deferred<string>();
    trackPending(key, write.promise).catch(() => {}); // the caller owns the rejection
    write.reject(new Error('offline'));
    await expect(settlePending(key)).resolves.toBeUndefined();
  });

  it('waits for every write on the key, not just the first', async () => {
    const key = pendingKey(['settings']);
    const a = deferred<void>();
    const b = deferred<void>();
    trackPending(key, a.promise);
    trackPending(key, b.promise);

    let settled = false;
    const waiter = settlePending(key).then(() => (settled = true));
    a.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    b.resolve();
    await waiter;
    expect(settled).toBe(true);
  });

  it('does not make one store wait for another', async () => {
    const settings = pendingKey(['settings']);
    const artist = pendingKey(['artist', 1]);
    const write = deferred<void>();
    trackPending(settings, write.promise);
    await expect(settlePending(artist)).resolves.toBeUndefined();
    write.resolve();
  });

  /**
   * A refresh waits for what was in flight when it started, never for what starts after — those
   * are a later state, not a race the refresh should lose to. Without this the two could ping-pong.
   */
  it('ignores a write registered after it started', async () => {
    const key = pendingKey(['settings']);
    const first = deferred<void>();
    trackPending(key, first.promise);

    let settled = false;
    const waiter = settlePending(key).then(() => (settled = true));
    const late = deferred<void>();
    trackPending(key, late.promise);

    first.resolve();
    await waiter;
    expect(settled).toBe(true);
    late.resolve();
  });

  it('forgets a settled write, so a later refresh does not await it again', async () => {
    const key = pendingKey(['settings']);
    const write = deferred<void>();
    trackPending(key, write.promise);
    write.resolve();
    await settlePending(key);
    // Nothing left registered: a second wait resolves without any promise to await.
    await expect(settlePending(key)).resolves.toBeUndefined();
  });
});

describe('trackPending', () => {
  it('hands the promise back so a caller can return it directly', async () => {
    const run = Promise.resolve('ok');
    expect(trackPending(pendingKey(['settings']), run)).toBe(run);
    await expect(run).resolves.toBe('ok');
  });
});
