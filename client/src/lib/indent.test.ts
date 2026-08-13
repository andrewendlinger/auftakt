import { describe, expect, it } from 'vitest';
import { INDENT_UNIT, outdentWidth } from './indent';

// Spelled out rather than typed, for the same reason `indent.ts` does: a literal U+00A0 in source
// is indistinguishable from a space, and a test that cannot tell them apart tests nothing here.
const NBSP = '\u00a0';
const SPACE = '\u0020';

/**
 * The character is the load-bearing part, and it is invisible: a plain space would look right in
 * the editor and vanish from the reading view, which is the bug WP-49 exists to remove. Asserting
 * the code point is the only way to see that from a test.
 */
describe('INDENT_UNIT', () => {
  it('is three non-breaking spaces, not spaces', () => {
    expect(INDENT_UNIT).toBe(NBSP.repeat(3));
    expect(INDENT_UNIT).not.toContain(SPACE);
  });
});

describe('outdentWidth', () => {
  it('gives back one unit', () => {
    expect(outdentWidth(`${INDENT_UNIT}Aufbau`)).toBe(3);
  });

  it('gives back at most one unit per press', () => {
    expect(outdentWidth(`${INDENT_UNIT.repeat(2)}Aufbau`)).toBe(3);
  });

  it('takes what there is when it is less than a unit', () => {
    expect(outdentWidth(`${NBSP}Aufbau`)).toBe(1);
    expect(outdentWidth(NBSP.repeat(2))).toBe(2);
  });

  // Notes written before WP-49 carry plain-space indentation — the very thing that used to be
  // read back as a code block. Shift-Tab is how a user clears it.
  it('takes plain spaces too, and a mixture', () => {
    expect(outdentWidth(`${SPACE.repeat(4)}vier Leerzeichen`)).toBe(3);
    expect(outdentWidth(`${SPACE}${NBSP}${SPACE}Aufbau`)).toBe(3);
  });

  it('leaves text alone', () => {
    expect(outdentWidth('Aufbau')).toBe(0);
    expect(outdentWidth('')).toBe(0);
    expect(outdentWidth(`Aufbau${NBSP.repeat(2)}`)).toBe(0);
  });
});
