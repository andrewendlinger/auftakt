import { describe, expect, it } from 'vitest';
import { stepIndex } from './rovingFocus';

/**
 * The wrap is the whole point of this function, and it is the arithmetic that fails silently: a
 * group whose arrows stop at the ends still *looks* like it works, because most presses are in
 * the middle. `-1 % 5` is `-1` in JavaScript, so the naive form walks focus off the front and
 * `items[-1]` is `undefined` — no focus move, no error, and a keyboard user parked at the first
 * pill with nothing happening.
 */
describe('stepIndex', () => {
  it('walks forwards and backwards', () => {
    expect(stepIndex(0, 1, 5)).toBe(1);
    expect(stepIndex(3, -1, 5)).toBe(2);
  });

  it('wraps at both ends', () => {
    expect(stepIndex(4, 1, 5)).toBe(0);
    expect(stepIndex(0, -1, 5)).toBe(4);
  });

  it('enters at the end the move is heading for when focus is not on an item', () => {
    expect(stepIndex(-1, 1, 5)).toBe(0);
    expect(stepIndex(-1, -1, 5)).toBe(4);
  });

  it('has nothing to move to in an empty group', () => {
    expect(stepIndex(-1, 1, 0)).toBe(-1);
    expect(stepIndex(0, 1, 0)).toBe(-1);
  });

  it('stays put in a group of one', () => {
    expect(stepIndex(0, 1, 1)).toBe(0);
    expect(stepIndex(0, -1, 1)).toBe(0);
  });
});
