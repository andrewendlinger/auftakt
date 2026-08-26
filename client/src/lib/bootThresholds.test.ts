import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The boot overlay's thresholds live in `client/index.html`, but every one of them is also
 * *stated* in `docs/VERIFYING.md`, because that file is what a driving script is written
 * against. TODO.md has said for a while that the two must move together, and by the overlay's
 * own comments they repeatedly have not: WP-61 found `HITCH_MS` documented as 50 ms while the
 * value that mattered had been argued over three times. Prose cannot be typechecked, so this
 * is the gate — the same shape as `scripts/check-dates.mjs`, small and bespoke.
 *
 * It deliberately compares numbers only. The prose around them is the part a human has to keep
 * honest; what this catches is the edit that changes a constant and leaves the sentence behind.
 *
 * Reaching out of `client/` is the arrangement `appLog.test.ts` already uses for
 * `electron/appLog.ts` — `check:unit` is the only automated run that gets near either.
 */

const here = fileURLToPath(new URL('.', import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf8');

const overlay = read('../../index.html');
const verifying = read('../../../docs/VERIFYING.md');

/** `var NAME = 58;` out of the overlay's inline script. */
function constant(name: string): number {
  const m = overlay.match(new RegExp(`var ${name} = (\\d+);`));
  if (!m) throw new Error(`${name} is no longer declared as \`var ${name} = <number>;\``);
  return Number(m[1]);
}

/** The first capture of `pattern` in VERIFYING.md, as a number. */
function documented(pattern: RegExp, what: string): number {
  const m = verifying.match(pattern);
  if (!m) throw new Error(`docs/VERIFYING.md no longer states ${what} in the expected wording`);
  return Number(m[1]);
}

describe('boot thresholds are stated the same in the code and in VERIFYING.md', () => {
  it('HITCH_MS', () => {
    // The abort-reason list under `data-boot` → `cross`.
    expect(documented(/`hitch` — one frame over (\d+) ms/, 'the hitch threshold')).toBe(
      constant('HITCH_MS'),
    );
  });

  it('WATCH_MS', () => {
    expect(documented(/rolling (\d+) ms windows/, 'the judging window')).toBe(
      constant('WATCH_MS'),
    );
  });

  it('GESTURE_DEADLINE', () => {
    expect(documented(/readiness arrived past the\n\s+(\d+) ms deadline/, 'the deadline')).toBe(
      constant('GESTURE_DEADLINE'),
    );
  });

  it('HOLD_MAX', () => {
    expect(documented(/up to (\d+) ms, then it reveals/, 'the hold cap')).toBe(
      constant('HOLD_MAX'),
    );
  });

  it('WARM_FRAMES — the exempt head, which has no numeral in the prose', () => {
    // Spelled out rather than digits, so this one is pinned by word. If the count ever stops
    // being two, the sentence in VERIFYING.md has to be rewritten anyway, not just renumbered.
    expect(constant('WARM_FRAMES')).toBe(2);
    expect(verifying).toContain('the first two measured deltas after');
  });
});
