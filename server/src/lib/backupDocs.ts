import { readFileSync, writeFileSync } from 'node:fs';

/**
 * The two files the backup folder explains itself with (WP-41, rewritten in WP-68): a README at
 * its root and a MANIFEST inside every restore point. They are the only things in there a
 * customer ever reads, and he reads them on the day his data is gone — so the text is German,
 * the file names stay English, and every sentence assumes no app, no prior knowledge and no
 * patience.
 *
 * WP-68 rewrote both after the macOS pass read them cold (case 7, „zu kompliziert"). The
 * instruction is now written for ONE machine — the one the app runs on — with the other
 * platform's two differences in a closing section. That split is what lets step 1 be true:
 * closing the last window quits on Windows and deliberately does not on macOS (the
 * `window-all-closed` handler in electron/main.ts returns early on darwin).
 *
 * This module imports nothing but node:fs, on purpose. `client/src/lib/backupDocs.test.ts`
 * renders both platforms, which is the only automated look at the Windows text from a Mac or
 * from CI — and an import of ../db would drag better-sqlite3 into that run. Hence the folder
 * names, the retention count and the season word all arrive as options.
 *
 * File names are deliberately NOT where the season name goes. Restoring is a hand copy (see the
 * README below and docs/BACKUP-TESTING.md case 7), which only works while the .db files carry
 * exactly the `file` values from seasons.json — so the label lives in the manifest.
 */

/**
 * A BOM so Notepad reads the file as UTF-8. Written as an escape, never as the character:
 * U+FEFF is invisible in every editor and diff, so a formatter or a copy-paste through
 * anything that strips zero-width characters would drop it without a trace — and turn every
 * umlaut in these two files into the mojibake they exist to avoid.
 */
const BOM = '\uFEFF';

/**
 * The backup folder typically sits on a Windows machine inside Google Drive, and both halves
 * of this are load-bearing there: without CRLF, Notepad renders the whole file as one line;
 * without the BOM it guesses ANSI and every umlaut turns to mojibake.
 */
export function windowsText(lines: string[]): string {
  return BOM + lines.join('\r\n') + '\r\n';
}

/**
 * Write one of these two documents: skip an identical file, and never let a failure escape.
 *
 * The README is regenerated on every backup run, i.e. on every app start; rewriting identical
 * bytes would add a Google Drive revision each time. And a Drive/OneDrive client can hold a
 * lock on a file it is syncing, so a refused write is a plausible, harmless outcome — it must
 * not turn a perfectly good backup into the "no backup was written" error dialog that
 * electron/main.ts raises when runBackup throws. The databases are the backup's contract; the
 * prose is not, and `npm run check:backup` is what keeps it from going missing unnoticed.
 */
export function writeDoc(path: string, text: string): void {
  try {
    if (readFileSync(path, 'utf8') === text) return;
  } catch {
    /* not there yet, or unreadable — fall through and try to write it */
  }
  try {
    writeFileSync(path, text, 'utf8');
  } catch {
    /* see above: the data is the backup's contract, the prose is not */
  }
}

/** `13.08.2026, 21:04 Uhr` — for humans, built by hand for the reason shared/time.ts gives. */
export function germanStamp(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;
}

/**
 * The app version for the manifest. Electron pins it into the environment before importing the
 * bundled server (electron/main.ts), which is the only place that knows it: server/package.json
 * carries its own version and the root one is not readable from the packed bundle.
 */
export function appVersion(): string {
  return process.env.AUFTAKT_APP_VERSION?.trim() || 'unbekannt';
}

/**
 * The word the customer chose for a season. He renamed it in Einstellungen because „Saison" is
 * not what he calls the thing, so these two files — the ones he reads when nothing else is left
 * — must not be the last place that keeps calling it that. Read from seasons.json by
 * `seasonTerms()` in db.ts; the defaults there mirror `useSeasonTerm` on the client.
 */
