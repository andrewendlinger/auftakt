import Database from 'better-sqlite3';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHILD_EDGES, DELETE_ORDER } from './lib/cascade';

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
  /** User override for the card's „Angelegt am …" line; absent = auto text. */
  subtitle?: string;
  /** User override for the card's auto Zeitraum line; absent = auto text. */
  period?: string;
}

export interface LandingDoc {
  id: number;
  label: string;
  url: string | null;
}

/** A user-created section on the landing page: a Textfeld or its own Dokumente list. */
export interface LandingSection {
  id: number;
  name: string;
  type: 'text' | 'links';
  value: string | null; // Markdown; text sections only
  documents?: LandingDoc[]; // links sections only
}

/** Mirrors the client's LayoutEntry — the landing page's section arrangement. */
export interface LandingLayoutEntry {
  key: string;
  width: 'full' | 'half';
  hidden?: boolean;
}

/** The user-renameable word for a season („Saison"/„Saisons" by default). */
export interface SeasonTerms {
  season?: string;
  seasonPlural?: string;
}

/** Cross-season content on the landing page. Lives in seasons.json (not in any season
 *  DB) so it survives season switches and rides along in backups automatically. */
export interface LandingContent {
  notes: string | null; // Markdown
  documents: LandingDoc[];
  layout: LandingLayoutEntry[];
  sections: LandingSection[];
}

interface Registry {
  activeId: number;
  seasons: Season[];
  /** Old files lack the newer keys — every read goes through defaults. */
  landing?: Partial<LandingContent>;
  /** App-global, not landing content: the header switcher shows it on every page. */
  terms?: SeasonTerms;
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
  // If a file exists but was unreadable/corrupt/misshapen, preserve it before bootstrapping
  // over it — it may hold recoverable landing content (notes, documents, sections live only
  // here). Date.now() (no ':') keeps the suffix Windows-safe. Best-effort: a failed rename
  // must not block startup.
  if (existsSync(registryPath())) {
    try {
      renameSync(registryPath(), `${registryPath()}.corrupt-${Date.now()}`);
    } catch {
      /* ignore — proceed to bootstrap */
    }
  }
  // First run: register the (possibly pre-existing) legacy DB as the first season.
  const reg: Registry = {
    activeId: 1,
    seasons: [{ id: 1, label: DEFAULT_SEASON_LABEL, file: legacyFileName(), createdAt: new Date().toISOString() }],
  };
  saveRegistry(reg);
  return reg;
}

// Atomic write: a crash mid-write must never truncate the only copy of the registry.
// Write to a temp file, then renameSync over the target (atomic on POSIX and Windows).
function saveRegistry(reg: Registry): void {
  mkdirSync(dataDir(), { recursive: true });
  const tmp = `${registryPath()}.tmp`;
  writeFileSync(tmp, JSON.stringify(reg, null, 2));
  renameSync(tmp, registryPath());
}

function activeSeason(reg: Registry = readRegistry()): Season {
  return reg.seasons.find((s) => s.id === reg.activeId) ?? reg.seasons[0]!;
}

export function resolveDbPath(): string {
  return join(dataDir(), activeSeason().file);
}

export function listSeasons(): {
  activeId: number;
  activeFile: string;
  seasons: Season[];
  terms: SeasonTerms;
} {
  const reg = readRegistry();
  return {
    activeId: reg.activeId,
    activeFile: join(dataDir(), activeSeason(reg).file),
    seasons: reg.seasons,
    terms: reg.terms ?? {},
  };
}

/** Every registered season's DB file, resolved to an absolute path. Used by the backup run. */
export function seasonFiles(): Array<{ label: string; file: string; path: string }> {
  return readRegistry().seasons.map((s) => ({ label: s.label, file: s.file, path: join(dataDir(), s.file) }));
}

export interface SeasonStats {
  artists: number;
  projects: number;
  openTasks: number;
  firstEvent: string | null; // YYYY-MM-DD
  lastEvent: string | null;
}

