import { describe, expect, it } from 'vitest';
import { escapeBlockStarts } from './blockEscape';

/**
 * The rule table of „ein Zeilenanfang ist kein Befehl" (WP-85), one assertion per off-by-one.
 *
 * The round-trip gate reaches these through a jsdom editor and a unified pipeline, which proves the
 * *outcome* but names nothing when it breaks: a failing corpus entry says „render differs", not
 * „a heading may have at most six hashes". Every line below is a boundary the regexes decide, and
 * the ones that must stay untouched matter as much as the ones that must be escaped — over-escaping
 * is invisible in the app and permanent in the database, since the .xlsx export writes stored
 * Markdown verbatim.
 */
describe('escapeBlockStarts', () => {
  it('defuses a bullet marker, including one alone on the line', () => {
    expect(escapeBlockStarts('- Punkt A')).toBe('\\- Punkt A');
    expect(escapeBlockStarts('+ Punkt A')).toBe('\\+ Punkt A');
    expect(escapeBlockStarts('* Punkt A')).toBe('\\* Punkt A');
    expect(escapeBlockStarts('-')).toBe('\\-');
  });

  // A marker needs whitespace or the end of the line after it; `-nicht` is a word and `:-)` a face.
  it('leaves a dash that starts no list alone', () => {
    expect(escapeBlockStarts('-nicht')).toBe('-nicht');
    expect(escapeBlockStarts(':-)')).toBe(':-)');
  });

  // The backslash goes before the punctuation, never before the digit: `\2026.` is not a CommonMark
  // escape (digits are not ASCII punctuation) and would stay visible in the text.
  it('defuses an ordered marker at its delimiter', () => {
    expect(escapeBlockStarts('2026. Jubiläum')).toBe('2026\\. Jubiläum');
    expect(escapeBlockStarts('1) eins')).toBe('1\\) eins');
  });

  it('leaves a number that starts no list alone', () => {
    expect(escapeBlockStarts('1234567890. zu lang')).toBe('1234567890. zu lang'); // over nine digits
    expect(escapeBlockStarts('1.eins')).toBe('1.eins'); // no space after the delimiter
  });

  // One backslash is enough: after it the line no longer begins with a hash.
  it('defuses only the first hash of a heading', () => {
    expect(escapeBlockStarts('# Titel')).toBe('\\# Titel');
    expect(escapeBlockStarts('###### Titel')).toBe('\\###### Titel');
    expect(escapeBlockStarts('#')).toBe('\\#');
  });

  it('leaves a hash that starts no heading alone', () => {
    expect(escapeBlockStarts('####### sieben')).toBe('####### sieben'); // seven is not a heading
    expect(escapeBlockStarts('#hashtag')).toBe('#hashtag'); // no space after the run
  });

  // A thematic break, a setext underline of level 2 and a GFM delimiter row are one form: a line of
  // nothing but dashes, colons, pipes and space that holds at least one dash.
  it('defuses a line of nothing but rule characters', () => {
    expect(escapeBlockStarts('---')).toBe('\\---');
    expect(escapeBlockStarts('- - -')).toBe('\\- - -');
    expect(escapeBlockStarts('--')).toBe('\\--');
    expect(escapeBlockStarts('| --- | --- |')).toBe('\\| --- | --- |');
    expect(escapeBlockStarts('--- | ---')).toBe('\\--- | ---');
    expect(escapeBlockStarts(':-:|:-:')).toBe('\\:-:|:-:');
  });

  // A header row alone is not a table — only the delimiter row under it makes one, so escaping the
  // header as well would be churn in every note that draws an ASCII table by hand.
  it('leaves a pipe row that is not a delimiter row alone', () => {
    expect(escapeBlockStarts('| a | b |')).toBe('| a | b |');
  });

  it('defuses a setext underline of level 1', () => {
    expect(escapeBlockStarts('===')).toBe('\\===');
    expect(escapeBlockStarts('=')).toBe('\\=');
  });

  // Each of these opens a block in CommonMark and reaches this function already neutralised — `>`
  // and `<` by the serializer's entity encoding, the rest by its inline escape. No rule is written
  // for them, so a regression in either would show up here as an unexpected *escape*.
  it('writes no rule for what arrives already neutralised', () => {
    expect(escapeBlockStarts('&gt; Zitat')).toBe('&gt; Zitat');
    expect(escapeBlockStarts('\\`\\`\\`')).toBe('\\`\\`\\`');
    expect(escapeBlockStarts('\\~\\~\\~')).toBe('\\~\\~\\~');
    expect(escapeBlockStarts('\\_\\_\\_')).toBe('\\_\\_\\_');
    expect(escapeBlockStarts('<span class="tc-rot">+ Punkt</span>')).toBe(
      '<span class="tc-rot">+ Punkt</span>',
    );
  });

  it('leaves inline constructs that start no block alone', () => {
    expect(escapeBlockStarts('[Rider](https://example.com)')).toBe('[Rider](https://example.com)');
    expect(escapeBlockStarts('![Saalplan](/api/images/a)')).toBe('![Saalplan](/api/images/a)');
    expect(escapeBlockStarts('**fett** am Anfang')).toBe('**fett** am Anfang');
  });

  // WP-49 disabled `codeIndented` on both halves, which took the four-space ceiling with it: four
  // spaces before a marker are still a list to the reader, so the indent is unbounded here.
  it('sees a marker behind any amount of indentation', () => {
    expect(escapeBlockStarts('  - zwei')).toBe('  \\- zwei');
    expect(escapeBlockStarts('    - vier')).toBe('    \\- vier');
    expect(escapeBlockStarts('\t- tab')).toBe('\t\\- tab');
    expect(escapeBlockStarts('    ---')).toBe('    \\---');
  });

  // The dialect is `breaks: true` and a hard break serializes as two spaces plus a newline, so one
  // paragraph holds several lines — and in CommonMark a list may interrupt a paragraph.
  it('escapes every line, not only the first', () => {
    expect(escapeBlockStarts('eins  \n+ zwei')).toBe('eins  \n\\+ zwei');
    expect(escapeBlockStarts('Titel  \n===')).toBe('Titel  \n\\===');
    expect(escapeBlockStarts('| a |  \n| --- |')).toBe('| a |  \n\\| --- |');
    expect(escapeBlockStarts('- eins\n- zwei')).toBe('\\- eins\n\\- zwei');
  });

  it('adds at most one backslash to a line', () => {
    expect(escapeBlockStarts('- - -')).toBe('\\- - -');
    expect(escapeBlockStarts('1. - Punkt')).toBe('1\\. - Punkt');
  });

  /**
   * The law WP-62 got wrong: an escape that can fire on its own output grows a backslash per save,
   * without limit, and the *first* save is always right — so only idempotence catches it. Here it
   * holds by construction, because every rule tests a position that holds a backslash afterwards.
   */
  it('is idempotent on everything it touches, and on a backslash the user typed', () => {
    const lines = [
      '- Punkt A', '+ Punkt A', '* Punkt A', '-', '2026. Jubiläum', '1) eins', '# Titel',
      '###### Titel', '#', '---', '- - -', '--', '===', '=', '| --- | --- |', '--- | ---',
      ':-:|:-:', '    - vier', '\t- tab', 'eins  \n+ zwei', '1. - Punkt',
      // Neither of these may gain a backslash at all: both already begin with one.
      '\\+ Punkt', '\\\\+ Punkt',
    ];
    for (const line of lines) {
      const once = escapeBlockStarts(line);
      expect(escapeBlockStarts(once)).toBe(once);
    }
    expect(escapeBlockStarts('\\+ Punkt')).toBe('\\+ Punkt');
    expect(escapeBlockStarts('\\\\+ Punkt')).toBe('\\\\+ Punkt');
  });

  it('leaves text that starts no block completely alone', () => {
    expect(escapeBlockStarts('Aufbau ab 14:00')).toBe('Aufbau ab 14:00');
    expect(escapeBlockStarts('')).toBe('');
  });
});
