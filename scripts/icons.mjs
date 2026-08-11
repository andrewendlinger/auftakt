// Regenerate every derived icon asset from `logo.svg`.
//
// This replaces a paragraph of docs that told you to run `rsvg-convert` and `iconutil` by
// hand. Five outputs came off that instruction, one of them (the favicon) had quietly
// stopped matching what the docs claimed, and the two raster targets were wrong in ways
// no amount of care at the keyboard would have fixed:
//
//   * macOS put the artwork on a full-bleed 1024 tile. Apple's grid is an 824x824 shape
//     centred in 1024, so Auftakt rendered visibly larger and squarer than every
//     neighbour in the dock.
//   * Windows had no `.ico` at all. electron-builder therefore derived one from the single
//     1024 PNG, which means every entry in that file — 16 px included — was a brute-force
//     downsample of artwork drawn for 1024.
//
// Both containers carry a separate bitmap per size, so the fix is to draw each size rather
// than resample one. See `dilationFor` for what "draw each size" amounts to here.
//
// Requires `rsvg-convert` (brew install librsvg). `iconutil` is macOS-only; on other
// platforms the `.icns` step is skipped and everything else still runs.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MASTER = join(ROOT, 'logo.svg');
const BUILD = join(ROOT, 'build');
const FAVICON = join(ROOT, 'client', 'public', 'favicon.svg');

const INK = '#3c3c3b';
const ART = 3250;            // the master artboard
const PLATE_R = 646.087;     // the master plate's corner radius, in artboard units

/**
 * Lift the silhouette out of `logo.svg`.
 *
 * The master holds two paths: a white rounded-rect plate, and a `#3c3c3b` evenodd path
 * whose FIRST subpath is that same rect and whose remaining 19 are the figure — the figure
 * is a knockout, not a positive shape. Dropping the rect is therefore not a plain slice:
 * the next subpath opens with a relative `m`, and after a `Z` the current point is the
 * START of the subpath just closed, not its end. So that one `m` has to be resolved against
 * the rect's origin or the whole figure lands offset and the icon renders empty.
 *
 * Taken alone under evenodd the figure subpaths fill correctly: one crossing inside the
 * silhouette, two inside an eye or a gap in the hair, so the internal holes survive.
 */
function extractFigure(svg) {
  const match = svg.match(/<path[^>]*d="([^"]*)"[^>]*style="fill:#3c3c3b;fill-rule:evenodd;"/);
  if (!match) throw new Error('logo.svg: could not find the evenodd silhouette path');
  const subs = match[1].split('Z');
  const origin = subs[0].match(/^\s*M([-\d.]+),([-\d.]+)/);
  const rel = subs[1] && subs[1].match(/^\s*m([-\d.]+),([-\d.]+)/);
  if (!origin || !rel) throw new Error('logo.svg: unexpected subpath structure');
  const abs = `M${Number(origin[1]) + Number(rel[1])},${Number(origin[2]) + Number(rel[2])}`;
  return [abs + subs[1].slice(rel[0].length), ...subs.slice(2)].join('Z') + 'Z';
}

const round = (n) => Math.round(n * 1000) / 1000;

/** Superellipse — the squircle family Apple's icon grid sits in. */
function squircle(cx, cy, r, n = 5, steps = 360) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const th = (i / steps) * Math.PI * 2;
    const ct = Math.cos(th);
    const st = Math.sin(th);
    pts.push(`${round(cx + r * Math.sign(ct) * Math.abs(ct) ** (2 / n))},` +
             `${round(cy + r * Math.sign(st) * Math.abs(st) ** (2 / n))}`);
  }
  return `M${pts.join('L')}Z`;
}

const roundedRect = (x, y, w, h, r) =>
  `M${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}` +
  `A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x + r}A${r},${r} 0 0 1 ${x},${y + h - r}` +
  `V${y + r}A${r},${r} 0 0 1 ${x + r},${y}Z`;

// macOS masks nothing but expects the artwork inside an 824 shape centred in 1024, with a
// 100 px margin all round. Windows masks nothing and expects nothing, so there the plate IS
// the icon: full bleed, carrying the master's own corner radius.
const PLATES = {
  mac: { path: squircle(512, 512, 412), box: 824, offset: 100 },
  win: { path: roundedRect(0, 0, 1024, 1024, Math.round((PLATE_R / ART) * 1024)), box: 1024, offset: 0 },
};

/**
 * How far to grow the silhouette, in FINAL pixels, for a given render size.
 *
 * This is the whole of the small-size treatment. The figure carries a lot of hairline
 * detail — individual locks of hair, the collar edge, the lapel — and below about 48 px
 * those features land on less than one pixel each, so they average into flat grey instead
 * of resolving as ink. Growing the outline by a fraction of a pixel keeps them as ink and
 * closes the noisiest gaps, which reads as a cleaner, more deliberate small icon.
 *
 * Tuned by eye against magnified renders. Past ~0.35 px the face fills in and the head
 * becomes a white blob, so this deliberately stops well short of that. It does not make the
 * 16 px icon legible — nothing will, the artwork is far too detailed for 256 pixels — it
 * makes it clean rather than muddy.
 */
