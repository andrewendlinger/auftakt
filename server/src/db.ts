import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/*
 * Seasons: one SQLite file per season (2026, 2027, …) inside a data directory,
 * with a small seasons.json registry above them recording the active season.
 * Switching seasons re-opens the active file in-process (no restart). The live
 * DBs are never placed in a cloud-synced folder; only backups go there.
 */

export interface Season {
  id: number;
  label: string;
  file: string; // basename inside the data dir
  createdAt: string;
}
interface Registry {
  activeId: number;
  seasons: Season[];
}

const DEFAULT_SEASON_LABEL = 'Festival 2026';

/** The directory that holds seasons.json and the per-season .db files. */
export function dataDir(): string {
  const env = process.env.AUFTAKT_DATA_DIR;
  if (env && env.trim() !== '') return env;
  // Back-compat: a single-file override still works — use its folder + name.
  const legacy = process.env.AUFTAKT_DB_PATH;
  if (legacy && legacy.trim() !== '') return dirname(legacy);
  return resolve(here, '../../.data');
}

/** Season 1 keeps the familiar file name so existing databases carry over. */
function legacyFileName(): string {
  const legacy = process.env.AUFTAKT_DB_PATH;
  return legacy && legacy.trim() !== '' ? basename(legacy) : 'auftakt.db';
}

export function registryPath(): string {
  return join(dataDir(), 'seasons.json');
}

function readRegistry(): Registry {
  try {
    const reg = JSON.parse(readFileSync(registryPath(), 'utf8')) as Registry;
    if (reg && Array.isArray(reg.seasons) && reg.seasons.length) return reg;
  } catch {
    /* bootstrap below */
  }
  // First run: register the (possibly pre-existing) legacy DB as the first season.
  const reg: Registry = {
    activeId: 1,
    seasons: [{ id: 1, label: DEFAULT_SEASON_LABEL, file: legacyFileName(), createdAt: new Date().toISOString() }],
  };
  saveRegistry(reg);
  return reg;
}

function saveRegistry(reg: Registry): void {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(registryPath(), JSON.stringify(reg, null, 2));
}

function activeSeason(reg: Registry = readRegistry()): Season {
  return reg.seasons.find((s) => s.id === reg.activeId) ?? reg.seasons[0]!;
}

export function resolveDbPath(): string {
  return join(dataDir(), activeSeason().file);
}

export function listSeasons(): { activeId: number; activeFile: string; seasons: Season[] } {
  const reg = readRegistry();
  return { activeId: reg.activeId, activeFile: join(dataDir(), activeSeason(reg).file), seasons: reg.seasons };
}

/** Every registered season's DB file, resolved to an absolute path. Used by the backup run. */
export function seasonFiles(): Array<{ label: string; file: string; path: string }> {
  return readRegistry().seasons.map((s) => ({ label: s.label, file: s.file, path: join(dataDir(), s.file) }));
}

/** Create a fully-initialised new season DB and register it (does not activate it). */
export function createSeason(label: string): Season {
  const reg = readRegistry();
  const id = Math.max(0, ...reg.seasons.map((s) => s.id)) + 1;
  const season: Season = { id, label, file: `season-${id}.db`, createdAt: new Date().toISOString() };
  mkdirSync(dataDir(), { recursive: true });
  const fresh = new Database(join(dataDir(), season.file));
  fresh.pragma('journal_mode = WAL');
  fresh.pragma('foreign_keys = ON');
  fresh.exec(SCHEMA);
  ensureDefaultSettings(fresh);
  ensureBuiltinColumns(fresh);
  setSetting(fresh, 'saison', label);
  fresh.close();
  reg.seasons.push(season);
  saveRegistry(reg);
  return season;
}

/** Switch the active season; closes the current handle so the next getDb() opens the new file. */
export function activateSeason(id: number): void {
  const reg = readRegistry();
  if (!reg.seasons.some((s) => s.id === id)) throw new Error('unknown season');
  reg.activeId = id;
  saveRegistry(reg);
  closeDb();
}

export function renameSeason(id: number, label: string): void {
  const reg = readRegistry();
  const s = reg.seasons.find((x) => x.id === id);
  if (!s) throw new Error('unknown season');
  s.label = label;
  saveRegistry(reg);
  if (id === reg.activeId) setSetting(getDb(), 'saison', label);
}