/**
 * NOTE for anyone editing the prose: the customer's word has an unknowable grammatical gender,
 * so it may never be preceded by an article or an inflected determiner — „einer einzelnen
 * Festival" is what that produces. Safe: „je <singular>", „aller <plural>", „Diese <plural>",
 * „„<singular> & Daten"". Everything else gets rephrased around the word, as the client's own
 * strings do.
 */
export interface DocTerms {
  singular: string;
  plural: string;
}

export type DocPlatform = 'windows' | 'mac';

/**
 * Everything the two instructions do not share, in one table. The steps below are written once
 * and read from here, so the two renderings cannot drift apart in structure — only in the
 * handful of places that are meant to differ. The closing „if you are sitting at the other
 * machine" section is built from the *other* entry, which is why each field has to read
 * correctly in both positions.
 */
interface PlatformCopy {
  /** after „Diese Anleitung ist …" */
  dative: string;
  /** after „Wenn du an … sitzt" */
  atOne: string;
  /** step 1 — the step that genuinely differs, in full */
  quit: string[];
  /** the same thing, short, for the other platform's section — already bulleted and wrapped */
  quitShort: string[];
  /** the spelling that works on any machine of this platform, incl. a brand-new one */
  portablePath: string;
  /** step 5, indented three spaces like the rest of a step body */
  reachStep: string[];
  /** the same route as a bullet's continuation, indented two */
  reachOther: string[];
  /** step 6 */
  asks: string;
}

const PLATFORMS: Record<DocPlatform, PlatformCopy> = {
  windows: {
    dative: 'für Windows',
    atOne: 'einem Windows-Rechner',
    quit: [
      '1. Beende Auftakt: Schließe alle Auftakt-Fenster. Erst dann ist Auftakt',
      '   wirklich zu — sonst sind gleich wieder die alten Daten da.',
    ],
    quitShort: ['- Beenden: alle Auftakt-Fenster schließen, mehr ist nicht nötig.'],
    portablePath: '%APPDATA%\\auftakt',
    reachStep: [
      '   So kommst du hin: im Explorer oben in die Adresszeile klicken, den',
      '   Pfad eintippen, Enter drücken.',
    ],
    reachOther: ['  Diesen Text im Explorer oben in die Adresszeile tippen, Enter drücken.'],
    asks: 'Windows fragt',
  },
  mac: {
    dative: 'für den Mac',
    atOne: 'einem Mac',
    quit: [
      '1. Beende Auftakt: Klicke oben links auf „Auftakt“ und dann auf',
      '   „Auftakt beenden“. Nur das Fenster zu schließen reicht nicht — sonst',
      '   sind gleich wieder die alten Daten da.',
    ],
    quitShort: [
      '- Beenden: oben links „Auftakt“ → „Auftakt beenden“. Das Fenster zu',
      '  schließen reicht dort nicht.',
    ],
    portablePath: '~/Library/Application Support/auftakt',
    reachStep: [
      '   So kommst du hin: im Finder oben im Menü „Gehe zu“ →',
      '   „Gehe zum Ordner…“, den Pfad eintippen, Enter drücken.',
    ],
    reachOther: [
      '  Diesen Pfad im Finder unter „Gehe zu“ → „Gehe zum Ordner…“ eintippen,',
      '  Enter drücken.',
    ],
    asks: 'Der Mac fragt',
  },
};

export interface ReadmeOptions {
  /** which machine the reader is sitting at — the app runs on it, so it is the one that counts */
  platform: DocPlatform;
  /** this machine's data directory, absolute, so step 5 can name it instead of describing it */
  dataDir: string;
  terms: DocTerms;
  /** BACKUP_KEEP */
  keep: number;
  /** BACKUP_POINTS_DIR */
  pointsDir: string;
  /** PRE_IMPORT_DIR */
  preImportDir: string;
  /**
   * Adds the paragraph about the flat `auftakt-<stamp>.db` files older versions wrote.
   * Conditional because most folders have none, and a paragraph about files that are not there
   * is exactly the kind of noise this file exists to remove.
   */
  hasLegacyFlatFiles: boolean;
}

