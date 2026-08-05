/**
 * The app's one timestamp format, shared by the server and the Electron main process.
 *
 * Everything Auftakt stores is **naive local time** — the same shape the user types into a
 * date field, so a machine stamp and a hand-entered date are the same kind of string and the
 * client needs exactly one parser (`client/src/lib/dates.ts`). Building the parts from
 * `getFullYear()/getHours()/…` rather than `toISOString()` is the whole point: an ISO string is
 * UTC, so between local midnight and the UTC offset it names the previous calendar day, and
 * every consumer that slices its first 10 characters then reports the wrong day (FIX-06).
 *
 * On the SQL side the counterpart is the `'localtime'` modifier on every `date('now', …)` /
 * `datetime('now', …)`; see docs/ARCHITECTURE.md.
 *
 * Imported across the tier boundary so the format has one definition (ELP-11). It stays
 * dependency-free on purpose: esbuild inlines it into both bundles and `tsx` resolves it in dev.
 */

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** `YYYY-MM-DD` — the local calendar day. */
export function localDay(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `YYYY-MM-DD HH:MM:SS` — SQLite's `datetime()` space format, in local time. */
export function localStamp(d: Date = new Date()): string {
  return `${localDay(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * `YYYY-MM-DD-HH-MM-SS-mmm` — filesystem-safe, local, and unique to the millisecond.
 *
 * The milliseconds are not cosmetic: backup folders are named after this stamp and
 * `mkdirSync(…, { recursive: true })` silently reuses an existing folder, so at whole-second
 * resolution a startup backup landing in the same second as a user-triggered one overwrote the
 * earlier restore point instead of adding a second (DBW-09). Still sorts lexicographically,
 * which is what the pruning in routes/backup.ts relies on.
 */
export function fileStamp(d: Date = new Date()): string {
  return `${localDay(d)}-${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`;
}