/**
 * Kennzahlen per season for the landing page. Inactive seasons are opened raw and
 * read-write (same reason as copySeasonData: a read-only handle can't create the WAL
 * shared-memory file) and may carry a legacy schema, since migrations only run on the
 * active DB — so each season is wrapped in try/catch and reports null instead of
 * failing the whole response.
 */
export function seasonStats(): Record<number, SeasonStats | null> {
  const reg = readRegistry();
  const out: Record<number, SeasonStats | null> = {};
  for (const s of reg.seasons) {
    const active = s.id === reg.activeId;
    const path = join(dataDir(), s.file);
    // Guard: new Database() would create a stray empty file for a missing season.
    if (!active && !existsSync(path)) {
      out[s.id] = null;
      continue;
    }
    let db: Database.Database | null = null;
    try {
      db = active ? getDb() : new Database(path);
      const count = (sql: string, ...args: unknown[]): number =>
        (db!.prepare(sql).get(...args) as { n: number }).n;
      // date() parses both storage forms: YYYY-MM-DD (all-day) and YYYY-MM-DDTHH:MM (timed).
      const range = db
        .prepare(
          `SELECT MIN(date(start_at)) AS first, MAX(date(COALESCE(end_at, start_at))) AS last
             FROM events WHERE deleted_at IS NULL AND start_at IS NOT NULL`,
        )
        .get() as { first: string | null; last: string | null };
      out[s.id] = {
        artists: count('SELECT COUNT(*) AS n FROM artists WHERE deleted_at IS NULL'),
        projects: count('SELECT COUNT(*) AS n FROM projects WHERE deleted_at IS NULL'),
        // NOT IN also excludes legacy 'erledigt' rows — old files never ran migrateTaskStatus.
        openTasks: count(
          "SELECT COUNT(*) AS n FROM tasks WHERE deleted_at IS NULL AND status NOT IN (?, 'erledigt')",
          doneStatusValue(db),
        ),
        firstEvent: range.first,
        lastEvent: range.last,
      };
    } catch {
      out[s.id] = null; // legacy schema / unreadable file → the card degrades gracefully
    } finally {
      if (db && !active) db.close();
    }
  }
  return out;
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

export interface SeasonPatch {
  label?: string;
  subtitle?: string | null; // null clears the override
  period?: string | null;
}

export function updateSeason(id: number, patch: SeasonPatch): void {
  const reg = readRegistry();
  const s = reg.seasons.find((x) => x.id === id);
  if (!s) throw new Error('unknown season');
  if (patch.label !== undefined) s.label = patch.label;
  // Cleared overrides are deleted, not stored as '' — no empty-string litter in seasons.json.
  if (patch.subtitle !== undefined) {
    if (patch.subtitle) s.subtitle = patch.subtitle;
    else delete s.subtitle;
  }
  if (patch.period !== undefined) {
    if (patch.period) s.period = patch.period;
    else delete s.period;
  }
  saveRegistry(reg);
  if (patch.label !== undefined && id === reg.activeId) setSetting(getDb(), 'saison', patch.label);
}

/** Persist a manual card order: reorder reg.seasons itself — array order IS the order. */
export function reorderSeasons(order: number[]): void {
  const reg = readRegistry();
  const ids = new Set(reg.seasons.map((s) => s.id));
  if (
    order.length !== reg.seasons.length ||
    new Set(order).size !== order.length ||
    !order.every((id) => ids.has(id))
  ) {
    throw new Error('order must contain every season id exactly once');
  }
  reg.seasons.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  saveRegistry(reg); // activeId untouched
}

/** Empty/null deletes a key so the default term returns (mirrors subtitle/period). */
export function setSeasonTerms(patch: { season?: string | null; seasonPlural?: string | null }): void {
  const reg = readRegistry();
  const t = { ...reg.terms };
  if (patch.season !== undefined) {
    if (patch.season) t.season = patch.season;
    else delete t.season;
  }
  if (patch.seasonPlural !== undefined) {
    if (patch.seasonPlural) t.seasonPlural = patch.seasonPlural;
    else delete t.seasonPlural;
  }
  if (Object.keys(t).length) reg.terms = t;
  else delete reg.terms;
  saveRegistry(reg);
}

export function getLanding(): LandingContent {
  const reg = readRegistry();
  return {
    notes: reg.landing?.notes ?? null,
    documents: reg.landing?.documents ?? [],
    layout: reg.landing?.layout ?? [],
    // Sections written before the `type` field existed are Textfelder.
    sections: (reg.landing?.sections ?? []).map((s) => ({
      ...s,
      type: s.type === 'links' ? 'links' : 'text',
    })),
  };
}

/** Documents/sections without an id get max+1 assigned — the client sends new rows
 *  id-less. Seeding the counter from current *and* incoming ids means a delete-then-add
 *  never reuses the deleted id while its undo toast is still alive. */
export function patchLanding(patch: {
  notes?: string | null;
  documents?: Array<{ id?: number; label: string; url: string | null }>;
  layout?: LandingLayoutEntry[];
  sections?: Array<{
    id?: number;
    name: string;
    type: 'text' | 'links';
    value: string | null;
    documents?: Array<{ id?: number; label: string; url: string | null }>;
  }>;
}): LandingContent {
  const cur = getLanding();
  const assignDocIds = (
    incoming: Array<{ id?: number; label: string; url: string | null }>,
    current: LandingDoc[],
  ): LandingDoc[] => {
    let nextId = Math.max(0, ...incoming.map((d) => d.id ?? 0), ...current.map((d) => d.id)) + 1;
    return incoming.map((d) => ({ id: d.id ?? nextId++, label: d.label, url: d.url }));
  };
  let documents = cur.documents;
  if (patch.documents !== undefined) documents = assignDocIds(patch.documents, cur.documents);
  let sections = cur.sections;
  if (patch.sections !== undefined) {
    let nextId =
      Math.max(0, ...patch.sections.map((s) => s.id ?? 0), ...cur.sections.map((s) => s.id)) + 1;
    sections = patch.sections.map((s) => {
      const id = s.id ?? nextId++;
      // Per-section document ids, counted against that section's own current docs.
      const curDocs = cur.sections.find((x) => x.id === id)?.documents ?? [];
      return {
        id,
        name: s.name,
        type: s.type,
        value: s.value,
        // Carry the section's stored documents forward when the patch omits the key, so a
        // links section isn't silently emptied (top-level notes/documents/layout already do
        // this). The length guard keeps text sections shaped exactly as before (no key).
        ...(s.documents !== undefined
          ? { documents: assignDocIds(s.documents, curDocs) }
          : curDocs.length
            ? { documents: curDocs }
            : {}),
      };
    });
  }
  const reg = readRegistry();
  reg.landing = {
    notes: patch.notes !== undefined ? patch.notes : cur.notes,
    documents,
    layout: patch.layout !== undefined ? patch.layout : cur.layout,
    sections,
  };
  saveRegistry(reg);
  return reg.landing as LandingContent;
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
  projects: ['id', 'artist_id', 'code', 'name', 'status', 'description', 'color', 'sort_order'],
  contacts: ['id', 'artist_id', 'project_id', 'role', 'name', 'email', 'phone', 'notes', 'color', 'sort_order'],
  events: ['id', 'artist_id', 'project_id', 'type', 'title', 'start_at', 'end_at', 'all_day', 'location', 'notes', 'sort_order'],
  tasks: ['id', 'artist_id', 'project_id', 'title', 'status', 'priority', 'due_date', 'comment', 'color', 'custom_values', 'erledigt_am', 'parent_id', 'sort_order'],
  links: ['id', 'artist_id', 'project_id', 'event_id', 'task_id', 'section_id', 'label', 'url', 'color', 'category', 'sort_order'],
  custom_columns: ['id', 'name', 'type', 'scope', 'project_id', 'options', 'icon', 'key', 'kind', 'enabled', 'deletable', 'sort_order'],
  custom_sections: ['id', 'artist_id', 'project_id', 'name', 'type', 'value', 'sort_order'],
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

/**
 * Copy custom columns, remapping ids **only on collision**. The target already holds its
 * builtin columns (fresh AUTOINCREMENT ids from ensureBuiltinColumns), so a source custom
 * whose id overlaps a target builtin would violate the PRIMARY KEY and abort the whole
 * copy (SRV-04). When the id is free we keep it — a healthy DB is then byte-for-byte
 * unchanged, so custom_values and task_sort keep referring to the same ids; when it is
 * taken we insert without an id and record old->new so tasks.custom_values can be rewritten
 * (remapCustomValues) before the tasks are copied. AUTOINCREMENT hands out ids strictly
 * above the current max, so a remapped id can never collide with an id kept as-is.
 */
function copyCustomColumns(
  target: Database.Database,
  rows: Array<Record<string, unknown>>,
): Map<number, number> {
  const map = new Map<number, number>();
  if (rows.length === 0) return map;
  const cols = COPY_COLS.custom_columns!;
  const colsNoId = cols.filter((c) => c !== 'id');
  const exists = target.prepare('SELECT 1 FROM custom_columns WHERE id = ?');
  const insWithId = target.prepare(
    `INSERT INTO custom_columns (${cols.join(', ')}) VALUES (${cols.map((c) => '@' + c).join(', ')})`,
  );
  const insNoId = target.prepare(
    `INSERT INTO custom_columns (${colsNoId.join(', ')}) VALUES (${colsNoId.map((c) => '@' + c).join(', ')})`,
  );
  const tx = target.transaction(() => {
    for (const r of rows) {
      const oldId = Number(r.id);
      const o: Record<string, unknown> = {};
      for (const c of colsNoId) o[c] = r[c] === undefined ? null : r[c];
      if (exists.get(oldId)) {
        const info = insNoId.run(o);
        map.set(oldId, Number(info.lastInsertRowid));
      } else {
        insWithId.run({ ...o, id: oldId });
        map.set(oldId, oldId);
      }
    }
  });
  tx();
  return map;
}

/**
 * Rewrite a task's custom_values JSON so its keys (custom-column ids) follow any id remap
 * copyCustomColumns performed. An identity map leaves the stored string untouched; keys for
 * columns that were not copied are kept as-is, matching the previous verbatim copy.
 */
function remapCustomValues(raw: unknown, map: Map<number, number>): unknown {
  if (raw == null || map.size === 0) return raw;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    return raw;
  }
  if (!obj || typeof obj !== 'object') return raw;
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const mapped = map.get(Number(k));
    const newKey = mapped !== undefined ? String(mapped) : k;
    if (newKey !== k) changed = true;
    out[newKey] = v;
  }
  return changed ? JSON.stringify(out) : raw;
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
 * columns keep their ids where free and are remapped only on collision (see
 * copyCustomColumns); the returned old->new map lets the caller fix tasks.custom_values,
 * which is keyed by column id.
 */
function copyColumnConfig(
  target: Database.Database,
  builtins: Array<Record<string, unknown>>,
  customs: Array<Record<string, unknown>>,
): Map<number, number> {
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
  return copyCustomColumns(target, customs);
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

    // Accumulates every custom-column id remap (project- and global-scoped) so the task
    // copy below can rewrite tasks.custom_values keys. Empty/identity for a healthy DB.
    const columnIdMap = new Map<number, number>();
    const mergeInto = (m: Map<number, number>): void => {
      for (const [k, v] of m) columnIdMap.set(k, v);
    };

    if (o.artists) copyRows(target, 'artists', live('artists'));
    if (o.projects) {
      // Source seasons are opened raw (migrations only run on the active DB), so an old
      // file may still carry the dropped projects.notes column — merge, don't discard.
      const projects = live('projects');
      for (const p of projects) {
        if (p.notes) p.description = p.description ? `${p.description}\n\n${p.notes}` : p.notes;
      }
      copyRows(target, 'projects', projects);
      mergeInto(
        copyCustomColumns(target, live('custom_columns', " AND kind = 'custom' AND scope = 'project'")),
      );
    }

    const kept = (r: Record<string, unknown>): boolean =>
      (r.artist_id != null && o.artists) || (r.project_id != null && o.projects);

    if (o.contacts) copyRows(target, 'contacts', live('contacts').filter(kept));
    const events = o.events ? live('events').filter(kept) : [];
    copyRows(target, 'events', events);
    const eventIds = new Set(events.map((e) => e.id));

    if (o.columns) {
      mergeInto(
        copyColumnConfig(
          target,
          live('custom_columns', " AND kind = 'builtin'"),
          live('custom_columns', " AND kind = 'custom' AND scope = 'global'"),
        ),
      );
    }

    // Tasks with no parent at all are the season-wide ("Festival") todos.
    const tasks = o.tasks
      ? live('tasks').filter((t) => kept(t) || (t.artist_id == null && t.project_id == null))
      : [];
    const taskIds = new Set(tasks.map((t) => t.id));
    // A subtask whose parent stayed behind becomes a root task, not a dangling FK.
    for (const t of tasks) if (t.parent_id != null && !taskIds.has(t.parent_id)) t.parent_id = null;
    // Follow any custom-column id remap so values stay attached to the right column.
    for (const t of tasks) t.custom_values = remapCustomValues(t.custom_values, columnIdMap);
    copyRows(target, 'tasks', tasks);

    // Widget sections follow the entity they sit on; dashboard widgets (no parent) travel
    // with the settings group, which also carries their `dashboard_layout` ordering.
    const sections = live('custom_sections').filter(
      (s) => kept(s) || (s.artist_id == null && s.project_id == null && o.settings),
    );
    copyRows(target, 'custom_sections', sections);
    const sectionIds = new Set(sections.map((s) => s.id));

    const links = live('links').filter(
      (l) =>
        (l.artist_id != null && o.artists) ||
        (l.project_id != null && o.projects) ||
        (l.event_id != null && eventIds.has(l.event_id)) ||
        (l.task_id != null && taskIds.has(l.task_id)) ||
        (l.section_id != null && sectionIds.has(l.section_id)),
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
  start_at   TEXT,
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
  status        TEXT NOT NULL DEFAULT 'new',
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

-- User-added widget sections (WP-S): named, typed page sections that join the
-- SectionArranger layout. Per-entity by decision — a widget on one artist's page
-- exists only there, so each row carries its own content (no custom_values blob).
CREATE TABLE IF NOT EXISTS custom_sections (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_id  INTEGER REFERENCES artists(id),
  project_id INTEGER REFERENCES projects(id),
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('text', 'links')),
  value      TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  -- 0 parents = a dashboard (Übersicht) widget, 1 = artist- or project-page widget.
  CHECK ((artist_id IS NOT NULL) + (project_id IS NOT NULL) <= 1)
);

CREATE TABLE IF NOT EXISTS links (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_id  INTEGER REFERENCES artists(id),
  project_id INTEGER REFERENCES projects(id),
  event_id   INTEGER REFERENCES events(id),
  task_id    INTEGER REFERENCES tasks(id),
  section_id INTEGER REFERENCES custom_sections(id),
  label      TEXT NOT NULL,
  url        TEXT,
  color      TEXT,
  category   TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  CHECK ((artist_id IS NOT NULL) + (project_id IS NOT NULL) + (event_id IS NOT NULL) + (task_id IS NOT NULL) + (section_id IS NOT NULL) = 1)
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
-- idx_links_section lives in migrateLinksSectionParent, not here: on a pre-WP-S database this
-- SCHEMA runs before the links rebuild, when links.section_id does not exist yet.
CREATE INDEX IF NOT EXISTS idx_sections_artist  ON custom_sections(artist_id);
CREATE INDEX IF NOT EXISTS idx_sections_project ON custom_sections(project_id);
`;

// event_types / project_statuses are coloured options (WP-I): `{ value, label, color }[]`.
// value is the stable key stored on events.type / projects.status; label is the editable
// display name; renaming edits only the label so existing rows stay linked (no migration).
// The event-type colours match the formerly-hardcoded client palette so nothing changes visually.
export const DEFAULT_EVENT_TYPES: ColumnOption[] = [
  { value: 'Auftritt', label: 'Auftritt', color: '#fef3c7' },
  { value: 'Termin', label: 'Termin', color: '#e2e8f0' },
  { value: 'Anreise', label: 'Anreise', color: '#e0f2fe' },
  { value: 'Deadline', label: 'Deadline', color: '#fee2e2' },
];
export const DEFAULT_PROJECT_STATUSES: ColumnOption[] = [
  { value: 'Not Started', label: 'Not Started', color: '#e2e8f0' },
  { value: 'In Progress', label: 'In Progress', color: '#dbeafe' },
  { value: 'Done', label: 'Done', color: '#dcfce7' },
];

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
/**
 * Fixpoint safety stop for purgeExpired. Every pass strictly shrinks the row count and the
 * sweep never inserts, so the loop terminates on its own; this only caps a pathologically
 * deep subtask chain (one pass per level). Hitting it defers the rest to the next launch —
 * the sweep is idempotent and every run makes progress.
 */
const MAX_PURGE_PASSES = 100;
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
  migrateEventsOptionalStart(db);
  migrateProjectsMergeNotes(db);
  migrateLinksCategory(db);
  migrateLinksSectionParent(db);
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
  // A non-empty -wal sidecar means committed rows still sit in the WAL. The import copies only
  // the .db (importIntoActiveSeason), so those rows would be silently lost — and the read-only
  // open below often rejects such a file first with a misleading "keine gültige SQLite-Datenbank".
  // Reject it explicitly with an actionable message. App-produced candidates are VACUUM INTO
  // output (no WAL), so this only bites hand-picked raw .db files. The size > 0 guard tolerates a
  // cleanly-closed WAL-mode db that left a 0-byte -wal behind (SRV-15).
  const wal = `${path}-wal`;
  if (existsSync(wal) && statSync(wal).size > 0) {
    return 'Die gewählte Datei hat nicht gesicherte Änderungen (WAL-Datei) und kann nicht importiert werden. Bitte exportiere die Datenbank aus Auftakt und importiere die erzeugte Datei.';
  }
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

/** Add the link-category column (stores a link_categories option `value`, WP-P). Idempotent. */
function migrateLinksCategory(db: Database.Database): void {
  ensureColumn(db, 'links', 'category', 'category TEXT');
}

/** Add the subtask parent link (tasks.parent_id → tasks.id) to older databases. Idempotent. */
function migrateTaskParentId(db: Database.Database): void {
  ensureColumn(db, 'tasks', 'parent_id', 'parent_id INTEGER REFERENCES tasks(id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id)');
}

/** Whether a stored `options` blob still holds at least one usable category. */
function hasStoredOptions(json: unknown): boolean {
  if (typeof json !== 'string' || !json) return false;
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) && v.length > 0;
  } catch {
    return false;
  }
}

/**
 * Insert the built-in task columns (Status, Aufgabe, Priorität, Fällig, Kommentar) if missing,
 * and restore the categories of one whose options were wiped. Idempotent.
 *
 * The repair exists because emptying a built-in's option list used to be reachable from the
 * editor and left no way back: every pill falls back to the „—" placeholder with an empty
 * dropdown, and the editor only takes a *label*, so the machine values can't be re-typed. New
 * writes are refused on both sides now (TTU-02), but a database already in that state would
 * stay there forever, because the insert below only covers *missing* built-ins. Restoring the
 * defaults does not re-link tasks holding a season's own former values — those still need
 * re-tagging — but it makes the column usable again.
 */
export function ensureBuiltinColumns(db: Database.Database): void {
  const find = db.prepare(
    'SELECT id, options FROM custom_columns WHERE key = ? AND deleted_at IS NULL LIMIT 1',
  );
  const ins = db.prepare(
    `INSERT INTO custom_columns (name, type, scope, project_id, options, key, kind, enabled, deletable, sort_order)
     VALUES (@name, @type, 'global', NULL, @options, @key, 'builtin', @enabled, @deletable, @sort_order)`,
  );
  const repair = db.prepare(
    "UPDATE custom_columns SET options = ?, updated_at = datetime('now') WHERE id = ?",
  );
  const tx = db.transaction(() => {
    for (const b of BUILTIN_COLUMNS) {
      const row = find.get(b.key) as { id: number; options: unknown } | undefined;
      if (!row) {
        ins.run({
          name: b.name,
          type: b.type,
          options: b.options ? JSON.stringify(b.options) : null,
          key: b.key,
          enabled: b.enabled,
          deletable: b.deletable,
          sort_order: b.sort_order,
        });
      } else if (b.options && !hasStoredOptions(row.options)) {
        repair.run(JSON.stringify(b.options), row.id);
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
        status        TEXT NOT NULL DEFAULT 'new',
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

/**
 * Drop NOT NULL from events.start_at so date-less ("TBD") events are allowed. NULL is the
 * storage form — "Datum offen" is purely a display label. SQLite can't ALTER a column
 * constraint, so rebuild the table (the standard 12-step). Idempotent: only runs while the
 * old constraint is present.
 */
function migrateEventsOptionalStart(db: Database.Database): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'events'")
    .get() as { sql?: string } | undefined;
  if (!row?.sql || !/start_at\s+TEXT\s+NOT\s+NULL/.test(row.sql)) return; // already migrated (or fresh SCHEMA)

  // foreign_keys must be toggled OUTSIDE the transaction to take effect.
  db.pragma('foreign_keys = OFF');
  const rebuild = db.transaction(() => {
    db.exec(`
      CREATE TABLE events_new (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        artist_id  INTEGER REFERENCES artists(id),
        project_id INTEGER REFERENCES projects(id),
        type       TEXT NOT NULL,
        title      TEXT NOT NULL,
        start_at   TEXT,
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
      INSERT INTO events_new SELECT
        id, artist_id, project_id, type, title, start_at, end_at, all_day,
        location, notes, sort_order, created_at, updated_at, deleted_at
      FROM events;
      DROP TABLE events;
      ALTER TABLE events_new RENAME TO events;
      CREATE INDEX IF NOT EXISTS idx_events_artist  ON events(artist_id);
      CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id);
      CREATE INDEX IF NOT EXISTS idx_events_start   ON events(start_at);
    `);
  });
  rebuild();
  db.pragma('foreign_keys = ON');
}

/**
 * Merge projects.notes into description (paragraph break when both are filled), then drop
 * the column — "Allgemeines / Beschreibung" is the one free-text field a project keeps.
 * Plain DROP COLUMN is legal here (SQLite ≥ 3.35): notes is not indexed, not in a CHECK
 * and referenced nowhere else. Idempotent: only runs while the column exists.
 */
function migrateProjectsMergeNotes(db: Database.Database): void {
  const have = new Set(
    (db.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!have.has('notes')) return;
  db.exec(`
    UPDATE projects SET description =
      CASE WHEN description IS NOT NULL AND description != ''
           THEN description || char(10) || char(10) || notes
           ELSE notes END
    WHERE notes IS NOT NULL AND notes != '';
    ALTER TABLE projects DROP COLUMN notes;
  `);
}

/**
 * Add `section_id` as the fifth exclusive link parent (custom "Dokumente & Links" widgets,
 * WP-S). The parent CHECK can't be ALTERed, so rebuild the table (the standard 12-step).
 * Runs after migrateLinksCategory — the column list below names `category`, which a database
 * jumping several versions gets in that same open. Idempotent: only runs while the old
 * constraint is present. `custom_sections` already exists (SCHEMA runs before migrations).
 */
function migrateLinksSectionParent(db: Database.Database): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'links'")
    .get() as { sql?: string } | undefined;
  if (!row?.sql || row.sql.includes('section_id')) {
    // Already migrated or fresh SCHEMA — the index still has to be ensured here (it can't be
    // in SCHEMA, whose exec precedes this rebuild on old databases).
    db.exec('CREATE INDEX IF NOT EXISTS idx_links_section ON links(section_id)');
    return;
  }

  // foreign_keys must be toggled OUTSIDE the transaction to take effect.
  db.pragma('foreign_keys = OFF');
  const rebuild = db.transaction(() => {
    db.exec(`
      CREATE TABLE links_new (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        artist_id  INTEGER REFERENCES artists(id),
        project_id INTEGER REFERENCES projects(id),
        event_id   INTEGER REFERENCES events(id),
        task_id    INTEGER REFERENCES tasks(id),
        section_id INTEGER REFERENCES custom_sections(id),
        label      TEXT NOT NULL,
        url        TEXT,
        color      TEXT,
        category   TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT,
        CHECK ((artist_id IS NOT NULL) + (project_id IS NOT NULL) + (event_id IS NOT NULL) + (task_id IS NOT NULL) + (section_id IS NOT NULL) = 1)
      );
      INSERT INTO links_new (id, artist_id, project_id, event_id, task_id, label, url, color, category,
                             sort_order, created_at, updated_at, deleted_at)
        SELECT id, artist_id, project_id, event_id, task_id, label, url, color, category,
               sort_order, created_at, updated_at, deleted_at
        FROM links;
      DROP TABLE links;
      ALTER TABLE links_new RENAME TO links;
      CREATE INDEX IF NOT EXISTS idx_links_parents ON links(artist_id, project_id, event_id, task_id);
      CREATE INDEX IF NOT EXISTS idx_links_section ON links(section_id);
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
  // Purge ONLY rows whose OWN deleted_at expired (SDL-01/DBW-01). The SRV-01 shape rooted at
  // every expired row and hard-deleted its whole collect() closure — including still-live
  // children. Soft-delete marks a single row (crud.ts), so a trashed artist keeps its live
  // projects/tasks/links, and 30 days later they were destroyed with it at the next launch,
  // before any window opened. collect() stays as-is for the manual trash delete in
  // routes/deleted.ts, where the user confirms a counted cascade first.
  //
  // The FK deadlock SRV-01 fixed is avoided by a guard instead: skip any expired row that a
  // remaining row still references. Every FK is NO ACTION with foreign_keys = ON, so deleting
  // such a parent throws and rolls the whole sweep back. The guards are generated from
  // CHILD_EDGES, so cascade.ts stays the single source of truth for the FK graph. Consequence,
  // by design: a parent with live children is never auto-purged — the archive page's
  // "Endgültig löschen" (which counts and warns) is the only way it leaves.
  //
  // Set-based predicates, never `id IN (?,?,…)`: one bound param per row throws "too many SQL
  // variables" past 32766 and kills the purge forever (DBW-02).
  //
  // The child table MUST be aliased. tasks.parent_id points back at tasks, and unaliased
  // `NOT EXISTS (SELECT 1 FROM tasks WHERE tasks.parent_id = tasks.id)` binds both sides to
  // the inner table — an uncorrelated "is any task its own parent?" that is always false, so
  // the guard silently vanishes and the deadlock returns.
  //
  // DELETE_ORDER is a reverse-topological order of the FK graph, so when a table's turn comes
  // every table referencing it has already been swept in this same pass. The lone exception is
  // tasks -> tasks. SQLite runs this as a two-pass DELETE — matching rowids are collected
  // first — so the guard reads a pre-statement snapshot and one statement takes only the
  // current leaves of a subtask chain. Hence the fixpoint loop: an N-deep expired chain needs
  // N passes, and its project/artist ancestors clear in the same pass as its last task. The
  // loop is also what makes this independent of that snapshot behaviour, which SQLite does not
  // contractually guarantee — a release evaluating the guard against live state would simply
  // converge sooner, never unsafely (the child is gone before the parent).
  const { cutoff } = db
    .prepare(`SELECT datetime('now', ?) AS cutoff`)
    .get(`-${PURGE_AFTER_DAYS} days`) as { cutoff: string };

  // table/child/fk all come from the hardcoded cascade graph, never from the client.
  const deletes = DELETE_ORDER.map((table) => {
    const guards = (CHILD_EDGES[table] ?? []).map(
      ([child, fk]) => ` AND NOT EXISTS (SELECT 1 FROM ${child} ch WHERE ch.${fk} = ${table}.id)`,
    );
    return db.prepare(
      `DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < ?${guards.join('')}`,
    );
  });

  const tx = db.transaction(() => {
    for (let pass = 0; pass < MAX_PURGE_PASSES; pass++) {
      let changed = 0;
      for (const stmt of deletes) changed += stmt.run(cutoff).changes;
      if (changed === 0) return; // fixpoint reached
    }
    // Bound exhausted (an absurdly deep subtask chain): keep what this run removed — the guards
    // make every intermediate state FK-consistent — and let the next launch continue.
  });
  tx();
}
