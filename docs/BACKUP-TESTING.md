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

### 4 · Import — the reported crash

The original repro: import one database, add a season manually, then import a second from
that season's settings.

- [ ] Datei → "Datenbank importieren…", pick a valid export → confirm.
- [ ] The dialog names where the previous database was backed up.
- [ ] App relaunches **and opens** — no crash, no error on startup.
- [ ] The imported data is visible (not the old data — a silent no-op is the other half of the bug).
- [ ] Check the data dir: **no `-wal` / `-shm` left next to the active season's `.db`**.
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

- [ ] Quit. Copy a `auftakt-<stamp>/` folder's contents over the data dir (`.db` files + `seasons.json`).
- [ ] Launch → all seasons are present, the season switcher lists them, data matches that timestamp.

## Notes

- The data dir is `<repo>/.data` in dev and Electron `userData` when packaged
  (`~/Library/Application Support/Auftakt` on macOS, `%APPDATA%\Auftakt` on Windows).
- Windows is worth prioritising for case 4: that is where the crash was reported, though the
  cause was never platform-specific.
