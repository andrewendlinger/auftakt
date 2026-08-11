# Backup & Import — manual test checklist

Run this **on both macOS and Windows before each release**. It covers the paths that
`npm run check:backup` cannot: the Electron dialogs, the relaunch, and the real packaged
app against a real user data directory.

`npm run check:backup` already covers the server side — snapshots, validation, the
stale-WAL import bug, pruning. Run it first; if it fails, stop and fix that before
touching the GUI.

## Why this exists

Import used to copy the picked file over the live database while the server still held an
open WAL connection. The stale `-wal` was replayed on the next launch, which either silently
discarded the import or produced `database disk image is malformed` — a crash on startup,
before the window appears. The pre-import "safety backup" was itself empty for the same
reason (a plain file copy of a WAL database can contain zero tables).

Both are fixed, but the failure mode is invisible until the *next* launch, so every case
below ends with **quit and reopen the app**.

## Setup

Use a scratch data directory, never real festival data. A packaged build is required —
`electron:dev` skips the server bootstrap and the startup backup entirely.

```
npm run dist:mac    # or dist:win
```

## Cases

### 1 · First launch, empty database

- [ ] Fresh data dir → launch. **No** backup-folder prompt appears.
- [ ] Backup folder stays empty (no dated folder for an empty database).
- [ ] Settings → "Datenbank & Backups" shows `(noch nicht gewählt)` and the amber hint.

### 2 · The prompt arrives once there is data

- [ ] Add an artist, quit, relaunch → the backup-folder prompt appears now.
- [ ] Decline it → relaunch → it appears **again**, and keeps appearing until a folder is set
      (the amber hint remains in Settings meanwhile). **Never asking again is the old bug.**
- [ ] Choose a folder → relaunch → the prompt is gone for good.
- [ ] Settings → "Wählen…" still works and sets the folder.

### 2b · A folder the backup cannot use is refused when it is picked (Windows)

- [ ] Settings → "Wählen…" → type a UNC path (`\\server\freigabe`) into the folder dialog.
- [ ] It is refused **immediately** with a German message naming local/cloud folders as the
      alternative; the configured folder in Settings is unchanged.
      **Silently accepting it and never backing up again is the old bug.**

### 3 · Startup backup covers every season

- [ ] With a folder set and **two seasons** both holding data, relaunch.
- [ ] Backup folder gains `auftakt-<stamp>/` containing `seasons.json` **and one `.db` per season**.
- [ ] Open each `.db` (DB Browser for SQLite) → rows are present. **An empty file is the old bug.**
- [ ] Relaunch a few times → one folder per launch, oldest pruned past 30.
- [ ] Any pre-existing flat `auftakt-<stamp>.db` files from older versions are still there.
- [ ] Delete the configured backup folder (or make it read-only) and relaunch → an error dialog
      says no backup was written and points at Settings. **A console-only message is the old bug.**

### 3b · The backup folder survives a season switch (WP-39)

Until v0.6.1 `backup_dir` lived in the *active season's* settings table. Switching season left an
empty one behind, so the startup backup returned immediately — and where an older build had
already marked `first_run_done` on that season, there was no prompt and no error either. A real
installation ran that way for two days before anyone noticed. It is now in `seasons.json`.

- [ ] With a folder set, switch to another season, quit, relaunch → a dated folder **is** written.
- [ ] Settings → the folder is named on **every** season, not just the one it was chosen on.
- [ ] Create a brand-new season, switch to it, relaunch → still backed up.
- [ ] Upgrading an installation that had the folder set on a non-active season: after the first
      launch on the new version, Settings names it again. **An empty „(noch nicht gewählt)" here
      means the adoption did not run.**

### 4 · Import — the reported crash

The original repro: import one database, add a season manually, then import a second from
that season's settings.

- [ ] Datei → "Datenbank importieren…", pick a valid export → confirm.
- [ ] The dialog names where the previous database was backed up.
- [ ] App relaunches **and opens** — no crash, no error on startup.
- [ ] The imported data is visible (not the old data — a silent no-op is the other half of the bug).
- [ ] **Quit, then** check the data dir: **no `-wal` / `-shm` left next to the active season's
      `.db`**. While the app runs they are supposed to be there — the connection is open — so
      checking too early reads the normal state as the failure. On macOS closing the window is not
      quitting (`window-all-closed` only calls `quit()` off darwin), so confirm with
      `lsof -ti tcp:4317` before believing the result.
- [ ] Open the named pre-import backup → it contains the *previous* data and is not empty.
- [ ] Now add a season, switch to it, and import a second database from there. Quit, relaunch.
      **This is the exact crash repro — it must open cleanly.**

### 5 · Import rejects bad files without destroying anything

