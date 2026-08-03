/**
 * Colour is central to Auftakt: each artist has a hex colour that is used
 * consistently everywhere, and projects get deterministic *shades* of it.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}
export interface Hsl {
  h: number;
  s: number;
  l: number;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export function hexToRgb(hex: string): Rgb {
  let h = hex.replace('#', '').trim();
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  const int = parseInt(h || '888888', 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function toHex(n: number): string {
  return clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function hexToHsl(hex: string): Hsl {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbToHex({ r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 });
}

/** Relative luminance (0..1). */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const f = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

const DARK_TEXT = '#1c1c1e';
const LIGHT_TEXT = '#ffffff';

/** WCAG contrast ratio between two relative luminances. */
const ratio = (a: number, b: number): number =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * Black or white text that reads on the given background colour — whichever actually scores the
 * higher contrast ratio.
 *
 * This was a luminance gate at 0.55, but the two candidates cross at ≈0.179, so every colour in
 * between got white text where black reads far better — including the ones `pickArtistColor` is
 * built to emit. Its s=62/l=52 lands on e.g. `#3cd23c` at luminance ≈0.538, just under the gate:
 * white on that green is 1.8:1 (illegible), `#1c1c1e` is 11.7:1. The schema default `#888888` and
 * every mid-tone `projectShade` were inverted the same way (CCL-11).
 */
export function contrastText(hex: string): string {
  const bg = luminance(hex);
  return ratio(bg, luminance(DARK_TEXT)) >= ratio(bg, luminance(LIGHT_TEXT)) ? DARK_TEXT : LIGHT_TEXT;
}

/** A translucent tint of a colour for soft backgrounds / row accents. */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Shortest distance between two hues on the 0..360 colour wheel. */
function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Suggest a fresh, legible artist colour that is visually distinct from the
 * ones already in use. Samples candidate hues around the wheel and picks the
 * one whose nearest existing hue is farthest away; saturation/lightness are
 * fixed to a pleasant, readable range. The user can still override it.
 */
export function pickArtistColor(existing: string[]): string {
  const s = 62;
  const l = 52;
  const usedHues = existing
    .filter((c) => c && c.trim() !== '')
    .map((c) => hexToHsl(c).h);
  if (usedHues.length === 0) return hslToHex({ h: 210, s, l });
  let best = 0;
  let bestGap = -1;
  for (let h = 0; h < 360; h += 5) {
    const gap = Math.min(...usedHues.map((u) => hueDistance(h, u)));
    if (gap > bestGap) {
      bestGap = gap;
      best = h;
    }
  }
  return hslToHex({ h: best, s, l });
}

const SHADE_OFFSETS = [12, -12, 26, -22, 6, 34, -32, 18];

/**
 * The shade for a project. Manual override (`projectColor`) wins; otherwise a
 * deterministic lightness offset from the artist colour, keyed by `seed`
 * (project id) so the same project always renders the same shade everywhere.
 */
export function projectShade(
  artistHex: string,
  projectColor: string | null | undefined,
  seed: number,
): string {
  if (projectColor && projectColor.trim() !== '') return projectColor;
  const { h, s, l } = hexToHsl(artistHex);
  const offset = SHADE_OFFSETS[Math.abs(seed) % SHADE_OFFSETS.length] ?? 0;
  return hslToHex({ h, s: clamp(s, 25, 92), l: clamp(l + offset, 26, 82) });
}
