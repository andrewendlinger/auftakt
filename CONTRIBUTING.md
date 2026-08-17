# Contributing

Thanks for looking. Please read the first section before opening anything — the
licence makes this project stricter than most.

## Pull requests are not accepted

Auftakt is licensed under the [PolyForm Strict License 1.0.0](LICENSE.md), which does
not permit modifying the software or distributing derivative works. A pull request is
both, so there is no way for me to merge one, and no way for you to publish a fork
without breaching the licence. This is not a judgement on the contribution — the
licence simply does not have a lane for it.

It is also a single-developer project maintained alongside a real festival's
operations. Reviewing outside changes to a database that holds live production data is
not something I can do responsibly.

If you want to build on Auftakt commercially or otherwise, the answer is a separate
licence, not a fork. Open an issue and we can talk.

## Issues are welcome

Bug reports and ideas are genuinely useful. Helpful things to include:

- what you did, what you expected, what happened instead — Einstellungen → *Programm & Hilfe* →
  **Feedback senden…** asks for exactly these (or the equivalent three for a *Wunsch*) and fills
  the rest in
- for anything that goes wrong during startup: the `Auftakt-Diagnose-<Kennung>.txt` that same
  dialog writes to your desktop when you report a *Fehler*, and asks you to attach. It carries the
  whole of `boot-log.jsonl` — the only record of what the boot animation actually did — plus the
  machine's details
- the app version (Einstellungen → *Programm & Hilfe* → **Version & Updates**)
- your OS, and whether you are running the packaged app or the dev server
- whether it reproduces against `npm run demo`, which uses invented data

**Never paste real festival data into an issue** — names, e-mail addresses, phone
numbers or notes about identifiable people. The demo dataset exists so a report can be
reproduced without it.

Security problems go through [SECURITY.md](SECURITY.md) instead, privately.

## Stack

