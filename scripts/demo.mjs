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
// Must match the default in server/src/demo.ts.
const demoDir = process.env.AUFTAKT_DATA_DIR?.trim() || resolve(root, '.demo');
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
dev.on('exit', (code) => process.exit(code ?? 0));
