/**
 * The default filenames the two save dialogs open with — „Datenbank exportieren…" and, since
 * WP-71, „Als PDF speichern" on a print sheet.
 *
 * Imports nothing from `electron`, deliberately — the same rule as backup.ts and appLog.ts,
 * and for the same reason: it is what lets `client/src/lib/exportName.test.ts` exercise this
 * from `check:unit`, the only automated run that reaches main-process code at all.
 *
 * It exists because the season label is now part of the name (PR50-03: an export that does not
 * say which season it holds is how the wrong season's data gets handed out), and a label is
 * free text the user typed — „Festival 25/26" would otherwise put a path separator into
 * `defaultPath` and open the dialog in a directory rather than on a filename.
 */

/** Cascade of a long label into a filename nobody can read; the stamp still has to fit. */
const MAX_LABEL_CHARS = 40;

/**
 * Everything outside this set becomes a separator. An allowlist rather than a blocklist of
 * Windows' reserved characters (`<>:"/\|?*`): the label can contain anything a German keyboard
 * produces, including newlines pasted in from elsewhere, and only what is known-safe should
 * reach a filesystem. Letters and digits are matched by Unicode property, so „Öffnung" and
 * „Saison ’26" survive as far as their letters go — macOS and Windows both take umlauts.
 */
const SAFE_RUN = /[^\p{L}\p{N}]+/gu;

/** A label reduced to a filename fragment, or '' when nothing usable is left. */
export function labelSlug(label: string): string {
  return label
    .normalize('NFC')
    .replace(SAFE_RUN, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_LABEL_CHARS)
    .replace(/-+$/, '');
}

/**
 * `auftakt-<label>-<stamp>.db`, falling back to `auftakt-<stamp>.db` when the season has no
 * label or the label is entirely punctuation. `stamp` is passed in — `fileStamp()` from
 * `shared/time` at the call site, which is local wall-clock on purpose (ELP-09: a UTC stamp
 * named the export after the previous day for anyone east of Greenwich).
 */
export function exportFileName(label: string, stamp: string): string {
  const slug = labelSlug(label);
  return slug ? `auftakt-${slug}-${stamp}.db` : `auftakt-${stamp}.db`;
}

/**
 * `Ein-Pager-<Titel>-<Tag>.pdf`, the name „Als PDF speichern" proposes on a print sheet (WP-71).
 *
 * Same two branches and the same `labelSlug` as the export above, and for the harder version of
 * the same reason: `title` is not a season label the user typed once, it is a *project or artist
 * name* — free text that arrived by hand or through the CSV/Notion import, sent over IPC by the
 * renderer, and it becomes part of a filename. „Trio 25/26" is an entirely ordinary one.
 *
 * The stamp is the **day**, not `fileStamp()`'s millisecond: a handout is a snapshot of a page
 * that changes daily, and a second one taken the same afternoon is the same sheet — while
 * `…-2026-08-26-14-30-12-345.pdf` is a name nobody can read out over the phone. The dialog is
 * still the user's to overwrite or rename.
 *
 * German rather than the export's lowercase `auftakt-` prefix, because the two files are for
 * different people: an export is a technical artifact of this app, an Ein-Pager is a page handed
 * to a colleague who never sees Auftakt, and „Ein-Pager" is the app's own word for it.
 */
export function sheetFileName(title: string, day: string): string {
  const slug = labelSlug(title);
  return slug ? `Ein-Pager-${slug}-${day}.pdf` : `Ein-Pager-${day}.pdf`;
}
