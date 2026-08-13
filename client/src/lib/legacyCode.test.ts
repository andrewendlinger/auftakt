import { describe, expect, it } from 'vitest';
import { fenceParagraphs } from './legacyCode';

const NBSP = '\u00a0';

/**
 * Both halves of the dialect build their nodes from this, so a change here that looks harmless
 * silently pulls the editor and the reader apart — `check:markdown` catches that, but only for
 * the shapes in its corpus. These are the two the first cut got wrong.
 */
describe('fenceParagraphs', () => {
  it('keeps the lines of a plain block together', () => {
    expect(fenceParagraphs('Soundcheck\nEinlass')).toEqual([['Soundcheck', 'Einlass']]);
  });

  // An indented code block swallows the blank lines between its lines, so the fences this app
  // wrote from prose are full of them. As hard breaks they serialize back as a whitespace-only
  // line, which *is* a paragraph break — the note re-shaped itself on the first save.
  it('splits on a blank line, however much whitespace it holds', () => {
    expect(fenceParagraphs('eins\n\nzwei')).toEqual([['eins'], ['zwei']]);
    expect(fenceParagraphs('eins\n   \nzwei')).toEqual([['eins'], ['zwei']]);
    expect(fenceParagraphs('eins\n\n\n\nzwei')).toEqual([['eins'], ['zwei']]);
  });

  it('carries indentation over as U+00A0, which a paragraph can hold', () => {
    expect(fenceParagraphs('  eingerückt')).toEqual([[`${NBSP.repeat(2)}eingerückt`]]);
    expect(fenceParagraphs('\tmit Tab')).toEqual([[`${NBSP}mit Tab`]]);
    expect(fenceParagraphs('bündig\n  darunter')).toEqual([['bündig', `${NBSP.repeat(2)}darunter`]]);
  });

  it('leaves inner and trailing whitespace alone', () => {
    expect(fenceParagraphs('a  b')).toEqual([['a  b']]);
    expect(fenceParagraphs('a\n')).toEqual([['a']]);
  });

  it('has one empty paragraph for an empty block', () => {
    expect(fenceParagraphs('')).toEqual([['']]);
  });
});
