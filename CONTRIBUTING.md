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

- what you did, what you expected, what happened instead
- the app version (Einstellungen → *Saison & Daten* → **Version & Updates**)
- your OS, and whether you are running the packaged app or the dev server
- whether it reproduces against `npm run demo`, which uses invented data

**Never paste real festival data into an issue** — names, e-mail addresses, phone
numbers or notes about identifiable people. The demo dataset exists so a report can be
reproduced without it.

Security problems go through [SECURITY.md](SECURITY.md) instead, privately.

## Running it locally

```bash
node --version    # must match .nvmrc (24) — enforced, see below
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

`npm run demo` writes only to `./.demo/`. It cannot touch a real database in `./.data/`
— `demo.ts` pins its own data directory before the first connection is opened. Prefer
it over `npm run seed`, which is unconditionally destructive.

## Gates

There is no linter. That is a decision, not an oversight — see
[docs/DECISIONS.md](docs/DECISIONS.md). Nor was there a test framework, until going
commercial reversed that half; the same file records the reversal and what it does and
does not change.

```bash
npm run typecheck   # server + client + electron
npm run check       # backup/import, timezones, API invariants, Markdown round-trip
```

Both run in CI on every push and pull request. The four `check:*` scripts are plain
`.mjs` files that boot the real server and assert against it. They are the load-bearing
gate and nothing replaces them — what is being added alongside covers the client, which
they never reached.

[docs/VERIFYING.md](docs/VERIFYING.md) lists the traps that have produced a wrong result
at least once. It is worth reading before writing any check that drives a browser: every
entry is an assertion that would otherwise have been wrong.

Start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing anything that
crosses the REST boundary.

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
