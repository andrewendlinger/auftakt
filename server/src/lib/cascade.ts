import type Database from 'better-sqlite3';

/**
 * The soft-delete FK graph, shared by the manual trash delete (`routes/deleted.ts`) and the
 * startup purge (`purgeExpired` in `db.ts`). Kept dependency-light — it imports only the
 * better-sqlite3 type and takes `db` as a parameter — so both callers can use it without an
 * import cycle through `db.ts`.
 *
 * The three callers use it differently, on purpose. The manual delete walks `collect()` and
 * hard-deletes the whole closure, live children included — that is a counted, confirmed
 * choice the user makes in a dialog. The startup purge never expands: it takes only rows
 * whose own `deleted_at` expired and generates `NOT EXISTS` guards from `CHILD_EDGES` to
 * skip anything a remaining row still references (SDL-01). The delete *preview*
 * (`GET /artists/:id/dependents`, WP-34) walks `collect(…, { liveOnly: true })`, because it
 * describes a soft delete: what it counts is what stops being visible, and a row already in
 * the Papierkorb is invisible either way.
 *
 * Exports: `CHILD_EDGES`, `DELETE_ORDER`, `TABLE_TYPE`, `collect`, `dependentCounts`,
 * `hasLiveDescendant`.
 */

/**
 * Reverse foreign-key edges: for a row in <table>, the child tables/columns that reference it
 * (derived from the SCHEMA in db.ts). `custom_columns` is here as a cascade target even though
 * it is not a user-facing type — a project's columns must go when the project is purged.
 */
export const CHILD_EDGES: Record<string, Array<readonly [table: string, fk: string]>> = {
  artists: [
    ['projects', 'artist_id'],
    ['contacts', 'artist_id'],
    ['events', 'artist_id'],
    ['tasks', 'artist_id'],
    ['links', 'artist_id'],
    ['custom_sections', 'artist_id'],
  ],
  projects: [
    ['contacts', 'project_id'],
    ['events', 'project_id'],
    ['tasks', 'project_id'],
    ['custom_columns', 'project_id'],
    ['links', 'project_id'],
    ['custom_sections', 'project_id'],
  ],
  events: [['links', 'event_id']],
  tasks: [
    ['tasks', 'parent_id'], // subtasks recurse
    ['links', 'task_id'],
  ],
  contacts: [],
  links: [],
  custom_columns: [],
  custom_sections: [['links', 'section_id']],
};

/** Delete children before parents so no FK is violated mid-transaction (foreign_keys = ON). */
export const DELETE_ORDER = ['links', 'custom_sections', 'custom_columns', 'tasks', 'events', 'contacts', 'projects', 'artists'];

/**
 * table → the type name the client counts by. `custom_columns` has no user-facing deleted type
 * of its own, but a project's columns are part of both the cascade and the delete preview, so it
 * maps to `column` all the same.
 */
export const TABLE_TYPE: Record<string, string> = {
  artists: 'artist',
  projects: 'project',
  contacts: 'contact',
  events: 'event',
  tasks: 'task',
  links: 'link',
  custom_columns: 'column',
  custom_sections: 'section',
};

export type Collected = Map<string, Set<number>>;

/**
 * Prepared-statement cache for the two walks below, keyed by connection and then by SQL.
 *
 * `collect()` compiled its statement inside the BFS loop, and `GET /api/deleted` calls
 * `collect()` once per soft-deleted row — so the archive page cost O(trash × closure)
 * compilations per load, against a trash that is now unbounded: the guarded purge parks any
 * parent something still references rather than destroying live children (SDL-01).
 *
 * Keyed by the `Database` object, so a season's statements become collectable the moment
 * `closeDb()` drops the handle, and the next `getDb()` — a different object — starts empty. No
 * statement can outlive the connection it was compiled against.
 *
 * Every SQL string reaching here is built from the hardcoded `CHILD_EDGES`/table names above,
 * never from client input, so the key space is a fixed handful of strings.
 */
const stmtCache = new WeakMap<Database.Database, Map<string, Database.Statement>>();

