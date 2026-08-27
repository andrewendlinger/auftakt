/**
 * Structural smoke test for a packaged build. Runs in CI right after electron-builder, before
 * the artifact can reach a release.
 *
 * It exists because of a blind spot rather than a past defect: `npm run typecheck` reads source,
 * and the four `check:*` scripts drive the server from source too. Nothing looked at what
 * electron-builder actually put inside the app. A `files` glob that stops matching, an asar that
 * omits the server bundle, a `better-sqlite3` that ends up packed instead of unpacked — every one
 * of those produces a green build, a complete-looking release, and an app that dies on launch for
 * the user. This is the cheapest check that sees them.
 *
 * Deliberately not a launch test. Launching the packaged app needs a display, which the macOS and
 * Windows runners do not have, and the failures worth catching here are structural — the bundle is
 * missing or in the wrong place, which is visible without running anything.
 *
 *   node scripts/check-package.mjs
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCheck, MARKERS } from './lib/check.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = join(root, 'release');

const { check, count } = createCheck(MARKERS.narrow);

/**
 * The unpacked app directory electron-builder leaves next to the installer. Named per platform,
 * and on macOS the payload sits inside the .app bundle.
 * @returns {string | null} directory holding `resources/`, or null if no build is present
 */
function findResourcesDir() {
  if (!existsSync(releaseDir)) return null;
  for (const entry of readdirSync(releaseDir)) {
    const dir = join(releaseDir, entry);
    if (!statSync(dir).isDirectory()) continue;
    // Windows / Linux: release/win-unpacked/resources
    if (existsSync(join(dir, 'resources'))) return join(dir, 'resources');
    // macOS: release/mac-arm64/Auftakt.app/Contents/Resources
    for (const inner of readdirSync(dir)) {
      if (!inner.endsWith('.app')) continue;
      const res = join(dir, inner, 'Contents', 'Resources');
      if (existsSync(res)) return res;
    }
  }
  return null;
}

const resources = findResourcesDir();
if (!resources) {
  console.error(
    'FAIL  Kein entpacktes Build in release/ gefunden.\n' +
      '      Zuerst bauen:  npm run build && npx electron-builder --dir',
  );
  process.exit(1);
}
console.log(`\nPaket-Struktur\n\n  ${resources}\n`);

const asar = join(resources, 'app.asar');
check('the app is packed into app.asar', existsSync(asar));