export function deleteSeason(id: number): void {
  const reg = readRegistry();
  if (reg.seasons.length <= 1) throw new Error('cannot delete the last season');
  if (id === reg.activeId) throw new Error('cannot delete the active season');
  const s = reg.seasons.find((x) => x.id === id);
  if (!s) throw new Error('unknown season');
  reg.seasons = reg.seasons.filter((x) => x.id !== id);
  saveRegistry(reg);
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      const p = join(dataDir(), s.file + suffix);
      if (existsSync(p)) unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}

/** Keep the active season's registry label in sync with the in-DB `saison` setting. */
export function setActiveSeasonLabel(label: string): void {
  const reg = readRegistry();
  const s = activeSeason(reg);
  if (s.label !== label) {
    s.label = label;
    saveRegistry(reg);
  }
}

/** Columns copied between season DBs (ids preserved so FKs & custom_values stay linked). */
const COPY_COLS: Record<string, string[]> = {
  artists: ['id', 'name', 'color', 'notes', 'image', 'sort_order'],
  projects: ['id', 'artist_id', 'code', 'name', 'status', 'description', 'notes', 'color', 'sort_order'],
  contacts: ['id', 'artist_id', 'project_id', 'role', 'name', 'email', 'phone', 'notes', 'color', 'sort_order'],
  events: ['id', 'artist_id', 'project_id', 'type', 'title', 'start_at', 'end_at', 'all_day', 'location', 'notes', 'sort_order'],
  tasks: ['id', 'artist_id', 'project_id', 'title', 'status', 'priority', 'due_date', 'comment', 'color', 'custom_values', 'erledigt_am', 'parent_id', 'sort_order'],
  links: ['id', 'artist_id', 'project_id', 'event_id', 'task_id', 'label', 'url', 'color', 'sort_order'],
  custom_columns: ['id', 'name', 'type', 'scope', 'project_id', 'options', 'icon', 'key', 'kind', 'enabled', 'deletable', 'sort_order'],
};

