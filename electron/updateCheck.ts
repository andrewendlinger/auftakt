/**
 * The Electron-free half of the update check: GitHub Releases API + version compare.
 * Kept import-free of `electron` so it can be smoke-tested standalone with tsx
 * (`npx tsx -e "…" `), which the packaged main process can't be.
 */

export const RELEASES_URL = 'https://github.com/andrewendlinger/auftakt/releases';
const LATEST_API = 'https://api.github.com/repos/andrewendlinger/auftakt/releases/latest';

export interface UpdateStatus {
  current: string;
  latest: string | null;
  url: string;
  updateAvailable: boolean;
  /** true when this build can download + install the update itself (packaged Windows). */
  canInstall: boolean;
}

/** Numeric compare of our own `X.Y.Z` tags — no semver dep needed for versions we mint. */
export function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [a, b] = [parse(latest), parse(current)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** GitHub API check — throws on any non-OK response (offline, 404 while private, rate limit). */
export async function fetchLatestRelease(current: string): Promise<Omit<UpdateStatus, 'canInstall'>> {
  const r = await fetch(LATEST_API, { headers: { accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`GitHub API: ${r.status}`);
  const json = (await r.json()) as { tag_name?: string; html_url?: string };
  const latest = (json.tag_name ?? '').replace(/^v/, '');
  if (!latest) throw new Error('GitHub API: kein Tag im Release');
  return {
    current,
    latest,
    url: json.html_url ?? RELEASES_URL,
    updateAvailable: isNewer(latest, current),
  };
}
