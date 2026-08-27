import { afterEach, describe, expect, it } from 'vitest';
import { clearPending, pendingKey, queueWrite, settlePending, trackPending } from './pending';

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

/**
 * The assertion that matters here is the mirror of `settlePending`'s: a write must not be *sent*
 * while an earlier write on the same value is still out. Every store that uses this persists its
 * whole value on each change, so two in flight at once are decided by whichever the server applies
 * last — and nothing orders concurrent requests (WP-82: the browser gate's three-column burst
 * ended with the server holding write 2's map in 2 of 10 runs).
 */
describe('queueWrite', () => {
  it('does not start the second write until the first has answered', async () => {
    const key = pendingKey(['project', 2, 'task_columns']);
    const first = deferred<string>();
    const order: string[] = [];

    const a = queueWrite(key, () => {
      order.push('a sent');
      return first.promise;
    });
    const b = queueWrite(key, () => {
      order.push('b sent');
      return Promise.resolve('b');
    });

    // Two microtask drains: enough for `b` to have been started had nothing held it back.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['a sent']);

    first.resolve('a');
    await expect(a).resolves.toBe('a');
    await expect(b).resolves.toBe('b');
    expect(order).toEqual(['a sent', 'b sent']);
  });

  it('keeps a whole burst in the order it was made, whatever order the answers come in', async () => {
    const key = pendingKey(['project', 2, 'task_columns']);
    const answers = { one: deferred<void>(), two: deferred<void>(), three: deferred<void>() };
    const sent: string[] = [];
    const answered: string[] = [];
    const write = (name: keyof typeof answers) =>
      queueWrite(key, async () => {
        sent.push(name);
        await answers[name].promise;
        return name;
      }).then((n) => {
        answered.push(n);
        return n;
      });

    const all = Promise.all([write('one'), write('two'), write('three')]);
    await Promise.resolve();
    // Answered back to front — the ordering that leaves the server holding an older map when the
    // three go out together. Nothing but the queue makes the run order survive it.
    answers.three.resolve();
    answers.two.resolve();
    answers.one.resolve();

    expect(await all).toEqual(['one', 'two', 'three']);
    expect(sent).toEqual(['one', 'two', 'three']);
    expect(answered).toEqual(['one', 'two', 'three']);
  });

  it('lets the queue carry on after a write that failed', async () => {
    const key = pendingKey(['project', 2, 'task_columns']);
    const failed = queueWrite(key, () => Promise.reject(new Error('offline')));
    const after = queueWrite(key, () => Promise.resolve('stored'));
    await expect(failed).rejects.toThrow('offline');
    await expect(after).resolves.toBe('stored');
  });

  it('does not make one page wait for another', async () => {
    const two = pendingKey(['project', 2, 'task_columns']);
    const three = pendingKey(['project', 3, 'task_columns']);
    const held = deferred<void>();
    const started: string[] = [];

    queueWrite(two, () => {
      started.push('two');
      return held.promise;
    });
    await queueWrite(three, () => {
      started.push('three');
      return Promise.resolve();
    });

    expect(started).toEqual(['two', 'three']);
    held.resolve();
  });

  it('starts a write made after the queue drained without waiting for anything', async () => {
    const key = pendingKey(['project', 2, 'task_columns']);
    await queueWrite(key, () => Promise.resolve('first'));
    const order: string[] = [];
    const second = queueWrite(key, () => {
      order.push('second sent');
      return Promise.resolve('second');
    });
    // One drain, not two: nothing is in flight, so the queue is one microtask deep — a settled
    // tail left in the map would still resolve, but it would cost a hop per write ever made here.
    await Promise.resolve();
    expect(order).toEqual(['second sent']);
    await expect(second).resolves.toBe('second');
  });

  it('still queues behind a write in flight, even after an earlier one has drained', async () => {
    const key = pendingKey(['project', 2, 'task_columns']);
    const held = deferred<void>();
    const started: string[] = [];
    const send = (name: string, answer: Promise<unknown>) =>
      queueWrite(key, () => {
        started.push(name);
        return answer;
      });

    // The case the identity test in the cleanup exists for, and the only one that reaches it: a
    // burst registered in one tick never runs a cleanup mid-flight. `a` answers at once while `b`
    // is still out, so `a`'s cleanup fires against a map whose tail is already `b`'s — an
    // unconditional `tails.delete(key)` there empties it, and `c` then chains on nothing.
    const a = send('a', Promise.resolve('a'));
    send('b', held.promise);
    await expect(a).resolves.toBe('a');
    // Two drains: `b` starts one microtask after `a`'s tail settles, and `a`'s cleanup runs in the
    // same turn.
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(['a', 'b']);

    const c = send('c', Promise.resolve('c'));
    // The same two drains again — enough for `c` to have run had it queued behind nothing.
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(['a', 'b']);

    held.resolve();
    await expect(c).resolves.toBe('c');
    expect(started).toEqual(['a', 'b', 'c']);
  });
});