- [ ] Pick a text file renamed to `.db` → rejected with a German message, **no** confirmation prompt.
- [ ] Pick a SQLite file that is not an Auftakt database → rejected, names the missing tables.
- [ ] After both: the app still works and the existing data is untouched.

### 6 · Export

- [ ] Datei → "Datenbank exportieren…" → open the result.
- [ ] It contains the current data. **An empty file is the old bug.**
- [ ] Export immediately after editing something → the edit is in the exported file
      (this is the WAL case: the edit may still be uncheckpointed).

### 7 · Restore

- [ ] **Quit first, then delete any `*.db-wal` / `*.db-shm` left in the data dir.** A backup folder
      holds only `.db` files and `seasons.json`, so a sidecar from the *previous* database survives
      the copy and is replayed into the restored file on the next launch — the same
      `database disk image is malformed` crash the import path unlinks them to avoid. Restoring
      under a *running* app is worse still: the open handle never re-reads the file.
- [ ] Copy a `auftakt-<stamp>/` folder's contents over the data dir (`.db` files + `seasons.json`).
- [ ] Launch → all seasons are present, the season switcher lists them, data matches that timestamp.
- [ ] Settings still names the backup folder — it rides along in `seasons.json` (WP-39).
- [ ] A season restored from before the local-time conversion carries UTC stamps until it is
      opened; switch to it once and „Angelegt am"/„Erledigt am" shift into local time. Only the
      *default* season migrates at boot, so this is per season, not once for the file set.

### 8 · Mehrere Fenster (multi-window, per-window seasons)

What the headless checks cannot cover: real `BrowserWindow`s, the menu, the cascade, and the
focused-window season resolution. Run with at least two seasons present.

- [ ] „Neues Fenster" / Cmd+N (Ctrl+N) opens a second window, cascaded off the first — not
      perfectly stacked — and **without** the boot gesture. `boot-log.jsonl` gains a
      `skip / secondary` line; a reload of that window logs `skip / warm`.
- [ ] Edit a task in window A → window B (same season) shows it without any interaction. Then
      break the fast path once: edit in A and merely *focus* B — the focus refetch is the
      backstop and must also bring the edit in.
- [ ] Switch A to another season → only A reloads; B keeps its season in the header chip and its
      rows. A new window (Cmd+N) opens on the season A switched to (the default follows).
- [ ] Delete the season B is showing (from A's Einstellungen; the „Standard" one is refusable) →
      B lands on the landing page with the „… wurde gelöscht" toast. **Windows:** the season's
      `.db` file is actually gone from the data dir — an open pooled handle used to make that
      unlink fail silently.
- [ ] Export from a window pinned to a non-default season (both the Einstellungen button and the
      Datei menu) → the exported file contains *that* season's rows. The import confirmation
      names the season it will replace; after an import, **all** windows close and one returns.
- [ ] „Backup-Ordner wählen…" → every open window reloads, and each shows the new folder.
- [ ] Close one of two windows → the other keeps working (menus, dialogs, edits). Close the last
      window with an unreachable backup folder configured → the quit grace still behaves: no
      orphan process, no dialog on an empty desktop.
- [ ] Windows: double-click the shortcut while the app runs → a **new window**, not a raise.
      Ctrl+W closes one window; „Beenden" quits the app.
- [ ] Type into an inline editor in A, focus B, edit a different row there, focus A again → the
      draft in A survived and B's edit is visible in A's other rows.

## Notes

- The data dir is `<repo>/.data` in dev and Electron `userData` when packaged. Both paths are
  **lowercase** — `~/Library/Application Support/auftakt` on macOS, `%APPDATA%\auftakt` on
  Windows. `userData` is named after `app.getName()`, which reads `name` from the bundled
  `package.json`; `productName: Auftakt` only capitalises the *installer* side. Do not "fix" the
  case without migrating the folder — it is where every existing installation's database lives.
- Windows is worth prioritising for case 4: that is where the crash was reported, though the
  cause was never platform-specific.
- **Installer metadata (Windows, WP-27).** While a Windows machine is at hand, check the two
  places that only a real install shows: *Einstellungen → Apps → Installierte Apps → Auftakt
  `<version>`* must list **Herausgeber: Andre Wendlinger**, and right-click → *Eigenschaften → Details*
  on both `Auftakt-Setup-<version>.exe` (dashes — the v0.6.0 rename, see `electron-builder.yml`;
  the old `Auftakt Setup <version>.exe` no longer exists) and the installed `Auftakt.exe` must show
  **Firma: Andre Wendlinger** and **Copyright: © 2026 Andre Wendlinger**. SmartScreen's „Unbekannter Herausgeber"
  on first run is **expected and unrelated** — that one needs the certificate deferred in
  `DECISIONS.md`, not a metadata field.