function copyRows(target: Database.Database, table: string, rows: unknown[]): void {
  if (rows.length === 0) return;
  const cols = COPY_COLS[table]!;
  const stmt = target.prepare(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => '@' + c).join(', ')})`,
  );
  const tx = target.transaction(() => {
    for (const r of rows as Array<Record<string, unknown>>) {
      const o: Record<string, unknown> = {};
      for (const c of cols) o[c] = r[c] === undefined ? null : r[c];
      stmt.run(o);
    }
  });
  tx();
}

/** What a new season carries over from an existing one. Every group is optional. */
export interface SeasonCopyOptions {
  artists: boolean;
  contacts: boolean;
  events: boolean;
  projects: boolean;
  tasks: boolean;
  /** Task-table configuration: the built-in column setup plus global custom columns. */
  columns: boolean;
  /** The settings table, minus SETTINGS_NOT_COPIED. */
  settings: boolean;
}

/**
 * Settings a copy must not carry: the new season names itself, and the other two
 * describe this machine rather than the season.
 */
const SETTINGS_NOT_COPIED = new Set(['saison', 'backup_dir', 'first_run_done']);

/**
 * Carry the task table's configuration over. Built-ins are matched by `key` and
 * updated in place — the target already has its own from ensureBuiltinColumns(),
 * and `task_sort` refers to them by key, so those ids have to stay put. Custom
 * columns are inserted with their ids preserved, because tasks.custom_values is
 * keyed by column id.
 */
function copyColumnConfig(
  target: Database.Database,
  builtins: Array<Record<string, unknown>>,
  customs: Array<Record<string, unknown>>,
): void {
  const upd = target.prepare(
    `UPDATE custom_columns
        SET name = @name, options = @options, icon = @icon, enabled = @enabled, sort_order = @sort_order
      WHERE key = @key AND kind = 'builtin'`,
  );
  const tx = target.transaction(() => {
    for (const b of builtins) {
      upd.run({
        name: b.name,
        options: b.options ?? null,
        icon: b.icon ?? null,
        enabled: b.enabled,
        sort_order: b.sort_order,
        key: b.key,
      });
    }
  });
  tx();
  copyRows(target, 'custom_columns', customs);
}

/** Upsert, not insert: the target already holds ensureDefaultSettings()'s rows. */
function copySettings(target: Database.Database, rows: Array<Record<string, unknown>>): void {
  const stmt = target.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  const tx = target.transaction(() => {
    for (const r of rows) {
      if (SETTINGS_NOT_COPIED.has(String(r.key))) continue;
      stmt.run(String(r.key), (r.value ?? null) as string | null);
    }
  });
  tx();
}

/**
 * Copy data from one season into another (a freshly created, empty one).
 * Every group is opt-in; a row only comes over if the parent it hangs off did
 * too, which is also how links have always worked.
 */
export function copySeasonData(targetId: number, sourceId: number, opts: SeasonCopyOptions): void {
  const reg = readRegistry();
  const src = reg.seasons.find((s) => s.id === sourceId);
  const tgt = reg.seasons.find((s) => s.id === targetId);
  if (!src || !tgt) throw new Error('unknown season');

  // Close the dependency graph the schema imposes, so the result never depends on
  // what the client sent: projects.artist_id is NOT NULL, and contacts/events each
  // hang off exactly one artist or project. Tasks need their columns because
  // custom_values is keyed by column id and `status` has to name an option the
  // target's Status column actually offers.
  const o = { ...opts };
  if (o.projects || o.contacts || o.events) o.artists = true;
  if (o.tasks) o.columns = true;

  // Open read-write (we only SELECT): a read-only handle can't create the WAL
  // shared-memory file for an inactive season, which would fail the copy.
  const source = new Database(join(dataDir(), src.file));
  const target = new Database(join(dataDir(), tgt.file));
  const q = (sql: string): Array<Record<string, unknown>> =>
    source.prepare(sql).all() as Array<Record<string, unknown>>;
  const live = (table: string, extra = ''): Array<Record<string, unknown>> =>
    q(`SELECT * FROM ${table} WHERE deleted_at IS NULL${extra}`);
  try {
    target.pragma('foreign_keys = OFF');

    if (o.artists) copyRows(target, 'artists', live('artists'));
    if (o.projects) {
      copyRows(target, 'projects', live('projects'));
      copyRows(target, 'custom_columns', live('custom_columns', " AND kind = 'custom' AND scope = 'project'"));
    }

    const kept = (r: Record<string, unknown>): boolean =>
      (r.artist_id != null && o.artists) || (r.project_id != null && o.projects);

    if (o.contacts) copyRows(target, 'contacts', live('contacts').filter(kept));
    const events = o.events ? live('events').filter(kept) : [];
    copyRows(target, 'events', events);
    const eventIds = new Set(events.map((e) => e.id));

    if (o.columns) {
      copyColumnConfig(
        target,
        live('custom_columns', " AND kind = 'builtin'"),
        live('custom_columns', " AND kind = 'custom' AND scope = 'global'"),
      );
    }

    // Tasks with no parent at all are the season-wide ("Festival") todos.
    const tasks = o.tasks
      ? live('tasks').filter((t) => kept(t) || (t.artist_id == null && t.project_id == null))
      : [];
    const taskIds = new Set(tasks.map((t) => t.id));
    // A subtask whose parent stayed behind becomes a root task, not a dangling FK.
    for (const t of tasks) if (t.parent_id != null && !taskIds.has(t.parent_id)) t.parent_id = null;
    copyRows(target, 'tasks', tasks);

    const links = live('links').filter(
      (l) =>
        (l.artist_id != null && o.artists) ||
        (l.project_id != null && o.projects) ||
        (l.event_id != null && eventIds.has(l.event_id)) ||
        (l.task_id != null && taskIds.has(l.task_id)),
    );
    copyRows(target, 'links', links);

    if (o.settings) copySettings(target, q('SELECT key, value FROM settings'));

    target.pragma('foreign_keys = ON');
  } finally {
    source.close();
    target.close();
  }
}

const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS artists (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#888888',
  notes      TEXT,
  image      TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_id   INTEGER NOT NULL REFERENCES artists(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  status      TEXT,
  description TEXT,
  notes       TEXT,
  color       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
);

CREATE TABLE IF NOT EXISTS contacts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_id  INTEGER REFERENCES artists(id),
  project_id INTEGER REFERENCES projects(id),
  role       TEXT,
  name       TEXT NOT NULL,
  email      TEXT,
  phone      TEXT,
  notes      TEXT,
  color      TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  CHECK ((artist_id IS NOT NULL) + (project_id IS NOT NULL) = 1)
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_id  INTEGER REFERENCES artists(id),
  project_id INTEGER REFERENCES projects(id),
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  start_at   TEXT NOT NULL,
  end_at     TEXT,
  all_day    INTEGER NOT NULL DEFAULT 0,
  location   TEXT,
  notes      TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  CHECK ((artist_id IS NOT NULL) + (project_id IS NOT NULL) = 1)
);

CREATE TABLE IF NOT EXISTS tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_id     INTEGER REFERENCES artists(id),
  project_id    INTEGER REFERENCES projects(id),
  title         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'offen',
  priority      TEXT NOT NULL DEFAULT 'mittel',
  due_date      TEXT,
  comment       TEXT,
  color         TEXT,
  custom_values TEXT NOT NULL DEFAULT '{}',
  erledigt_am   TEXT,
  parent_id     INTEGER REFERENCES tasks(id),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT,
  -- 0 parents = a season-wide ("Festival") todo, 1 = artist-level or project todo.
  CHECK ((artist_id IS NOT NULL) + (project_id IS NOT NULL) <= 1)
);

CREATE TABLE IF NOT EXISTS custom_columns (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL,
  scope      TEXT NOT NULL DEFAULT 'global',
  project_id INTEGER REFERENCES projects(id),
  options    TEXT,
  icon       TEXT,
  key        TEXT,
  kind       TEXT NOT NULL DEFAULT 'custom',
  enabled    INTEGER NOT NULL DEFAULT 1,
  deletable  INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS links (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_id  INTEGER REFERENCES artists(id),
  project_id INTEGER REFERENCES projects(id),
  event_id   INTEGER REFERENCES events(id),
  task_id    INTEGER REFERENCES tasks(id),
  label      TEXT NOT NULL,
  url        TEXT,
  color      TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  CHECK ((artist_id IS NOT NULL) + (project_id IS NOT NULL) + (event_id IS NOT NULL) + (task_id IS NOT NULL) = 1)
);

CREATE INDEX IF NOT EXISTS idx_projects_artist  ON projects(artist_id);
CREATE INDEX IF NOT EXISTS idx_contacts_artist  ON contacts(artist_id);
CREATE INDEX IF NOT EXISTS idx_contacts_project ON contacts(project_id);
CREATE INDEX IF NOT EXISTS idx_events_artist    ON events(artist_id);
CREATE INDEX IF NOT EXISTS idx_events_project   ON events(project_id);
CREATE INDEX IF NOT EXISTS idx_events_start     ON events(start_at);
CREATE INDEX IF NOT EXISTS idx_tasks_artist     ON tasks(artist_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project    ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_sort       ON tasks(status, priority, due_date);
CREATE INDEX IF NOT EXISTS idx_links_parents    ON links(artist_id, project_id, event_id, task_id);
`;

