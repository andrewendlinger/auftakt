// Bundles the Express server and the Electron main/preload for packaging.
// The React client is built separately via `vite build` (client/dist).
import { build } from 'esbuild';

/** @type {import('esbuild').BuildOptions} */
const common = { bundle: true, platform: 'node', target: 'node20', logLevel: 'info' };

// Server → single ESM file. better-sqlite3 stays external (native, rebuilt by
// electron-builder); the createRequire banner lets any bundled CJS deps work.
await build({
  ...common,
  entryPoints: ['server/src/index.ts'],
  outfile: 'server/dist/index.mjs',
  format: 'esm',
  external: ['better-sqlite3'],
  banner: {
    js: "import{createRequire as ___cr}from'module';const require=___cr(import.meta.url);",
  },
});

// Electron main + preload → CJS (Electron's classic entry format).
for (const name of ['main', 'preload']) {
  await build({
    ...common,
    entryPoints: [`electron/${name}.ts`],
    outfile: `electron/dist/${name}.cjs`,
    format: 'cjs',
    external: ['electron'],
  });
}

console.log('✓ bundled server + electron');
