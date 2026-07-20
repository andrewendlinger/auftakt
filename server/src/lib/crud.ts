import { Router, type RequestHandler } from 'express';
import { getDb } from '../db';

type Body = Record<string, unknown>;
type Row = Record<string, unknown>;

export interface CrudOptions {
  table: string;
  /** Columns a client is allowed to set. */
  writable: string[];
  /** Columns that must be present & non-empty on create. */
  required?: string[];
  /** Query params (?x=) that become equality filters on the default list. */
  filters?: string[];
  /** ORDER BY clause for the default list (without the keyword). */
  order?: string;
  /** Columns stored as JSON text; object/array values are stringified. */
  jsonColumns?: string[];
  /** Adjust the payload before write (e.g. derive erledigt_am from status). */
  transform?: (body: Body, ctx: { mode: 'create' | 'update'; existing?: Row }) => Body;
  /** Replace the default list handler (used for denormalised joins). */
  customList?: RequestHandler;
}

function pick(src: Body, keys: string[]): Body {
  const out: Body = {};
  for (const k of keys) if (k in src) out[k] = src[k];
  return out;
}

function coerce(v: unknown): unknown {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === undefined) return null;
  return v;
}

function applyJson(body: Body, jsonColumns: string[]): void {
  for (const c of jsonColumns) {
    if (c in body && body[c] !== null && typeof body[c] === 'object') {
      body[c] = JSON.stringify(body[c]);
    }
  }
}

function one(table: string, id: unknown): Row | undefined {
  return getDb().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Row | undefined;
}

export function crudRouter(opts: CrudOptions): Router {
  const {
    table,
    writable,
    required = [],
    filters = [],
    order,
    jsonColumns = [],
    transform,
    customList,
  } = opts;
  const r = Router();

  const defaultList: RequestHandler = (req, res) => {
    const db = getDb();
    const where = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    for (const f of filters) {
      const val = req.query[f];
      if (val !== undefined) {
        where.push(`${f} = ?`);
        params.push(val);
      }
    }
    const orderBy = order ? ` ORDER BY ${order}` : '';
    const rows = db
      .prepare(`SELECT * FROM ${table} WHERE ${where.join(' AND ')}${orderBy}`)
      .all(...params);
    res.json(rows);
  };

  r.get('/', customList ?? defaultList);

  r.get('/:id', (req, res) => {
    const row = one(table, req.params.id);
    if (!row || row.deleted_at) return res.status(404).json({ error: 'not found' });
    res.json(row);
  });

  r.post('/', (req, res) => {
    const db = getDb();
    let body = pick((req.body ?? {}) as Body, writable);
    if (transform) body = transform(body, { mode: 'create' });
    applyJson(body, jsonColumns);
    for (const key of required) {
      if (body[key] === undefined || body[key] === null || body[key] === '') {
        return res.status(400).json({ error: `${key} is required` });
      }
    }
    const cols = Object.keys(body);
    if (cols.length === 0) return res.status(400).json({ error: 'no fields to insert' });
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
    const info = db.prepare(sql).run(...cols.map((c) => coerce(body[c])));
    res.status(201).json(one(table, info.lastInsertRowid));
  });

  r.patch('/:id', (req, res) => {
    const db = getDb();
    const existing = one(table, req.params.id);
    if (!existing || existing.deleted_at) return res.status(404).json({ error: 'not found' });
    let body = pick((req.body ?? {}) as Body, writable);
    if (transform) body = transform(body, { mode: 'update', existing });
    applyJson(body, jsonColumns);
    const cols = Object.keys(body);
    if (cols.length > 0) {
      const setClause = cols.map((c) => `${c} = ?`).join(', ');
      db.prepare(`UPDATE ${table} SET ${setClause}, updated_at = datetime('now') WHERE id = ?`).run(
        ...cols.map((c) => coerce(body[c])),
        req.params.id,
      );
    }
    res.json(one(table, req.params.id));
  });

  r.delete('/:id', (req, res) => {
    const info = getDb()
      .prepare(
        `UPDATE ${table} SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(req.params.id);
    res.json({ id: Number(req.params.id), deleted: info.changes > 0 });
  });

  r.post('/:id/restore', (req, res) => {
    getDb()
      .prepare(`UPDATE ${table} SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ?`)
      .run(req.params.id);
    res.json(one(table, req.params.id));
  });

  return r;
}