- **Frontend:** React + TypeScript + Vite + Tailwind CSS + TanStack Query
- **Backend:** Express + better-sqlite3 (one SQLite file = one season's whole database)
- **Shell/packaging:** Electron + electron-builder

Day-to-day work happens in the browser (`npm run dev`); Electron is only the window, the
packaging and the native pieces (file dialogs, backups, external links). The REST boundary is
hard — **no Electron APIs in React**, only the narrow `window.auftakt` preload bridge for
external links and DB export/import. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is the
reference for everything that crosses it.

## Running it locally

```bash
node --version    # must match .nvmrc (24.19.0) — enforced, see below
npm run setup     # root, server and client — three separate installs, no workspaces
npm run demo      # build the demo database and start against it → localhost:5317
```

**Use the Node version in `.nvmrc`.** CI installs with `npm ci`, which refuses a lockfile
that does not match its resolution exactly, and different npm majors resolve optional
transitive dependencies differently. Regenerating a lockfile on another Node version
produces one that fails in CI without failing locally.

This is enforced rather than requested: `engines` in all three `package.json` files pins
Node 24 and npm 11, and the repository's `.npmrc` sets `engine-strict=true`, so a mismatched
install stops with `EBADENGINE` instead of quietly writing a lockfile CI will reject. It had
to be enforced — the advisory version of this paragraph was already here when a lockfile
written under npm 11 broke `main` against CI's npm 10.

If `npm run setup` refuses, your Node is the problem, not the lockfile. Install Node 24 —
with [fnm](https://github.com/Schniz/fnm) (`fnm use`) or [nvm](https://github.com/nvm-sh/nvm)
(`nvm use`), both of which read `.nvmrc`.

**The npm floor is not decoration.** `>=11.17` is what Node 24.19.0 ships. npm 11.6, which Node
25 happens to bundle, resolves a *smaller* tree — it prunes optional platform entries like
`@tailwindcss/oxide-wasm32-wasi`'s dependencies that a Linux `npm ci` then reports as
`Missing … from lock file`. That is the same failure as 2026-08-05, and it comes back whenever
a lockfile is regenerated under the wrong npm. If you have to touch a lockfile, do it under
the `.nvmrc` Node.

**`.nvmrc` pins a full version, not a major.** A bare `24` lets `actions/setup-node` install
whichever 24.x it has cached — it served 24.18.0 (npm 11.16.0) while this machine had 24.19.0
(npm 11.17.0), which is the same npm-version drift one level up. The cost is bumping this file
by hand when a new 24.x matters; the benefit is that "matches CI" is a fact rather than a hope.
Bump `engines.npm` alongside it.

`npm run demo` writes only to `./.demo/`. It cannot touch a real database in `./.data/`
— `demo.ts` pins its own data directory before the first connection is opened. Prefer
it over `npm run seed`, which is unconditionally destructive.

For real data instead:

```bash
npm run seed      # fills ./.data/ — deletes what is there first
npm run dev       # server (4317) + client (5317) → http://localhost:5317
```

`npm run seed` imports `{artists,contacts,projects,events,tasks,links}.csv` from
`AUFTAKT_IMPORT_DIR` (UTF-8, comma-separated, ISO dates, empty cell = unknown) and falls back
to a five-row sample dataset when that folder is absent. In dev the live database is
`./.data/auftakt.db` — one file per season, alongside the `seasons.json` registry. The packaged
app uses Electron's `userData` directory instead. Never put either in a cloud-sync folder.

## Repository layout

```
server/   Express + better-sqlite3: db.ts (schema), seed.ts, demo.ts, routes/, lib/
client/   React app: pages/, components/, api/, lib/ (linkify, dates, colors)
electron/ main.ts, preload.ts, menu.ts, backup.ts
shared/   time.ts — the timestamp convention, shared by server and Electron
scripts/  build.mjs (esbuild bundles), icons.mjs (npm run icons) + the check-*.mjs gates
build/    app icons for electron-builder (icon.icns, icon.ico, icon.png)
docs/     architecture, decisions, verification and test checklists
```

## Gates

There is no linter. That is a decision, not an oversight — see
[docs/DECISIONS.md](docs/DECISIONS.md). Nor was there a test framework, until going
commercial reversed that half; the same file records the reversal and what it does and
does not change.

```bash
npm run typecheck   # server + client + electron
npm run check       # unit, backup/import, timezones, API invariants, Markdown round-trip
```

Both run in CI on every push and pull request. `npm run check` runs five gates, in this order:

| script | guards |
| --- | --- |
| `check:unit` | client Vitest over `client/src/**/*.test.ts` — the pure logic the boot-the-server scripts cannot reach. Four of them reach *up* into `electron/`, the only automated coverage the main process has |
| `check:backup` | the backup/import path — boots the server against a temp dir and drives `/api/backup` |
| `check:dates` | the naive-local-time convention — re-runs the API under two timezones 25 h apart |
| `check:api` | server data invariants — purge vs live children, the `writable` allowlist, `parent_id` rules, restore semantics, season copies |
| `check:markdown` | the rich-text editor's Markdown round-trip, under jsdom |

Four of the five are plain `.mjs` files that boot the real server and assert against it. They
are the load-bearing gate and nothing replaces them.

Two more gates sit deliberately **outside** `check`, each because it needs something `check` may
never require. `npm run check:package` inspects what electron-builder actually packed, so it needs
a build, and CI runs it in the `build` job. `npm run check:browser` drives the real UI with
Chromium — the two-window season matrix and the core task, column and editor paths — so it needs a
browser binary and a free `:5317`, rebuilds `.demo` and refuses to start beside a running
`npm run demo`. CI gives it its own job, on every pull request.

[docs/VERIFYING.md](docs/VERIFYING.md) lists the traps that have produced a wrong result
at least once. It is worth reading before writing any check that drives a browser: every
entry is an assertion that would otherwise have been wrong.

### CI

`.github/workflows/build.yml` has four jobs:

- **`checks`** — on every push, pull request and tag: `npm run typecheck`, `npm run check` and
  `npm audit` on `ubuntu-latest`.
- **`browser`** — beside `checks`, same trigger: installs Chromium (cached) and runs
  `npm run check:browser` on `ubuntu-latest`. Required to merge into `main`, as `checks` is.
- **`build`** — only for a `v*` tag or a manual run (`workflow_dispatch`): the `.dmg` on
  `macos-latest` and the NSIS installer on `windows-latest`, plus `check:package`, a build
  provenance attestation and an SBOM per platform.
- **`release`** — only for a `v*` tag: uploads both installers and `latest.yml` to the
  [Releases page](https://github.com/andrewendlinger/auftakt/releases) **as a draft**, which is
  then smoke-tested and published by hand.

## Building installers

```bash
# development: run `npm run dev` first, then in a second terminal
npm run electron:dev

# installers — output in ./release
npm run dist         # current platform
npm run dist:mac     # macOS .dmg
npm run dist:win     # Windows NSIS
```

`npm run build` builds the client (`client/dist`) and bundles server and Electron
(`server/dist`, `electron/dist`) with esbuild; electron-builder packs the result according to
`electron-builder.yml`, whose comments explain the parts that are load-bearing rather than
cosmetic. Neither installer is signed — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
("Packaging") and [SECURITY.md](SECURITY.md).

## Documentation

| File | Contents |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | the three tiers, timestamp convention, seasons, backups, CRUD factory, soft delete, the data-driven task columns, client contracts |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | what was deliberately *not* done, and why |
| [`docs/VERIFYING.md`](docs/VERIFYING.md) | traps when verifying by hand in the browser |
| [`docs/BACKUP-TESTING.md`](docs/BACKUP-TESTING.md) | the manual backup/import checklist, run on both OSes before each release |
| [`SECURITY.md`](SECURITY.md) | reporting route, signing, verifying a download |

## Reading the commit log

Commits use an English imperative subject. Where one closes a known finding it carries
that finding's ID in parentheses — `Replace the live DB atomically on import (DBW-04)`.

Those IDs (`WP-`, `CCL-`, `FIX-`, `TTU-`, `SHL-`, `DBW-`, `ELP-`, `PGS-`, `SDL-`, …)
come from a code review closed in August 2026. Its working notes are not in the repo,
so the commit log is the index:

```bash
git log --grep=CCL-24
```

If you find an ID referenced in a comment and want the reasoning behind the fix, that
is where it lives.