export const DEFAULT_EVENT_TYPES = ['Auftritt', 'Termin', 'Anreise', 'Deadline'];
export const DEFAULT_PROJECT_STATUSES = ['Not Started', 'In Progress', 'Done'];

export interface ColumnOption {
  value: string;
  label: string;
  color: string;
  /** For the Status column: the single terminal category that drives the done → archive lifecycle. */
  done?: boolean;
}

/** The task Status column is a select whose "done" option grays out, sinks and later archives the task. */
export const DEFAULT_STATUS_OPTIONS: ColumnOption[] = [
  { value: 'new', label: 'Not Started', color: '#e2e8f0' },
  { value: 'active', label: 'In Progress', color: '#dbeafe' },
  { value: 'done', label: 'Done', color: '#dcfce7', done: true },
];

export const DEFAULT_PRIORITY_OPTIONS: ColumnOption[] = [
  { value: 'hoch', label: 'hoch', color: '#fee2e2' },
  { value: 'mittel', label: 'mittel', color: '#fef3c7' },
  { value: 'niedrig', label: 'niedrig', color: '#e2e8f0' },
];

interface BuiltinColumn {
  key: string;
  name: string;
  type: string;
  sort_order: number;
  enabled: number;
  deletable: number;
  options: ColumnOption[] | null;
}

