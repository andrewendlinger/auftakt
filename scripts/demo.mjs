// Rebuilds the demo database, then starts the dev servers against it.
//
// This exists because the env var has to reach the server process and a bare
// `AUFTAKT_DATA_DIR=... npm run dev` prefix is not valid on Windows cmd. Nothing else in the
// repo threads env vars into an npm script, so spawning with an explicit env is the portable
// route — and it avoids adding cross-env for one line.
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Must match DEMO_DIR in server/src/demo.ts, which hardcodes it for the same reason: that
// script deletes the directory before rebuilding it, so an inherited AUFTAKT_DATA_DIR pointing
// at real data must never reach it.
const demoDir = resolve(root, '.demo');
const env = { ...process.env, AUFTAKT_DATA_DIR: demoDir };

/**
 * Run an npm script to completion; reject on a non-zero exit so we don't start a broken app.
 * @returns {Promise<void>}
 */
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

// Hand over to the normal dev setup. Ctrl-C works without any of the machinery below —
// it signals the terminal's whole foreground process group, so concurrently, tsx and vite
// each get their own SIGINT. What it does not survive is any exit that signals one process
// instead of the group: the tree is then reparented and keeps :4317 and :5317 for as long as
// the machine is up, invisible to `lsof` once its server child happens to be down, because
// the survivor is the `tsx watch` parent. A later `git switch` touching server/src is enough
// for that orphan to respawn a server on the port the next `npm run demo` wants, which then
// prints „listening" and dies on EADDRINUSE. Same class as DBW-10/DBW-11 in check-backup.mjs,
// and the same remedy: own the process group and take it down deliberately.
const dev = spawn('npm', ['run', 'dev'], {
  cwd: root,
  env,
  // stdout/stderr are inherited so the dev output still reaches the terminal, but stdin is
  // not: a background process group that reads the tty is stopped with SIGTTIN, and `detached`
  // below puts the tree in exactly such a group. Vite only binds its keyboard shortcuts when
  // stdin is a TTY, so this trades `r`/`q` — Ctrl-C is unaffected — for a tree we can reap.
  stdio: ['ignore', 'inherit', 'inherit'],
  shell: true,
  // Own process group, so stopDev() can signal the whole tree at once. Windows has no groups —
  // it gets the taskkill branch instead, and `detached` there would open a console window.
  detached: process.platform !== 'win32',
});

/**
 * Stop the dev tree and everything under it. `shell: true` means the pid we hold is the
 * shell's, with npm, concurrently, tsx and vite underneath, so killing that one pid would
 * leave the rest running — which is the leak this whole block exists to prevent.
 */
function stopDev() {
  if (!dev.pid || dev.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(dev.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      process.kill(-dev.pid, 'SIGTERM'); // negative pid = the whole process group
    }
  } catch {
    /* already gone */
  }
}

// 'exit' is the last-ditch path and may not await anything; the signal handlers exist because
// without a listener Node takes the default action and never emits 'exit' at all.
process.on('exit', stopDev);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopDev();
    process.exit(130);
  });
}

// Being signalled is the good case. The bad one is not being signalled at all: whatever
// launched this script can be killed on its own, leaving us reparented to init with the dev
// tree still ours to clean up. Nothing reports that, so poll for it — one syscall a second.
setInterval(() => {
  if (process.ppid === 1) {
    stopDev();
    process.exit(130);
  }
}, 1000).unref();

// A ChildProcess 'error' event with no listener is thrown as an uncaught exception, so a
// failing spawn here (npm not on PATH, no permission to spawn a shell) would end the run in a
// raw stack trace instead of the German message path the rest of the script uses.
dev.on('error', (err) => {
  console.error(`\nDev-Server konnte nicht gestartet werden: ${err.message}`);
  process.exit(1);
});
dev.on('exit', (code) => process.exit(code ?? 0));
