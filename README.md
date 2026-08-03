# Auftakt

Lokale Desktop-App (Electron) zur Verwaltung von Künstlern und ihren Projekten
bei einem klassischen Musikfestival. **Eine Datenbank = eine Saison.** Alle Daten
liegen lokal; Phase 1 ist Einzelnutzer.

## Stack

- **Frontend:** React + TypeScript + Vite + Tailwind CSS + TanStack Table
- **Backend:** Express + better-sqlite3 (eine SQLite-Datei = die ganze Datenbank)
- **Shell/Packaging:** Electron + electron-builder

Der Alltag läuft im Browser (`npm run dev`); Electron ist nur Fenster + Packaging
und die nativen Funktionen (Datei-Dialoge, Backups, externe Links). Klare
REST-Grenze — **keine Electron-APIs in React** (nur eine schmale
`window.auftakt`-Preload-Brücke für externe Links / DB-Export/Import).

## Erste Schritte

```bash
npm run setup     # installiert root, server und client
npm run demo      # Demo-Datenbank bauen + starten → http://localhost:5317
```

`npm run demo` baut eine Demo-Datenbank aus `server/src/demo.ts` und startet die
Anwendung damit. Der Datensatz deckt alle Sonderfälle ab (Unteraufgaben, farbige
Aufgaben, archivierte Aufgaben, eigene Spalten, festivalweite Todos) und liegt in
`./.demo/` — **die echte Datenbank in `./.data/` wird dabei nie angefasst.**
`npm run demo:seed` baut ihn neu, jeder Lauf beginnt bei null.

Für die echten Daten stattdessen:

```bash
npm run seed      # befüllt ./.data/ (Achtung: löscht den bisherigen Inhalt)
npm run dev       # Server (4317) + Client (5317) → http://localhost:5317
```

`npm run seed` importiert aus CSVs, wenn `AUFTAKT_IMPORT_DIR` auf einen Ordner mit
`{artists,contacts,projects,events,tasks,links}.csv` zeigt (UTF-8, komma-getrennt,
ISO-Daten, leere Zellen = unbekannt) — sonst legt es einen minimalen Beispieldatensatz
aus fünf Zeilen an.

## Daten & Speicherorte

- **Live-DB (dev):** `./.data/auftakt.db` (nie in einen Cloud-Ordner legen)
- **Live-DB (App):** Electron `userData`-Verzeichnis
- **Backups:** beim App-Start eine datierte Kopie in den einmalig gewählten Ordner
  (z. B. Google Drive); die letzten 30 bleiben erhalten
- Soft-Delete überall (`deleted_at`), Undo per Toast, Purge nach 30 Tagen — sobald
  nichts mehr auf den Eintrag verweist; sonst bleibt er im Papierkorb
- Erledigte Aufgaben rutschen nach unten (ausgegraut) und wandern 30 Tage nach
  Abschluss ins Archiv

## Desktop-App (Electron)

```bash
# Entwicklung: erst `npm run dev`, dann in einem zweiten Terminal
npm run electron:dev

# Installer bauen (Ausgabe in ./release)
npm run dist         # aktuelle Plattform
npm run dist:mac     # macOS .dmg
npm run dist:win     # Windows NSIS
```

`npm run build` baut den Client (`client/dist`) und bündelt Server + Electron
(`server/dist`, `electron/dist`) via esbuild; `electron-builder` verpackt das
Ergebnis und baut better-sqlite3 für Electrons ABI neu.

## CI

`.github/workflows/build.yml` baut auf `macos-latest` **und** `windows-latest`
automatisch `.dmg` + NSIS-Installer — bei einem Tag `v*` oder manuell
(`workflow_dispatch`). Artefakte landen als Workflow-Uploads.

## macOS: „Auftakt.app ist beschädigt"

Die App ist **nicht bei Apple signiert/notarisiert** (dafür bräuchte es einen
kostenpflichtigen Apple-Developer-Account). Nach dem Download setzt macOS ein
Quarantäne-Flag, weshalb die App als „beschädigt" gemeldet wird. Sie ist **nicht**
beschädigt — das Flag muss einmal entfernt werden. Nach dem Verschieben in den
Programme-Ordner im Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Auftakt.app
```

Danach startet die App normal (sie ist Ad-hoc-signiert, läuft also auf Apple
Silicon). Alternativ: Rechtsklick auf die App → **Öffnen**. Für einen warnungsfreien
Download-Start wäre Apple-Signierung + Notarisierung nötig (Developer-Account).

## Struktur

```
server/   Express + better-sqlite3: db.ts (Schema), seed.ts, routes/, lib/
client/   React-App: pages/, components/, api/, lib/ (linkify, dates, colors)
electron/ main.ts, preload.ts, menu.ts, backup.ts
scripts/  build.mjs (esbuild-Bündel) + die check-*.mjs-Gates
docs/     Architektur, Entscheidungen, Test-Checklisten
```

## Dokumentation

| Datei | Inhalt |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Aufbau der drei Schichten, Zeitstempel-Konvention, Saisons, CRUD-Factory, Soft-Delete, Spalten-Modell, Client-Verträge |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Bewusst *nicht* umgesetzte Dinge, mit Begründung |
| [`docs/VERIFYING.md`](docs/VERIFYING.md) | Fallstricke beim manuellen Prüfen im Browser |
| [`docs/BACKUP-TESTING.md`](docs/BACKUP-TESTING.md) | Manuelle Backup-/Import-Checkliste vor jedem Release |

## Skripte

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Server + Client im Browser |
| `npm run demo` | Demo-Datenbank bauen und damit starten (rührt `./.data/` nicht an) |
| `npm run demo:seed` | Nur die Demo-Datenbank neu bauen |
| `npm run seed` | Echte Datenbank in `./.data/` neu befüllen |
| `npm run typecheck` | Typecheck Server + Client + Electron |
| `npm run check` | Alle vier Prüfskripte (Backup, Datum/Zeitzone, API-Invarianten, Markdown) |
| `npm run build` | Client-Build + Server-/Electron-Bündel |
| `npm run dist` | Installer für die aktuelle Plattform |

## Phase 2 (vorbereitet, noch nicht gebaut)

- `.ics`-Export / Google-Calendar-Sync (Termine sind zeitzonenbewusst als
  Europe/Berlin gespeichert)
- „Neue Saison“: frische DB + Künstler/Kontakte aus der letzten Saison importieren
- Mehrbenutzer: derselbe Server auf einem geteilten Rechner

## Sicherheit

Alle Daten bleiben lokal; die App sendet nichts an einen Server. Die Installer
auf der [Releases-Seite](https://github.com/andrewendlinger/auftakt/releases)
werden von GitHub Actions aus diesem Quellcode gebaut und tragen eine
Build-Provenance-Attestierung — prüfbar mit `gh attestation verify`. Details und
Meldeweg für Sicherheitsprobleme: [SECURITY.md](SECURITY.md).

## Lizenz

[PolyForm Strict License 1.0.0](LICENSE.md) — der Quellcode ist einsehbar, und
die App darf für nichtkommerzielle Zwecke genutzt werden (privat, Hobby, sowie
gemeinnützige, Bildungs- und öffentliche Einrichtungen). Weitergabe und
Veränderung sind nicht gestattet.

**Kommerzielle bzw. betriebliche Nutzung ist damit nicht abgedeckt.** Für eine
kommerzielle Lizenz bitte melden — siehe [LICENSE.md](LICENSE.md).

## Beiträge

Dies ist ein Einzelentwickler-Projekt; Pull Requests werden derzeit nicht
angenommen. Fehlerberichte und Ideen sind als Issue willkommen.
