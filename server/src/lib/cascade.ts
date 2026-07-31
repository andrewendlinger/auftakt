import type Database from 'better-sqlite3';

/**
 * The soft-delete FK graph, shared by the manual trash delete (`routes/deleted.ts`) and the
 * startup purge (`purgeExpired` in `db.ts`). Kept dependency-light — it imports only the
 * better-sqlite3 type and takes `db` as a parameter — so both callers can use it without an
 * import cycle through `db.ts`.
 *
 * The two callers use it differently, on purpose. The manual delete walks `collect()` and
 * hard-deletes the whole closure, live children included — that is a counted, confirmed
 * choice the user makes in a dialog. The startup purge never expands: it takes only rows
 * whose own `deleted_at` expired and generates `NOT EXISTS` guards from `CHILD_EDGES` to
 * skip anything a remaining row still references (SDL-01).
 *
 * Exports: `CHILD_EDGES`, `DELETE_ORDER`, `collect`, `hasLiveDescendant`.
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

export type Collected = Map<string, Set<number>>;

/** Transitive closure of a row and everything that (recursively) references it, keyed by table. */
export function collect(db: Database.Database, rootTable: string, rootId: number): Collected {
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
      // childTable/fk come from the hardcoded CHILD_EDGES map, never from the client.
      const rows = db.prepare(`SELECT id FROM ${childTable} WHERE ${fk} = ?`).all(id) as { id: number }[];
      for (const row of rows) if (add(childTable, row.id)) queue.push([childTable, row.id]);
    }
  }
  return found;
}