/**
 * The task table is data-driven: every column (built-in and custom) is a
 * custom_columns row. Built-ins bind to real task fields via `key`; customs
 * bind to tasks.custom_values. Status is leftmost. Priorität, Fällig, "Erstellt
 * am" are off by default; "Zuletzt bearbeitet" is on. `created`/`updated` are
 * read-only and render tasks.created_at / updated_at.
 */
const BUILTIN_COLUMNS: BuiltinColumn[] = [
  { key: 'status', name: 'Status', type: 'status', sort_order: 0, enabled: 1, deletable: 0, options: DEFAULT_STATUS_OPTIONS },
  { key: 'title', name: 'Aufgabe', type: 'title', sort_order: 1, enabled: 1, deletable: 0, options: null },
  { key: 'priority', name: 'Priorität', type: 'priority', sort_order: 2, enabled: 0, deletable: 1, options: DEFAULT_PRIORITY_OPTIONS },
  { key: 'due', name: 'Fällig', type: 'due', sort_order: 3, enabled: 0, deletable: 1, options: null },
  { key: 'comment', name: 'Kommentar', type: 'comment', sort_order: 4, enabled: 1, deletable: 1, options: null },
  { key: 'updated', name: 'Zuletzt bearbeitet', type: 'updated', sort_order: 5, enabled: 1, deletable: 1, options: null },
  { key: 'created', name: 'Erstellt am', type: 'created', sort_order: 6, enabled: 0, deletable: 1, options: null },
];

/**
 * Default hierarchy for the automatic task ordering in the main task table.
 * Each rule sorts by a builtin column id; `status` asc follows the status option
 * order (Not Started → In Progress → Done). Users can reorder/extend this in Settings.
 */
export const DEFAULT_TASK_SORT = [
  { id: 'status', dir: 'asc' },
  { id: 'priority', dir: 'asc' },
  { id: 'due', dir: 'asc' },
];

const DEFAULT_SETTINGS: Record<string, string> = {
  saison: 'Festival 2026',
  timezone: 'Europe/Berlin',
  backup_dir: '',
  first_run_done: '0',
  event_types: JSON.stringify(DEFAULT_EVENT_TYPES),
  project_statuses: JSON.stringify(DEFAULT_PROJECT_STATUSES),
  task_sort: JSON.stringify(DEFAULT_TASK_SORT),
};

/** Number of days a soft-deleted row survives before being purged. */
export const PURGE_AFTER_DAYS = 30;
/** Number of days a completed task stays in the live views before archiving. */
export const ARCHIVE_AFTER_DAYS = 30;

let instance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (instance) return instance;
  const path = resolveDbPath();
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  ensureDefaultSettings(db);
  migrateColumns(db);
  ensureBuiltinColumns(db);
  migrateTaskStatus(db);
  migrateTasksAllowGeneral(db);
  migrateArtistImage(db);
  migrateItemColors(db);
  migrateTaskParentId(db);
  instance = db;
  return db;
}

/** Close the cached connection so the next getDb() re-opens the (possibly changed) active season. */
export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}

/*
 * Copying a live SQLite file with the filesystem is NOT safe under WAL: committed
 * rows sit in the -wal until a checkpoint, so a plain copy of the .db can (and in
 * practice does) yield an empty database. Every snapshot therefore goes through
 * `VACUUM INTO`, which writes a consistent single-file image of db + WAL.
 */
export function snapshotDb(srcPath: string, destPath: string): void {
  if (!existsSync(srcPath)) throw new Error(`Datenbank nicht gefunden: ${srcPath}`);
  if (existsSync(destPath)) unlinkSync(destPath); // VACUUM INTO refuses an existing target
  // Inactive seasons are opened read-write for the same reason copySeasonData does:
  // a read-only handle cannot create the WAL shared-memory file when one is missing.
  const active = instance && resolveDbPath() === srcPath;
  const db = active ? instance! : new Database(srcPath);
  try {
    db.prepare('VACUUM INTO ?').run(destPath);
  } finally {
    if (!active) db.close();
  }
}

/** Tables an Auftakt database must have for an import to be plausible. */
const REQUIRED_TABLES = ['settings', 'artists', 'tasks', 'custom_columns'];

/**
 * Check a user-picked file before it is allowed to replace a real database.
 * Returns a German error message, or null when the file looks importable.
 */
