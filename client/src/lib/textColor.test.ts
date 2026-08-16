import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TEXT_COLORS, TEXT_COLOR_CLASS, textColorClass, textColorFromClass } from './textColor';

/**
 * The palette is split across two files on purpose — ids and labels in `textColor.ts`, the colours
 * in `index.css`, so no hex is written twice — and this is the seam that keeps the halves honest.
 * A CSS rule cannot be reached from a unit test any other way; reading the stylesheet as text is
 * crude and is exactly why it works, since it measures the file the app actually ships.
 */
const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8');

/** `.tc-<id> { color: #rrggbb; }` — every palette rule, as written. */
const cssColors = new Map<string, string>(
  [...css.matchAll(/\.tc-([a-z0-9-]+)\s*\{\s*color:\s*(#[0-9a-f]{6});/g)].map((m) => [m[1]!, m[2]!]),
);

/** WCAG relative luminance, then the contrast ratio against white. */
function contrastOnWhite(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  return 1.05 / (luminance + 0.05);
}

describe('the palette and the stylesheet', () => {
  it('has a rule for every colour the picker offers', () => {
    for (const { id } of TEXT_COLORS) {
      expect(cssColors.get(id), `.${textColorClass(id)} fehlt in index.css`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('has no rule for a colour the picker does not offer', () => {
    const ids = new Set(TEXT_COLORS.map((c) => c.id));
    expect([...cssColors.keys()].filter((id) => !ids.has(id))).toEqual([]);
  });

  /**
   * The reason this palette is not `ColorSwatchPicker`'s: those sixteen colour a *dot*, and as
   * text on white its yellow reads at 1.9:1. 4.5:1 is WCAG AA for body text, and the note surfaces
   * are white everywhere — cards, table cells, the print sheet.
   */
  it('keeps every tone readable on white', () => {
    for (const { id, label } of TEXT_COLORS) {
      const hex = cssColors.get(id)!;
      expect(contrastOnWhite(hex), `${label} (${hex}) ist zu hell für Text auf Weiß`).toBeGreaterThanOrEqual(4.5);
    }
  });

  /**
   * WP-58's grey has to win over a colour inside a done task's comment, and the override is a CSS
   * rule with no JavaScript anywhere near it — so this is the only automated reach it has. The
   * browser check is in the PR; this catches the rule being dropped in a later edit.
   */
  it('hands the colour back to the row on a done task', () => {
    const done = css.slice(css.indexOf('.prose-md--done'));
    expect(done).toContain(".prose-md--done [class^='tc-']");
    expect(done).toContain(".prose-md--done [class*=' tc-']");
  });

  it('gives every colour a label of its own', () => {
    expect(new Set(TEXT_COLORS.map((c) => c.label)).size).toBe(TEXT_COLORS.length);
    expect(new Set(TEXT_COLORS.map((c) => c.id)).size).toBe(TEXT_COLORS.length);
  });
});

describe('TEXT_COLOR_CLASS', () => {
  it('accepts every class the mark writes', () => {
    for (const { id } of TEXT_COLORS) expect(TEXT_COLOR_CLASS.test(textColorClass(id))).toBe(true);
  });

  // The regex is what the sanitize schema admits on a `span`, so what it refuses is the whole of
  // „eine Klasse, keine CSS-Fläche": a foreign class, the bare prefix, anything with a space or a
  // quote in it (which is the only way a class value could reach outside its attribute).
  it('refuses anything that is not one', () => {
    for (const bad of ['tc-', 'notion-red', 'TC-ROT', 'tc-rot bad', 'tc rot', 'tc-<script>', '', 'x-tc-rot']) {
      expect(TEXT_COLOR_CLASS.test(bad), bad).toBe(false);
    }
  });
});

describe('textColorFromClass', () => {
  it('reads the id out of a class attribute', () => {
    expect(textColorFromClass('tc-rot')).toBe('rot');
    expect(textColorFromClass('  tc-blau  ')).toBe('blau');
  });

  // An import can put anything beside it; the sanitizer drops the rest, and so does this.
  it('finds ours among foreign classes', () => {
    expect(textColorFromClass('notion-red tc-gruen highlight')).toBe('gruen');
  });

  it('is null when there is none', () => {
    expect(textColorFromClass('notion-red')).toBeNull();
    expect(textColorFromClass('')).toBeNull();
    expect(textColorFromClass(null)).toBeNull();
    expect(textColorFromClass(undefined)).toBeNull();
  });

  /**
   * A colour the palette no longer offers still reads back, which is what lets a stored note
   * survive a re-cut palette: it renders in the default colour instead of losing its text.
   */
  it('reads an id the palette no longer has', () => {
    expect(textColorFromClass('tc-unbekannt')).toBe('unbekannt');
  });
});
