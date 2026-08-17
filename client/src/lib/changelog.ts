import type { Announcement } from '../api/types';
/**
 * `isNewer` is imported rather than copied, and the import crosses a tier on purpose.
 *
 * `electron/updateCheck.ts` is the *Electron-free* half of the update check — its own docstring
 * says so, it imports nothing, and it is already the file the client Vitest suite reaches into
 * for the four cross-tree tests (`backupDir`, `bootLog`, `cascade`, `exportName`). The rule in
 * docs/ARCHITECTURE.md is that React never imports Electron **APIs**; a numeric compare of two
 * `X.Y.Z` tags we mint ourselves is not one, and it is exactly the same question the update card
 * asks about a release tag. Answering it twice in one app is how a `1.10.0`-vs-`1.9.0`
 * comparison ends up disagreeing between two surfaces that both claim to know what „newer"
 * means. `fetchLatestRelease` beside it is unreferenced here and tree-shaken out of the bundle.
 */
import { isNewer } from '../../../electron/updateCheck';
/**
 * The changelog, inlined at build time (WP-63).
 *
 * `?raw` — the first one in the repo — rather than a copy step into `client/public/`, because
 * the file has to be *the* file this build was made from. `docs/DECISIONS.md` already committed
 * to that: „the entry ships in the commit the tag names … the packaged app carries the file it
 * was built from". An inlined import is that guarantee mechanically; a copy step into
 * `client/dist` would give the same bytes but through a second path that can be skipped, and a
 * runtime `fetch` would put the notes behind a request that can fail.
 *
 * It also stays out of `electron-builder.yml`. Adding `CHANGELOG.md` to the `files:` allowlist
 * is the one thing that must never happen there — the comment in that file spells out why (a
 * repo-root entry trips `containsOnlyIgnore()` and packs the whole repository, 290 asar entries
 * against 112) and `npm run check:package` guards it. Inlined into the JS bundle, the changelog
 * arrives inside `client/dist/**`, which is already packed.
 *
 * Verified through the dev server as well as the build: Vite's workspace root for `client/`
 * resolves to `client/` itself, so this sits above `server.fs.allow`'s default — and is served
 * anyway, because the file is reached as an import of a module in the graph rather than as a
 * bare `/@fs/` request. No `fs.allow` widening, which would have opened the whole repository
 * (`.data/`, `files/`, `.demo/`) to the dev server for the sake of one file.
 */
import CHANGELOG_MD from '../../../CHANGELOG.md?raw';

/**
 * „Was ist neu" — turning `CHANGELOG.md` into the announcement shown on the first start after
 * an update (WP-63).
 *
 * Windows updates silently through electron-updater, so without this the user's app changes
 * under them and nothing ever says what changed. The other half of the mechanism — dated
 * announcements — is the server's (`server/src/lib/announcements.ts`); this half is the
 * client's, because the text lives in the bundle and the version does too.
 */

/** The running build's version. Replaced at build time — see `vite.config.ts`. */
export const APP_VERSION: string = __APP_VERSION__;

export interface ChangelogEntry {
  /** The bare `X.Y.Z` the heading opens with. */
  version: string;
  /** The heading without its `## `, e.g. `0.10.0 — 16. August 2026`. */
  heading: string;
  /** Everything under the heading, blank lines trimmed off both ends. Markdown. */
  body: string;
}

/**
 * The anchor, and it is a contract rather than a convenience: `docs/DECISIONS.md` records that
 * `## X.Y.Z` is a **bare version number** precisely so this split is possible. A `## ` heading
 * inside an entry that is not a version is left alone by the digits.
 */
const ENTRY_HEADING = /^## (\d+\.\d+\.\d+)/;

/** Blank lines off both ends, and nothing else — the body is Markdown and stays verbatim. */
function trimBlank(lines: string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === '') start++;
  while (end > start && lines[end - 1]!.trim() === '') end--;
  return lines.slice(start, end).join('\n');
}

/**
 * Split the changelog into its version entries, in file order (newest first, by the file's own
 * convention). The prose above the first `## X.Y.Z` — the file's intro — belongs to no entry and
 * is dropped.
 */
export function parseChangelog(md: string): ChangelogEntry[] {
  const out: ChangelogEntry[] = [];
  let version: string | null = null;
  let heading = '';
  let body: string[] = [];
  const flush = () => {
    if (version !== null) out.push({ version, heading, body: trimBlank(body) });
  };
  for (const line of md.split('\n')) {
    const match = ENTRY_HEADING.exec(line);
    if (match) {
      flush();
      version = match[1]!;
      heading = line.replace(/^##\s*/, '').trimEnd();
      body = [];
    } else if (version !== null) {
      body.push(line);
    }
  }
  flush();
  return out;
}

/**
 * The entries a user coming from `seenVersion` has not read yet, capped at `current`.
 *
 * The upper bound is not theoretical: an installation can go *backwards* — a customer
 * reinstalling an older build over a newer one — and the file that ships with the older build
 * still knows nothing about the newer entries. Filtering rather than slicing means an entry
 * inserted out of order, or a version skipped entirely, is still handled by the comparison
 * instead of by trusting the file's order.
 */
export function changelogSince(
  entries: ChangelogEntry[],
  seenVersion: string,
  current: string,
): ChangelogEntry[] {
  return entries.filter((e) => isNewer(e.version, seenVersion) && !isNewer(e.version, current));
}

/**
 * The „Was ist neu" announcement, or `null` when there is nothing to say.
 *
 * `null` in four cases, and each of them matters:
 * - **`seenVersion === null`** — no start has ever recorded a version, i.e. this is a first start.
 *   Someone who has just installed the app needs no list of what used to be different, so the
 *   marker is initialised silently and this stays quiet. It is also what keeps the feature inert
 *   on a fresh database, which is what `npm run check:browser` runs against: an unexpected
 *   overlay there would swallow every click in the gate.
 * - **not actually newer** — the same version, or an older one.
 * - **no entries in range** — a release whose changelog says nothing shows nothing.
 * - a body that came out empty.
 *
 * The id carries the version, so confirming 0.11.0 does not confirm 0.12.0.
 */
export function changelogAnnouncement(
  current: string,
  seenVersion: string | null,
  md: string = CHANGELOG_MD,
): Announcement | null {
  if (seenVersion === null || !isNewer(current, seenVersion)) return null;
  const entries = changelogSince(parseChangelog(md), seenVersion, current);
  if (entries.length === 0) return null;
  // One entry needs no heading — the card's title already names the version. Several do, or the
  // bullets of three releases run together as one undifferentiated list.
  const body =
    entries.length === 1
      ? entries[0]!.body
      : entries.map((e) => `### ${e.heading}\n\n${e.body}`).join('\n\n');
  if (!body.trim()) return null;
  return { id: `version:${current}`, version: current, title: `Auftakt ${current}`, body };
}