export function validateImportCandidate(path: string): string | null {
  if (!existsSync(path)) return 'Die gewählte Datei existiert nicht.';
  let db: Database.Database;
  try {
    db = new Database(path, { readonly: true });
  } catch {
    return 'Die gewählte Datei ist keine gültige SQLite-Datenbank.';
  }
  try {
    const check = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (check[0]?.integrity_check !== 'ok') return 'Die gewählte Datenbank ist beschädigt und wurde nicht importiert.';
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
        (r) => r.name,
      ),
    );
    const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
    if (missing.length) return `Die gewählte Datei ist keine Auftakt-Datenbank (fehlend: ${missing.join(', ')}).`;
    return null;
  } catch (err) {
    // better-sqlite3 opens lazily, so a file that is not SQLite at all fails here.
    return `Die gewählte Datei ist keine gültige Auftakt-Datenbank (${(err as Error).message}).`;
  } finally {
    db.close();
  }
}

/**
 * Replace the active season's database with a user-picked file.
 *
 * Order matters: nothing is destroyed until the candidate has been validated and
 * the current data safely snapshotted. The connection is closed *before* the copy
 * so SQLite checkpoints and removes the -wal/-shm — a stale WAL left next to a
 * freshly copied file gets replayed on the next launch, which either silently
 * discards the import or corrupts it into "database disk image is malformed".
 */
export function importIntoActiveSeason(candidatePath: string, backupDir: string): { backup: string } {
  const invalid = validateImportCandidate(candidatePath);
  if (invalid) throw new Error(invalid);

  const dest = resolveDbPath();
  // A season registered but never opened has no file yet — nothing to back up, and
  // reporting a path to a file we did not write would be a lie.
  let backup = '';
  if (existsSync(dest)) {
    backup = preImportBackupPath(dest, backupDir);
    mkdirSync(dirname(backup), { recursive: true });
    snapshotDb(dest, backup);
  }

  closeDb();
  copyFileSync(candidatePath, dest);
  for (const suffix of ['-wal', '-shm']) {
    try {
      if (existsSync(dest + suffix)) unlinkSync(dest + suffix);
    } catch {
      /* ignore */
    }
  }
  return { backup };
}

/** Pre-import safety copy: into the backup folder when there is one, else next to the DB. */
function preImportBackupPath(dbPath: string, backupDir: string): string {
  const name = `${basename(dbPath, '.db')}.db`;
  return backupDir
    ? join(backupDir, `pre-import-${backupStamp()}`, name)
    : `${dbPath}.pre-import-${backupStamp()}.bak`;
}

/** Filesystem-safe timestamp shared by every backup folder name. */
export function backupStamp(): string {
  return new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
}

