import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const SERVER_PORT = process.env.AUFTAKT_PORT ?? '4317';

/**
 * The running build's version, baked in (WP-63).
 *
 * The „Was ist neu" card compares this against the last version the installation confirmed, so
 * it needs *a* version in every context the app runs in — and `window.auftakt.getVersion()` is
 * not one: the bridge is absent in browser dev, which is where the whole UI is developed,
 * verified and driven by `npm run check:browser`. A feature that can only exist under Electron
 * would also have to be verified there, and `docs/VERIFYING.md` exists precisely because that is
 * not how this repo works.
 *
 * Build time rather than a bridge call for a second reason: the card must be able to decide it
 * has nothing to show *synchronously*, on the first render. An awaited version means a pending
 * state on every start of every installation, for a feature that is inert on almost all of them.
 *
 * It is read from the **root** package.json — the one `electron-builder` packages and
 * `app.getVersion()` reports — so the two spellings of „which version is this" cannot drift.
 * `CHANGELOG.md` is inlined from the same directory at the same moment (`lib/changelog.ts`), so
 * the version and the notes that describe it always come from one commit.
 */
const rootPkg = new URL('../package.json', import.meta.url);
const APP_VERSION = (JSON.parse(readFileSync(fileURLToPath(rootPkg), 'utf8')) as { version: string }).version;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  // Relative base so the built bundle also loads from file:// inside Electron.
  base: './',
  server: {
    port: 5317,
    // Fail rather than slide to the next free port. 5317 is not a preference: the server's
    // ALLOWED_ORIGINS is built from it, so a dev client that landed on 5318 would have every
    // write answered with a bare 403 and would read as a broken app (docs/VERIFYING.md). It also
    // keeps `check:browser` honest — a fallback would leave it driving whatever holds 5317.
    strictPort: true,
    proxy: {
      '/api': `http://localhost:${SERVER_PORT}`,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
