/// <reference types="vite/client" />

/**
 * The running build's version, replaced at build time by `define` in `vite.config.ts` from the
 * **root** package.json (WP-63). Not a bridge call — see the comment there for why.
 */
declare const __APP_VERSION__: string;
