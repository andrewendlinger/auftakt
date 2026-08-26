#!/usr/bin/env node
/**
 * Make the next packaged launch a first launch again, without touching data.
 *
 * A first launch is the coldest boot an install ever does — empty renderer code cache,
 * empty HTTP cache, cold GPU/shader caches, empty main-process compile cache — and it is
 * the launch the boot gesture's field stutter happened on. Relaunching cannot reproduce
 * it: the second launch is warm by construction. This script deletes exactly those caches
 * from the packaged app's userData so a cold/warm boot-report pair can be measured at will.
 *
 * Allowlist-only by construction, never a glob: the same directory holds the live
 * database (auftakt.db and its -wal/-shm, seasons.json) and origin storage — `Local
 * Storage` carries emoji-picker state and the boot report copy, and deleting it would
 * silently change the very behaviour under test. Only the names in CACHE_DIRS are ever
 * removed, one by one.
 *
 * Refuses to run while anything answers on :4317: deleting caches under a live app is a
 * corruption hazard, and a running dev server means the measurement would be wrong anyway
 * (docs/VERIFYING.md, "A running dev server hijacks a packaged app").
 *
 * Honesty note: this reproduces cold Chromium/V8 state. It does not reproduce macOS
 * Gatekeeper's first-open assessment of a freshly quarantined bundle — re-installing from
 * the .dmg is the faithful (heavier) repro when the cache-cold run comes up clean.
 *
 *   node scripts/clear-boot-caches.mjs [profil-verzeichnis]
 */
import { existsSync, rmSync } from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CACHE_DIRS = [
  'Cache', // HTTP disk cache — the asset bytes themselves
  'Code Cache', // renderer V8 code cache — the warm half of the immutable-/assets/ optimisation
  'GPUCache',
  'DawnGraphiteCache', // Metal shader caches — likely the largest share of first-run raster jank
  'DawnWebGPUCache',
  'Shared Dictionary',
  'blob_storage',
  'v8-cache', // enableCompileCache dir — the main process's server-bundle compile (main.ts)
];

function userDataDir() {
  switch (process.platform) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', 'Auftakt');
    case 'win32':
      return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Auftakt');
    default:
      return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'Auftakt');
  }
}

function portAnswers(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    const done = (answered) => {
      sock.destroy();
      resolve(answered);
    };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    sock.setTimeout(500, () => done(false));
  });
}

const port = Number(process.env.AUFTAKT_PORT) || 4317;
if (await portAnswers(port)) {
  console.error(
    `Etwas antwortet auf :${port} — Auftakt oder ein Dev-Server läuft noch.\n` +
      'App beenden und Dev-Server stoppen (lsof -ti tcp:4317 -ti tcp:5317 | xargs kill), dann erneut.',
  );
  process.exit(1);
}

// An explicit profile path overrides the installed app's userData — a packaged app started with
// `--user-data-dir=…` keeps its caches there, and that profile deserves the same allowlist rather
// than a second copy of it somewhere else.
const dir = process.argv[2] ?? userDataDir();
if (!existsSync(dir)) {
  console.error(`Kein userData-Verzeichnis unter ${dir} — war die App je installiert und gestartet?`);
  process.exit(1);
}

let cleared = 0;
for (const name of CACHE_DIRS) {
  const target = join(dir, name);
  if (!existsSync(target)) continue;
  rmSync(target, { recursive: true, force: true });
  console.log(`gelöscht: ${name}`);
  cleared += 1;
}
console.log(
  cleared > 0
    ? `${cleared} Cache-Verzeichnis(se) entfernt — der nächste Start ist wieder ein Erststart.`
    : 'Nichts zu löschen — die Caches waren schon leer.',
);