function dilationFor(size) {
  if (size <= 16) return 0.2;
  if (size <= 24) return 0.25;
  if (size <= 32) return 0.28;
  if (size <= 48) return 0.2;
  if (size <= 64) return 0.12;
  return 0;
}

/**
 * One icon, as SVG, drawn for exactly `size` pixels.
 *
 * The clip lives on an untransformed wrapper on purpose. `clip-path` resolves in the user
 * space of the element that references it, so putting it on the scaled group would shrink
 * the mask along with the artwork and clip the figure down to a fragment.
 */
function iconSvg(figure, platform, size) {
  const plate = PLATES[platform];
  const scale = plate.box / ART;
  const grow = dilationFor(size);
  // Strokes expand by half their width on each side, hence the doubling; the width is in
  // the figure's own units, so it is divided back through the group's scale.
  const strokeWidth = grow > 0 ? (2 * grow * (1024 / size)) / scale : 0;
  const dilate = strokeWidth
    ? ` stroke="#ffffff" stroke-width="${round(strokeWidth)}" stroke-linejoin="round" stroke-linecap="round"`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="${size}" height="${size}">
<defs><clipPath id="plate"><path d="${plate.path}"/></clipPath></defs>
<path d="${plate.path}" fill="${INK}"/>
<g clip-path="url(#plate)"><g transform="translate(${plate.offset},${plate.offset}) scale(${round(scale)})">
<path d="${figure}" fill="#ffffff" fill-rule="evenodd"${dilate}/>
</g></g>
</svg>`;
}

/** Pack PNGs into an ICO. Vista and later read PNG-compressed entries directly. */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);              // reserved
  header.writeUInt16LE(1, 2);              // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach((entry, i) => {
    const at = i * 16;
    // 256 is stored as 0 — the field is one byte and 256 does not fit.
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, at);
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1);
    dir.writeUInt8(0, at + 2);             // palette size
    dir.writeUInt8(0, at + 3);             // reserved
    dir.writeUInt16LE(1, at + 4);          // colour planes
    dir.writeUInt16LE(32, at + 6);         // bits per pixel
    dir.writeUInt32LE(entry.data.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += entry.data.length;
  });
  return Buffer.concat([header, dir, ...entries.map((entry) => entry.data)]);
}

// The ten entries `iconutil` expects, as [file suffix, pixels].
const ICONSET = [
  ['16x16', 16], ['16x16@2x', 32],
  ['32x32', 32], ['32x32@2x', 64],
  ['128x128', 128], ['128x128@2x', 256],
  ['256x256', 256], ['256x256@2x', 512],
  ['512x512', 512], ['512x512@2x', 1024],
];
const ICO_SIZES = [16, 20, 24, 32, 48, 64, 128, 256];

function main() {
  try {
    execFileSync('rsvg-convert', ['--version'], { stdio: 'ignore' });
  } catch {
    throw new Error('rsvg-convert not found — install it with `brew install librsvg`');
  }

  const figure = extractFigure(readFileSync(MASTER, 'utf8'));
  const work = mkdtempSync(join(tmpdir(), 'auftakt-icons-'));
  const written = [];

  /** Render one platform/size pair and return the PNG bytes. */
  const render = (platform, size) => {
    const svg = join(work, `${platform}-${size}.svg`);
    const png = join(work, `${platform}-${size}.png`);
    writeFileSync(svg, iconSvg(figure, platform, size));
    execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), svg, '-o', png]);
    return readFileSync(png);
  };

  try {
    mkdirSync(BUILD, { recursive: true });

    // macOS — the .icns, ten sizes, each drawn for its own pixel count.
    if (process.platform === 'darwin') {
      const iconset = join(work, 'icon.iconset');
      mkdirSync(iconset);
      for (const [suffix, size] of ICONSET) {
        writeFileSync(join(iconset, `icon_${suffix}.png`), render('mac', size));
      }
      execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(BUILD, 'icon.icns')]);
      written.push('build/icon.icns');
    } else {
      console.warn('! iconutil is macOS-only — build/icon.icns left untouched');
    }

    // Windows — a real multi-size .ico, replacing electron-builder's downsample of one PNG.
    const ico = buildIco(ICO_SIZES.map((size) => ({ size, data: render('win', size) })));
    writeFileSync(join(BUILD, 'icon.ico'), ico);
    written.push('build/icon.ico');

    // Linux and the generic fallback: full bleed, so it fills whatever frame it is given.
    writeFileSync(join(BUILD, 'icon.png'), render('win', 1024));
    written.push('build/icon.png');

    // The favicon is a straight copy of the master, and now provably so.
    copyFileSync(MASTER, FAVICON);
    written.push('client/public/favicon.svg');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  for (const path of written) {
    const { size } = statSync(join(ROOT, path));
    console.log(`  ${path.padEnd(28)} ${(size / 1024).toFixed(1)} kB`);
  }
  console.log(`\n${written.length} assets regenerated from logo.svg.`);
}

main();