/** `Text` under a heading, underlined the way the rest of the file underlines headings. */
function heading(text: string, rule: string): string[] {
  return [text, rule.repeat(text.length), ''];
}

/**
 * README.txt at the root of the backup folder — the restore instruction, for one platform.
 *
 * Written top to bottom for someone in a hurry: what is here, then the steps, then the other
 * machine, then the small print. Nothing above the steps is needed to follow them.
 */
export function readmeText(o: ReadmeOptions): string {
  const self = PLATFORMS[o.platform];
  const other = PLATFORMS[o.platform === 'mac' ? 'windows' : 'mac'];
  const t = o.terms;

  // Padded so the three arrows line up whatever the customer calls a season.
  const inside: Array<[string, string]> = [
    [`eine .db-Datei je ${t.singular}`, 'deine Daten'],
    ['seasons.json', `die Liste aller ${t.plural}`],
    ['MANIFEST.txt', 'was in diesem Backup steckt'],
  ];
  const w = Math.max(...inside.map(([left]) => left.length));

  const lines = [
    ...heading('Auftakt – deine Backups', '='),
    'Auftakt sichert deine Daten bei jedem Start in diesen Ordner. Du musst',
    'dafür nichts tun.',
    '',
    'Diese Datei erklärt, was hier liegt und wie du ein Backup lädst, wenn du',
    'deine Daten zurückbrauchst.',
    '',
    '',
    ...heading('Was hier liegt', '-'),
    o.pointsDir,
    '    Ein Ordner je Backup. Die Namen haben dieses Format:',
    '',
    '        auftakt-JAHR-MONAT-TAG-STUNDE-MINUTE-SEKUNDE-MILLISEKUNDE',
    '',
    '    Also zum Beispiel: auftakt-2026-08-18-09-14-02-317',
    '',
    '    In jedem dieser Ordner liegen:',
    '',
    ...inside.map(([left, right]) => `        ${left.padEnd(w)}   – ${right}`),
    '',
    `    Die ${o.keep} neuesten Backups bleiben liegen. Ältere löscht Auftakt selbst.`,
    '',
    o.preImportDir,
    '    Dasselbe, aber angelegt kurz vor einem „Datenbank importieren…“: der',
    `    Stand von direkt davor. Auch hier bleiben die ${o.keep} neuesten liegen.`,
    '',
    '',
    ...heading('Ein Backup laden', '-'),
    `Diese Anleitung ist ${self.dative}. Sitzt du an ${other.atOne}, lies den`,
    'letzten Abschnitt.',
    '',
    ...self.quit,
    '',
    `2. Öffne hier den Ordner „${o.pointsDir}“. Jeder Ordner darin ist ein Backup,`,
    '   und der Name sagt dir, von wann es ist.',
    '',
    '3. Du bist unsicher, welches das richtige ist? Öffne in dem Ordner die',
    '   Datei MANIFEST.txt. Dort steht, wann das Backup entstanden ist und',
    '   was darin steckt.',
    '',
    '4. Kopiere aus dem Ordner ALLE .db-Dateien und die Datei seasons.json.',
    '   Die MANIFEST.txt brauchst du nicht.',
    '',
    '5. Öffne den Ordner mit deinen Auftakt-Daten. Auf diesem Rechner ist das:',
    '',
    `       ${o.dataDir}`,
    '',
    ...self.reachStep,
    `   Auf einem anderen Rechner heißt er ${self.portablePath}.`,
    '',
    `6. Füge die kopierten Dateien dort ein. ${self.asks}, ob die vorhandenen`,
    '   Dateien ersetzt werden sollen: ja, ersetzen.',
    '',
    '7. Sieh nach, ob in dem Ordner Dateien liegen, deren Name auf .db-wal oder',
    '   .db-shm endet. Lösche sie. Wenn da keine sind, ist auch gut.',
    '',
    '8. Starte Auftakt. Deine Daten sind wieder so, wie sie zum Zeitpunkt des',
    '   Backups waren.',
    '',
  ];

  if (o.hasLegacyFlatFiles) {
    lines.push(
      '',
      ...heading('Einzelne .db-Dateien direkt in diesem Ordner', '-'),
      'Dateien wie auftakt-<Zeitstempel>.db, die direkt hier liegen und nicht in',
      'einem Unterordner, sind älter. Sie stammen aus früheren Auftakt-Versionen',
      'oder aus „Datenbank exportieren…“. Auftakt löscht sie nicht.',
      '',
      'Jede Datei ist ein Backup für sich. So lädst du eine: Auftakt öffnen,',
      `Einstellungen → „${t.singular} & Daten“ → „Datenbank importieren…“. Das`,
      'ersetzt, was gerade offen ist — Auftakt legt vorher selbst ein Backup',
      `davon im Ordner „${o.preImportDir}“ ab.`,
      '',
    );
  }

  lines.push(
    '',
    ...heading(`Wenn du an ${other.atOne} sitzt`, '-'),
    'Die Schritte sind dieselben. Zwei Dinge sind dort anders:',
    '',
    ...other.quitShort,
    '- Der Ordner mit deinen Auftakt-Daten heißt dort:',
    '',
    `      ${other.portablePath}`,
    '',
    ...other.reachOther,
    '',
    '',
    ...heading('Gut zu wissen', '-'),
    '- Ändere hier keine Ordner- oder Dateinamen. Auftakt erkennt am Namen, was',
    '  ein Backup ist und welches das älteste ist.',
    '- Dieser Ordner darf in der Cloud liegen (Google Drive, OneDrive, Dropbox),',
    '  solange er auch auf diesem Rechner liegt. Ein Netzlaufwerk oder eine',
    '  Server-Freigabe funktioniert nicht.',
    '- Einen anderen Ordner wählst du in Auftakt unter Einstellungen →',
    `  „${t.singular} & Daten“ → „Backup-Ordner“.`,
    '- Auftakt schreibt diese Datei bei jedem Backup neu. Eigene Notizen darin',
    '  gehen verloren.',
  );

  return windowsText(lines);
}

