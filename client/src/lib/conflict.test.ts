import { describe, expect, it } from 'vitest';
import { MAX_CONFLICT_ATTEMPTS, isConflict, retryOnConflict } from './conflict';

/**
 * The retry exists to stop one window's landing write from destroying another's, so the
 * assertions that matter are about what the *second* attempt computes from. A loop that retries
 * but re-applies the stale value is the bug this was written against, and it passes every test
 * that only counts attempts — hence „re-applies onto the value the conflict carried" below.
 */

/** What `ApiError` looks like to `isConflict`, without importing it (see conflict.ts). */
const conflict = (landing: unknown = null) => ({ status: 409, body: { landing } });

describe('isConflict', () => {
  it('recognises a 409 by its status', () => {
    expect(isConflict(conflict())).toBe(true);
  });

  it('rejects every other rejection — a 400 or a dropped connection is not a race', () => {
    expect(isConflict({ status: 400 })).toBe(false);
    expect(isConflict({ status: 500 })).toBe(false);
    expect(isConflict(new Error('Failed to fetch'))).toBe(false);
    expect(isConflict(null)).toBe(false);
    expect(isConflict(undefined)).toBe(false);
    expect(isConflict('409')).toBe(false);
  });
});

describe('retryOnConflict', () => {
  it('returns the first attempt when nothing conflicts', async () => {
    let calls = 0;
    await expect(
      retryOnConflict(async () => {
        calls++;
        return 'ok';
      }),
    ).resolves.toBe('ok');
    expect(calls).toBe(1);
  });

  it('runs again after a conflict and returns the later result', async () => {
    let calls = 0;
    const result = await retryOnConflict(async () => {
      if (++calls === 1) throw conflict();
      return calls;
    });
    expect(result).toBe(2);
  });

  /**
   * The load-bearing one. The point of the retry is to re-apply the change onto what the server
   * actually holds — a loop that re-runs but hands the attempt the same stale content writes the
   * same lost update a second time and reports success.
   */
  it('re-applies onto the value the conflict carried, not the stale one', async () => {
    const seen: unknown[] = [];
    await retryOnConflict(async (c) => {
      seen.push(c);
      if (seen.length === 1) throw conflict(['fresh']);
      return 'ok';
    });
    expect(seen[0]).toBeUndefined(); // first attempt reads for itself
    expect((seen[1] as { body: { landing: unknown } }).body.landing).toEqual(['fresh']);
  });

  it('rethrows a non-conflict immediately, without spending the budget', async () => {
    let calls = 0;
    const boom = new Error('Failed to fetch');
    await expect(
      retryOnConflict(async () => {
        calls++;
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(calls).toBe(1);
  });

  /**
   * A bounded loop, and the rejection is the *server's* last 409 rather than a synthetic error:
   * `useLanding().update` throws it on to a caller whose catch → toast prints the German sentence
   * the server sent.
   */
  it('gives up after the budget and rethrows the last conflict', async () => {
    let calls = 0;
    const last = conflict(['third']);
    await expect(
      retryOnConflict(async () => {
        calls++;
        throw calls === MAX_CONFLICT_ATTEMPTS ? last : conflict();
      }),
    ).rejects.toBe(last);
    expect(calls).toBe(MAX_CONFLICT_ATTEMPTS);
  });

  it('honours an explicit budget', async () => {
    let calls = 0;
    await expect(
      retryOnConflict(async () => {
        calls++;
        throw conflict();
      }, 1),
    ).rejects.toSatisfy(isConflict);
    expect(calls).toBe(1);
  });
});
