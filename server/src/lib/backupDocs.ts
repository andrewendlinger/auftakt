import { readFileSync, writeFileSync } from 'node:fs';

import { BACKUP_KEEP, BACKUP_POINTS_DIR, PRE_IMPORT_DIR } from '../db';

/**
 * The two files the backup folder explains itself with (WP-41): a README at its root and a
 * MANIFEST inside every restore point. They are the only things in there a customer ever
 * reads — the complaint that started this package was that the folder is unreadable — so the
 * text is German while the file names stay English, and both are written for someone opening
 * the folder in a panic, without the app and without prior knowledge.
 *
 * File names are deliberately NOT where the season name goes. Restoring is a hand copy (see
 * the README below and docs/BACKUP-TESTING.md case 7), which only works while the .db files
 * carry exactly the `file` values from seasons.json — so the label lives in the manifest.
 */

/** Windows line endings, and a BOM so Notepad reads it as UTF-8. */
const BOM = '﻿';

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
 * README.txt at the root of the backup folder.
 *
 * `hasLegacyFlatFiles` adds the paragraph about the flat `auftakt-<stamp>.db` files older
 * versions wrote. Conditional because most folders have none, and a paragraph about files that
 * are not there is exactly the kind of noise this file exists to remove.
 */
export function readmeText(hasLegacyFlatFiles: boolean): string {
  const lines = [
    'Auftakt – Sicherungen',
    '=====================',
    '',
    'In diesem Ordner legt Auftakt automatisch Sicherungen deiner Daten ab: bei jedem',
    'Start der App eine vollständige Kopie aller Saisons. Von Hand ist hier nichts zu',
    'tun. Diese Datei erklärt, was hier liegt und wie du eine Sicherung zurückspielst.',
    '',
    '',
    'Was hier liegt',
    '--------------',
    '',
    `${BACKUP_POINTS_DIR}\\`,
    '    Eine Sicherung je App-Start, als Ordner mit Datum und Uhrzeit im Namen',
    '    (auftakt-JAHR-MONAT-TAG-STUNDE-MINUTE-SEKUNDE-MILLISEKUNDE).',
    '    In jedem dieser Ordner:',
    '        eine .db-Datei je Saison   – die eigentlichen Daten',
    '        seasons.json               – das Verzeichnis aller Saisons',
    '        MANIFEST.txt               – welche Datei zu welcher Saison gehört',
    `    Die ${BACKUP_KEEP} neuesten Sicherungen bleiben erhalten, ältere werden automatisch`,
    '    gelöscht.',
    '',
    `${PRE_IMPORT_DIR}\\`,
    '    Sicherheitskopien aus „Datenbank importieren“: der Stand unmittelbar VOR',
    `    einem Import. Ebenfalls die ${BACKUP_KEEP} neuesten.`,
    '',
    '',
    'Eine Sicherung zurückspielen',
    '----------------------------',
    '',
    '1. Auftakt beenden. Nicht nur das Fenster schließen – die App muss wirklich',
    '   beendet sein, sonst schreibt sie über das Zurückgespielte hinweg.',
    '',
    `2. Unter ${BACKUP_POINTS_DIR}\\ den gewünschten Zeitpunkt heraussuchen. Die MANIFEST.txt`,
    '   in dem Ordner nennt Zeitpunkt, App-Version und die enthaltenen Saisons.',
    '',
    '3. Aus diesem Ordner ALLE .db-Dateien und die seasons.json in das Datenverzeichnis',
    '   von Auftakt kopieren und die Dateien dort ersetzen. Die MANIFEST.txt wird nicht',
    '   mitkopiert – sie wird dort nicht gebraucht.',
    '',
    '   Das Datenverzeichnis ist',
    '       unter Windows:   %APPDATA%\\auftakt',
    '       unter macOS:     ~/Library/Application Support/auftakt',
    '   Der Pfad lässt sich direkt eingeben: im Explorer in die Adresszeile, im Finder',
    '   unter „Gehe zu“ → „Gehe zum Ordner…“.',
    '',
    '4. Falls im Datenverzeichnis noch Dateien liegen, die auf .db-wal oder .db-shm',
    '   enden: diese löschen. Sie gehören zum vorherigen Stand und würden beim nächsten',
    '   Start in die zurückgespielten Daten hineingeschrieben.',
    '',
    '5. Auftakt starten. Alle Saisons aus dieser Sicherung sind wieder da.',
    '',
  ];

  if (hasLegacyFlatFiles) {
    lines.push(
      '',
      'Einzelne .db-Dateien direkt in diesem Ordner',
      '--------------------------------------------',
      '',
      'Die Dateien auftakt-<Zeitstempel>.db, die direkt hier liegen (nicht in einem',
      'Unterordner), stammen aus früheren Auftakt-Versionen. Sie sind gültige Sicherungen',
      'je einer einzelnen Saison und bleiben unangetastet – Auftakt löscht sie nicht.',
      'Zurückspielen lässt sich eine davon in der App: Einstellungen → „Saison & Daten“ →',
      '„Datenbank importieren…“. Der Import ersetzt die gerade geöffnete Saison und legt',
      `vorher eine Sicherheitskopie in ${PRE_IMPORT_DIR}\\ ab.`,
      '',
    );
  }

  lines.push(
    '',
    'Hinweise',
    '--------',
    '',
    '- Die Ordner- und Dateinamen hier nicht ändern: Auftakt erkennt am Namen, was eine',
    '  Sicherung ist und welche die ältesten sind.',
    '- Der Backup-Ordner darf in einer Cloud liegen (Google Drive, OneDrive, Dropbox),',
    '  solange der Ordner auf diesem Rechner liegt. Netzwerkfreigaben (\\\\Server\\Freigabe)',
    '  funktionieren nicht.',
    '- Ändern lässt sich der Backup-Ordner in Auftakt unter Einstellungen →',
    '  „Saison & Daten“ → „Backup-Ordner“.',
    '- Diese Datei wird bei jeder Sicherung neu geschrieben. Eigene Notizen darin gehen',
    '  verloren.',
  );

  return windowsText(lines);
}

/**
 * MANIFEST.txt inside one restore point — the place where the season NAME the customer asked
 * for actually arrives, since the file names cannot carry it (see the module comment).
 */
export function manifestText(
  at: Date,
  version: string,
  seasons: Array<{ file: string; label: string }>,
  /** null when the run found no registry to copy — the manifest must not name a file it has not got. */
  registryFile: string | null,
): string {
  const width = Math.max(registryFile?.length ?? 0, ...seasons.map((s) => s.file.length));
  const pad = (name: string): string => name.padEnd(width);
  const heading = `Auftakt – Sicherung vom ${germanStamp(at)}`;
  return windowsText([
    heading,
    '='.repeat(heading.length),
    '',
    `App-Version: ${version}`,
    '',
    'Enthaltene Saisons:',
    ...seasons.map((s) => `    ${pad(s.file)}  =  ${s.label}`),
    ...(registryFile
      ? ['', `    ${pad(registryFile)}  =  Verzeichnis aller Saisons (gehört mit zurückgespielt)`]
      : []),
    '',
    'Zum Zurückspielen: siehe README.txt zwei Ebenen höher, im Backup-Ordner.',
  ]);
}
