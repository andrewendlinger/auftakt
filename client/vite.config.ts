import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const SERVER_PORT = process.env.AUFTAKT_PORT ?? '4317';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
