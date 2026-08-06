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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = join(root, 'release');

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

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
try {
  const { listPackage } = require('@electron/asar');
  entries = listPackage(asar).map((/** @type {string} */ e) => e.replace(/\\/g, '/'));
} catch (err) {
  console.error(`FAIL  app.asar liess sich nicht lesen: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
check('app.asar is not empty', entries.length > 0, `${entries.length} Einträge`);

// The three bundles `files` in electron-builder.yml is supposed to include. `main.cjs` is the
// entry point named by package.json#main — if it is absent the app cannot start at all.
for (const path of [
  '/electron/dist/main.cjs',
  '/electron/dist/preload.cjs',
  '/server/dist/index.mjs',
  '/client/dist/index.html',
  '/package.json',
]) {
  check(`app.asar contains ${path}`, entries.includes(path));
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
  failures === 0
    ? '\nPaket-Struktur: alles vorhanden\n'
    : `\n${failures} Prüfung(en) fehlgeschlagen\n`,
);
process.exit(failures === 0 ? 0 : 1);