// `@electron/asar` comes in with electron-builder; resolve it from there rather than adding a
// dependency this script is the only user of. Its programmatic `listPackage` rather than the
// `asar` bin: no child process, and the paths come back already normalised.
const require = createRequire(join(root, 'package.json'));
/** @type {string[]} */
let entries = [];
/** @type {(archive: string, filename: string) => Buffer} */
let extractFile;
try {
  const { listPackage, extractFile: extract } = require('@electron/asar');
  extractFile = extract;
  // `{ isPack: false }` is optional at runtime but required by the type. Passing it explicitly
  // rather than casting the call away: `isPack: true` would annotate each entry with its offset
  // and size, which is not what the assertions below compare against.
  entries = listPackage(asar, { isPack: false }).map((/** @type {string} */ e) =>
    e.replace(/\\/g, '/'),
  );
} catch (err) {
  console.error(`FAIL  app.asar liess sich nicht lesen: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
check('app.asar is not empty', entries.length > 0, `${entries.length} Einträge`);

// The bundles `files` in electron-builder.yml is supposed to include. `main.cjs` is the entry
// point named by package.json#main — if it is absent the app cannot start at all — and since
// WP-69g it is a two-line loader in front of `main.bundle.cjs`, so both have to be here.
for (const path of [
  '/electron/dist/main.cjs',
  '/electron/dist/main.bundle.cjs',
  '/electron/dist/preload.cjs',
  '/server/dist/index.mjs',
  '/client/dist/index.html',
  '/package.json',
]) {
  check(`app.asar contains ${path}`, entries.includes(path));
}

// The source maps, pinned rather than assumed. They are what makes a stack in the runtime log
// (WP-69) name `server/src/db.ts:1529` instead of a column of a 3.3 MB bundle, and they only
// work if they travel *with* the app: Node reads the `.map` next to the file it is mapping, at
// throw time, on the customer's machine. Nothing else in the build would notice their absence —
// the app starts and runs perfectly without them, and the loss shows up months later as an
// unreadable stack in a diagnostics bundle somebody is waiting on. A `files` glob that stops
// matching `*.map`, or an esbuild option that stops emitting one, goes red here.
for (const path of [
  '/electron/dist/main.bundle.cjs.map',
  '/electron/dist/preload.cjs.map',
  '/server/dist/index.mjs.map',
]) {
  check(`app.asar contains ${path}`, entries.includes(path));
}

/**
 * One packed file's text, by the same leading-slash path the entry list uses.
 *
 * **The separator swap is the whole point, and it is Windows-only.** `@electron/asar` walks its
 * archive with `p.split(path.sep)` (`filesystem.js:60`), so a POSIX path resolves on macOS —
 * where `sep` *is* `/` — and finds nothing on Windows, where the whole string is read as one
 * node name. The entry list this takes its argument from is POSIX-shaped, because that is how
 * asar stores it, so this is the one place the two conventions meet.
 *
 * It cost the v0.12.0 tag build: `check:package` runs only on a tag or a dispatch, so the
 * assertion above it („app.asar contains …", a string match on the entry list) went green on
 * every PR while the extraction beneath it had never once run on Windows.
 */
function packed(/** @type {string} */ path) {
  return extractFile(asar, path.replace(/^\//, '').split('/').join(sep)).toString('utf8');
}

// The loader is the mechanism, not a wrapper worth tidying away. Node caches a file's source
// map while compiling it, so the call cannot stand inside the bundle it is meant to map (see
// scripts/build.mjs); a "simplification" that folds these two lines back into main.ts would keep
// every assertion above green and silently return main-process stacks to bundle positions.
const loader = packed('/electron/dist/main.cjs');
check(
  'the entry loader enables source maps before requiring the bundle',
  /setSourceMapsEnabled\(true\)[\s\S]*require\(['"]\.\/main\.bundle\.cjs['"]\)/.test(loader),
  // Only the code, so a red shows what the entry point does instead — the file is mostly comment.
  loader
    .split('\n')
    .filter((l) => l.trim() !== '' && !l.startsWith('//'))
    .join(' '),
);

// `sourcesContent: false` in scripts/build.mjs, asserted where it matters. The esbuild default
// embeds every source file's full text into the map, which would put the whole TypeScript source
// of the server and of main inside each installer — ~4 MB of download, and precisely the sources
// the `no TypeScript sources` check below exists to keep out of the package.
for (const path of [
  '/electron/dist/main.bundle.cjs.map',
  '/server/dist/index.mjs.map',
]) {
  check(`${path} carries no embedded sources`, !packed(path).includes('"sourcesContent"'));
}

// Nothing should ship the sources or a stray node_modules tree — that is the `files` allowlist
// leaking, and it is how an installer quietly doubles in size.
for (const [label, prefix] of [
  ['no TypeScript sources', '/server/src/'],
  ['no client sources', '/client/src/'],
]) {
  check(label, !entries.some((e) => e.startsWith(prefix)));
}

// better-sqlite3 is native: it must be *unpacked*, because a .node inside an asar cannot be
// dlopen'd. Packed, the app starts and then dies the moment it opens a database.
const unpacked = `${asar}.unpacked`;
check('app.asar.unpacked exists for the native module', existsSync(unpacked));

/** Every file under `dir`, relative and slash-normalised. */
function walk(dir, base = dir) {
  if (!existsSync(dir)) return [];
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, base));
    else out.push(p.slice(base.length).replace(/\\/g, '/'));
  }
  return out;
}

const unpackedFiles = walk(unpacked);
const nodeBinaries = unpackedFiles.filter((f) => f.endsWith('.node'));
check('a native .node binary is unpacked, not packed', nodeBinaries.length > 0, nodeBinaries.join(', '));
check(
  'the unpacked native module is better-sqlite3',
  nodeBinaries.some((f) => f.includes('better_sqlite3') || f.includes('better-sqlite3')),
  nodeBinaries.join(', ') || '(none)',
);

console.log(
  count.failures === 0
    ? '\nPaket-Struktur: alles vorhanden\n'
    : `\n${count.failures} Prüfung(en) fehlgeschlagen\n`,
);
process.exit(count.failures === 0 ? 0 : 1);