function cached(db: Database.Database, sql: string): Database.Statement {
  let bySql = stmtCache.get(db);
  if (!bySql) {
    bySql = new Map();
    stmtCache.set(db, bySql);
  }
  let stmt = bySql.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    bySql.set(sql, stmt);
  }
  return stmt;
}

export interface CollectOptions {
  /**
   * Skip soft-deleted children, and do not descend through them.
   *
   * Off by default, because the two destructive callers must see the *whole* closure: a hard
   * delete that stepped over a trashed row would leave it behind with a dangling FK, and the
   * purge's guards exist precisely to notice rows a parent still references.
   *
   * On for the delete preview, where the closure is a promise made to the user rather than a
   * work list. A soft delete hides live descendants; one that is already in the Papierkorb is
   * hidden from every list either way, so counting it would overstate what the click costs.
   * Matches `liveSubtreeIds` (routes/entities.ts), which draws the same line for task trees.
   */
  liveOnly?: boolean;
}

/** Transitive closure of a row and everything that (recursively) references it, keyed by table. */
export function collect(
  db: Database.Database,
  rootTable: string,
  rootId: number,
  opts: CollectOptions = {},
): Collected {
  const found: Collected = new Map();
  const add = (table: string, id: number): boolean => {
    let set = found.get(table);
    if (!set) {
      set = new Set();
      found.set(table, set);
    }
    if (set.has(id)) return false;
    set.add(id);
    return true;
  };
  const queue: Array<[string, number]> = [];
  if (add(rootTable, rootId)) queue.push([rootTable, rootId]);
  while (queue.length) {
    const [table, id] = queue.shift() as [string, number];
    for (const [childTable, fk] of CHILD_EDGES[table] ?? []) {
      // childTable/fk come from the hardcoded CHILD_EDGES map, never from the client. The
      // liveOnly arm is a second SQL string rather than a bound parameter, which the statement
      // cache handles for free: it is keyed by the SQL itself, so both variants simply coexist.
      const live = opts.liveOnly ? ' AND deleted_at IS NULL' : '';
      const rows = cached(db, `SELECT id FROM ${childTable} WHERE ${fk} = ?${live}`).all(id) as {
        id: number;
      }[];
      for (const row of rows) if (add(childTable, row.id)) queue.push([childTable, row.id]);
    }
  }
  return found;
}

export interface DependentCounts {
  total: number;
  byType: Record<string, number>;
}

/**
 * Count everything in the closure except the root row itself, grouped by type name.
 *
 * Shared by the trash (what „Endgültig löschen" destroys) and the delete preview (what a soft
 * delete hides). Which of the two a count describes is decided by the `liveOnly` flag the
 * caller passed to `collect`, not here.
 */
export function dependentCounts(
  collected: Collected,
  rootTable: string,
  rootId: number,
): DependentCounts {
  const byType: Record<string, number> = {};
  let total = 0;
  for (const [table, ids] of collected) {
    for (const id of ids) {
      if (table === rootTable && id === rootId) continue;
      const type = TABLE_TYPE[table];
      if (!type) continue;
      byType[type] = (byType[type] ?? 0) + 1;
      total++;
    }
  }
  return { total, byType };
}

/**
 * True when a row in this closure other than the root is still live, which is exactly when the
 * startup purge will refuse to take the root (it skips anything a remaining row references).
 * The archive page uses it to stop promising a purge date it will never honour — see the guard
 * in `purgeExpired`, and keep the two in step.
 *
 * A trashed-but-not-yet-expired descendant is deliberately not counted: it blocks the root only
 * until it expires itself, after which the same sweep takes both.
 */
export function hasLiveDescendant(
  db: Database.Database,
  collected: Collected,
  rootTable: string,
  rootId: number,
): boolean {
  for (const [table, ids] of collected) {
    // One statement per table, one lookup per id — never an IN-list, which has a bound-parameter
    // ceiling and the trash is now unbounded (a blocked root stays until deleted by hand).
    const stmt = cached(db, `SELECT 1 FROM ${table} WHERE id = ? AND deleted_at IS NULL LIMIT 1`);
    for (const id of ids) {
      if (table === rootTable && id === rootId) continue;
      if (stmt.get(id)) return true;
    }
  }
  return false;
}