/** Add the data-driven-column fields to custom_columns on databases created before they existed. */
function migrateColumns(db: Database.Database): void {
  const have = new Set(
    (db.prepare('PRAGMA table_info(custom_columns)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  const add = (name: string, ddl: string): void => {
    if (!have.has(name)) db.exec(`ALTER TABLE custom_columns ADD COLUMN ${ddl}`);
  };
  add('key', 'key TEXT');
  add('kind', "kind TEXT NOT NULL DEFAULT 'custom'");
  add('enabled', 'enabled INTEGER NOT NULL DEFAULT 1');
  add('deletable', 'deletable INTEGER NOT NULL DEFAULT 1');
  add('icon', 'icon TEXT');
}

/** Add a column to a table if a pre-existing database doesn't have it yet. Idempotent. */
function ensureColumn(db: Database.Database, table: string, name: string, ddl: string): void {
  const have = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

/** Add the artist profile-image column (stored as a data URL) to older databases. */
function migrateArtistImage(db: Database.Database): void {
  ensureColumn(db, 'artists', 'image', 'image TEXT');
}

/** Add the per-item color column to tasks/contacts/links in older databases. */
function migrateItemColors(db: Database.Database): void {
  ensureColumn(db, 'tasks', 'color', 'color TEXT');
  ensureColumn(db, 'contacts', 'color', 'color TEXT');
  ensureColumn(db, 'links', 'color', 'color TEXT');
}

/** Add the subtask parent link (tasks.parent_id → tasks.id) to older databases. Idempotent. */
function migrateTaskParentId(db: Database.Database): void {
  ensureColumn(db, 'tasks', 'parent_id', 'parent_id INTEGER REFERENCES tasks(id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id)');
}

/** Insert the built-in task columns (Status, Aufgabe, Priorität, Fällig, Kommentar) if missing. Idempotent. */
export function ensureBuiltinColumns(db: Database.Database): void {
  const has = db.prepare('SELECT 1 FROM custom_columns WHERE key = ? AND deleted_at IS NULL LIMIT 1');
  const ins = db.prepare(
    `INSERT INTO custom_columns (name, type, scope, project_id, options, key, kind, enabled, deletable, sort_order)
     VALUES (@name, @type, 'global', NULL, @options, @key, 'builtin', @enabled, @deletable, @sort_order)`,
  );
  const tx = db.transaction(() => {
    for (const b of BUILTIN_COLUMNS) {
      if (!has.get(b.key)) {
        ins.run({
          name: b.name,
          type: b.type,
          options: b.options ? JSON.stringify(b.options) : null,
          key: b.key,
          enabled: b.enabled,
          deletable: b.deletable,
          sort_order: b.sort_order,
        });
      }
    }
  });
  tx();
}

/** Map the legacy two-state task status to the New/Active/Done model. Idempotent. */
function migrateTaskStatus(db: Database.Database): void {
  db.prepare("UPDATE tasks SET status = 'active' WHERE status = 'offen'").run();
  db.prepare("UPDATE tasks SET status = 'done' WHERE status = 'erledigt'").run();
}

/**
 * Relax the tasks parent CHECK from "= 1" to "<= 1" so season-wide ("Festival") todos
 * with no artist/project are allowed. SQLite can't ALTER a CHECK, so rebuild the table
 * (the standard 12-step). Idempotent: only runs while the old constraint is present.
 */
function migrateTasksAllowGeneral(db: Database.Database): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'")
    .get() as { sql?: string } | undefined;
  if (!row?.sql || row.sql.includes('<= 1')) return; // already migrated (or fresh SCHEMA)

  // foreign_keys must be toggled OUTSIDE the transaction to take effect.
  db.pragma('foreign_keys = OFF');
  const rebuild = db.transaction(() => {
    db.exec(`
      CREATE TABLE tasks_new (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        artist_id     INTEGER REFERENCES artists(id),
        project_id    INTEGER REFERENCES projects(id),
        title         TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'offen',
        priority      TEXT NOT NULL DEFAULT 'mittel',
        due_date      TEXT,
        comment       TEXT,
        custom_values TEXT NOT NULL DEFAULT '{}',
        erledigt_am   TEXT,
        sort_order    INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at    TEXT,
        CHECK ((artist_id IS NOT NULL) + (project_id IS NOT NULL) <= 1)
      );
      INSERT INTO tasks_new SELECT
        id, artist_id, project_id, title, status, priority, due_date, comment,
        custom_values, erledigt_am, sort_order, created_at, updated_at, deleted_at
      FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;
      CREATE INDEX IF NOT EXISTS idx_tasks_artist  ON tasks(artist_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_sort    ON tasks(status, priority, due_date);
    `);
  });
  rebuild();
  db.pragma('foreign_keys = ON');
}

/** The Status option flagged `done` — the terminal category driving gray-out/sink/archive. */
export function doneStatusValue(db: Database.Database): string {
  const row = db
    .prepare("SELECT options FROM custom_columns WHERE key = 'status' AND deleted_at IS NULL LIMIT 1")
    .get() as { options?: string | null } | undefined;
  if (row?.options) {
    try {
      const opts = JSON.parse(row.options) as ColumnOption[];
      const done = opts.find((o) => o.done);
      if (done) return done.value;
    } catch {
      /* fall through */
    }
  }
  return 'done';
}

function ensureDefaultSettings(db: Database.Database): void {
  const stmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) stmt.run(key, value);
  });
  tx();
}

export function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string | null }
    | undefined;
  return row ? row.value : null;
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

/** Hard-delete rows whose deleted_at is older than PURGE_AFTER_DAYS. Runs on startup. */
export function purgeExpired(db: Database.Database): void {
  const tables = ['artists', 'projects', 'contacts', 'events', 'tasks', 'custom_columns', 'links'];
  const cutoff = `-${PURGE_AFTER_DAYS} days`;
  const tx = db.transaction(() => {
    for (const t of tables) {
      db.prepare(
        `DELETE FROM ${t} WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', ?)`,
      ).run(cutoff);
    }
  });
  tx();
}
