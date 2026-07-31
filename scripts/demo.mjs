// Rebuilds the demo database, then starts the dev servers against it.
//
// This exists because the env var has to reach the server process and a bare
// `AUFTAKT_DATA_DIR=... npm run dev` prefix is not valid on Windows cmd. Nothing else in the
// repo threads env vars into an npm script, so spawning with an explicit env is the portable
// route — and it avoids adding cross-env for one line.
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Must match DEMO_DIR in server/src/demo.ts, which hardcodes it for the same reason: that
// script deletes the directory before rebuilding it, so an inherited AUFTAKT_DATA_DIR pointing
// at real data must never reach it.
const demoDir = resolve(root, '.demo');
const env = { ...process.env, AUFTAKT_DATA_DIR: demoDir };

/** Run an npm script to completion; reject on a non-zero exit so we don't start a broken app. */
function run(args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn('npm', args, { cwd: root, env, stdio: 'inherit', shell: true });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolveRun() : reject(new Error(`npm ${args.join(' ')} exited with ${code}`)),
    );
  });
}

try {
  await run(['run', 'demo:seed']);
} catch (err) {
  console.error(`\nDemo-Datenbank konnte nicht gebaut werden: ${err.message}`);
  process.exit(1);
}

// Hand over to the normal dev setup; -k in its concurrently call handles shutdown.
const dev = spawn('npm', ['run', 'dev'], { cwd: root, env, stdio: 'inherit', shell: true });
// A ChildProcess 'error' event with no listener is thrown as an uncaught exception, so a
// failing spawn here (npm not on PATH, no permission to spawn a shell) would end the run in a
// raw stack trace instead of the German message path the rest of the script uses.
dev.on('error', (err) => {
  console.error(`\nDev-Server konnte nicht gestartet werden: ${err.message}`);
  process.exit(1);
});
dev.on('exit', (code) => process.exit(code ?? 0));
