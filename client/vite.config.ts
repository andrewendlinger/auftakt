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
    proxy: {
      '/api': `http://localhost:${SERVER_PORT}`,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
