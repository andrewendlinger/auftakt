import { Router } from 'express';
import { doneStatusValue, getDb } from '../db';
import { HttpError } from '../lib/query';

/**
 * How many rows still hold each option value, and the bulk rewrite that lets one be retired.
 *
 * Both halves exist because deleting a category is otherwise silently destructive: the option
 * disappears from the column/setting while every row still carrying it keeps a value nothing
 * resolves — a grey „—" pill, no place in the option-order sort, and for the Status column no
 * recognition by `doneStatusValue`, so the task un-archives and loses its strike-through
 * (TTU-34, RTE-06).
 *
 * Counted over **every** row, `deleted_at` ignored and no archive filter, which is exactly what
 * the client's own list-based tallies could not do:
 *  - a live-only count let a category be removed out from under a soft-deleted event that is
 *    restorable for 30 days, orphaning it the moment it came back (PGS-02);
 *  - a `project_id`-filtered count missed values on tasks that were moved out of the project,
 *    which MoveTaskDialog deliberately keeps (TTU-10).
 *
 * Reassignment lives here rather than in the client for the same reason: `crudRouter.patch`
 * 404s on a soft-deleted row, so the rows most at risk are precisely the ones a loop of PATCHes
 * cannot reach.
 */

/** value → count for one text column, skipping NULL/'' which mean „no category". */
function countColumn(table: string, column: string): Record<string, number> {
  // table/column are hardcoded literals below, never client input.
  const rows = getDb()
    .prepare(
      `SELECT ${column} AS value, COUNT(*) AS n FROM ${table}
       WHERE ${column} IS NOT NULL AND ${column} <> '' GROUP BY ${column}`,
    )
    .all() as Array<{ value: string; n: number }>;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.value] = r.n;
  return out;
}

function parseValues(json: unknown): Record<string, unknown> {
  if (typeof json !== 'string' || !json) return {};
  try {
    const v: unknown = JSON.parse(json);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** column id → value → count, scanned out of the tasks.custom_values blobs. */
function countCustomValues(): Record<string, Record<string, number>> {
  const rows = getDb().prepare('SELECT custom_values FROM tasks').all() as Array<{
    custom_values: unknown;
  }>;
  const out: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    for (const [key, raw] of Object.entries(parseValues(row.custom_values))) {
      if (raw === null || raw === undefined || raw === '' || raw === false) continue;
      const value = String(raw);
      const bucket = (out[key] ??= {});
      bucket[value] = (bucket[value] ?? 0) + 1;
    }
  }
  return out;
}

export const usageRouter = Router();

usageRouter.get('/', (_req, res) => {
  res.json({
    event_types: countColumn('events', 'type'),
    project_statuses: countColumn('projects', 'status'),
    link_categories: countColumn('links', 'category'),
    task_status: countColumn('tasks', 'status'),
    task_priority: countColumn('tasks', 'priority'),
    custom_columns: countCustomValues(),
  });
});

/** The allowlist of what may be rewritten — a client never names a table or column. */
const REASSIGN_FIELDS = {
  event_type: { table: 'events', column: 'type' },
  project_status: { table: 'projects', column: 'status' },
  link_category: { table: 'links', column: 'category' },
  task_status: { table: 'tasks', column: 'status' },
  task_priority: { table: 'tasks', column: 'priority' },
} as const;

function str(v: unknown, what: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${what} fehlt.`);
  return v;
}

/**
 * Move every row from one option value to another, trashed rows included.
 *
 * `task_status` also carries the `erledigt_am` derivation, mirroring the tasks transform in
 * entities.ts: entering the done category stamps a completion date (preserving one that is
 * already there, so a long-finished task doesn't un-archive), leaving it clears the date. The
 * done value is read *now*, so callers must save the column's new options before reassigning —
 * otherwise a category that is about to become „erledigt" is still read as an open one.
 */
usageRouter.post('/reassign', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const field = str(body.field, 'Feld');
  const from = str(body.from, 'Ausgangswert');
  const to = str(body.to, 'Zielwert');
  const db = getDb();

  if (field === 'custom_column') {
    const id = Number(body.columnId);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Ungültige Spalte.');
    const key = String(id);
    // Done in JS rather than with json_set() so the path never has to be built by string
    // concatenation, and so this reads like every other custom_values access in the codebase.
    const rows = db.prepare('SELECT id, custom_values FROM tasks').all() as Array<{
      id: number;
      custom_values: unknown;
    }>;
    const upd = db.prepare(
      "UPDATE tasks SET custom_values = ?, updated_at = datetime('now') WHERE id = ?",
    );
    let changed = 0;
    db.transaction(() => {
      for (const row of rows) {
        const values = parseValues(row.custom_values);
        const current = values[key];
        if (current === null || current === undefined || String(current) !== from) continue;
        values[key] = to;
        upd.run(JSON.stringify(values), row.id);
        changed++;
      }
    })();
    return res.json({ ok: true, changed });
  }

  if (!Object.hasOwn(REASSIGN_FIELDS, field)) throw new HttpError(400, 'Unbekanntes Feld.');
  const { table, column } = REASSIGN_FIELDS[field as keyof typeof REASSIGN_FIELDS];

  if (field === 'task_status') {
    const done = doneStatusValue(db);
    // SQLite space format (YYYY-MM-DD HH:MM:SS), matching the transform in entities.ts, so the
    // string compare behind the archive query stays exact.
    const info = db
      .prepare(
        `UPDATE tasks
            SET status = @to,
                erledigt_am = CASE WHEN @to = @done
                                   THEN COALESCE(erledigt_am, strftime('%Y-%m-%d %H:%M:%S', 'now'))
                                   ELSE NULL END,
                updated_at = datetime('now')
          WHERE status = @from`,
      )
      .run({ to, from, done });
    return res.json({ ok: true, changed: info.changes });
  }

  const info = db
    .prepare(`UPDATE ${table} SET ${column} = ?, updated_at = datetime('now') WHERE ${column} = ?`)
    .run(to, from);
  res.json({ ok: true, changed: info.changes });
});