export interface ManifestOptions {
  at: Date;
  version: string;
  seasons: Array<{ file: string; label: string }>;
  /** null when the run found no registry to copy — the manifest must not name a file it has not got. */
  registryFile: string | null;
  terms: DocTerms;
}

/**
 * MANIFEST.txt inside one restore point — the place where the season NAME the customer asked
 * for actually arrives, since the file names cannot carry it (see the module comment).
 *
 * The `<file>  =  <label>` shape is asserted by `npm run check:backup`, and the label must stay
 * the last thing on its line: nothing may be wrapped around it.
 */
export function manifestText(o: ManifestOptions): string {
  const width = Math.max(o.registryFile?.length ?? 0, ...o.seasons.map((s) => s.file.length));
  const pad = (name: string): string => name.padEnd(width);
  const title = `Auftakt – Backup vom ${germanStamp(o.at)}`;
  return windowsText([
    ...heading(title, '='),
    `App-Version: ${o.version}`,
    '',
    `Diese ${o.terms.plural} sind gesichert:`,
    '',
    ...o.seasons.map((s) => `    ${pad(s.file)}  =  ${s.label}`),
    ...(o.registryFile
      ? ['', `    ${pad(o.registryFile)}  =  die Liste aller ${o.terms.plural}, gehört mit dazu`]
      : []),
    '',
    'So lädst du dieses Backup: Die Datei README.txt im Backup-Ordner erklärt es',
    'Schritt für Schritt.',
  ]);
}
