import { Router } from 'express';
import ExcelJS from 'exceljs';
import { getDb } from '../db';
import { listTasks } from '../lib/queries';
import { numParam as num } from '../lib/query';

export const exportRouter = Router();

interface TaskRow {
  title: string;
  artist_name: string | null;
  project_code: string | null;
  priority: string;
  status: string;
  due_date: string | null;
  erledigt_am: string | null;
  comment: string | null;
  custom_values: string;
}

interface Col {
  id: number;
  name: string;
  type: string;
  options: string | null;
}

function isoDay(s: string | null): string {
  return s ? s.slice(0, 10).split('-').reverse().join('.') : '';
}

/** GET /api/export/tasks.xlsx — the (optionally filtered) task table as an .xlsx download. */
exportRouter.get('/tasks.xlsx', async (req, res) => {
  const db = getDb();
  const projectId = num(req.query.project_id);
  const tasks = listTasks(db, {
    projectId,
    artistId: num(req.query.artist_id),
    resolvedArtistId: num(req.query.resolved_artist_id),
    scope: (req.query.scope as 'live' | 'archive' | 'all' | undefined) ?? 'live',
  }) as TaskRow[];

  const globalCols = db
    .prepare("SELECT id, name, type, options FROM custom_columns WHERE deleted_at IS NULL AND scope = 'global' AND kind = 'custom' ORDER BY sort_order")
    .all() as Col[];
  const projectCols = projectId
    ? (db
        .prepare("SELECT id, name, type, options FROM custom_columns WHERE deleted_at IS NULL AND scope = 'project' AND kind = 'custom' AND project_id = ? ORDER BY sort_order")
        .all(projectId) as Col[])
    : [];
  const customCols = [...globalCols, ...projectCols];

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Auftakt';
  const ws = wb.addWorksheet('Aufgaben');
  ws.columns = [
    { header: 'Aufgabe', key: 'title', width: 50 },
    { header: 'Künstler', key: 'artist', width: 20 },
    { header: 'Projekt', key: 'project', width: 12 },
    { header: 'Priorität', key: 'priority', width: 12 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Fällig', key: 'due', width: 12 },
    { header: 'Erledigt am', key: 'done', width: 14 },
    ...customCols.map((c) => ({ header: c.name, key: `c${c.id}`, width: 18 })),
    { header: 'Kommentar', key: 'comment', width: 60 },
  ];

  for (const t of tasks) {
    let cv: Record<string, unknown> = {};
    try {
      cv = JSON.parse(t.custom_values || '{}');
    } catch {
      cv = {};
    }
    const row: Record<string, unknown> = {
      title: t.title,
      artist: t.artist_name ?? '',
      project: t.project_code ?? '',
      priority: t.priority,
      status: t.status,
      due: isoDay(t.due_date),
      done: isoDay(t.erledigt_am),
      comment: t.comment ?? '',
    };
    for (const c of customCols) {
      const v = cv[String(c.id)];
      row[`c${c.id}`] = c.type === 'checkbox' ? (v === true || v === 'true' ? 'ja' : '') : v == null ? '' : String(v);
    }
    ws.addRow(row);
  }

  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: 'middle' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  // Skip row 1: the header's comment cell was just styled (bold, vertical middle) above, and
  // wrapText/top would overwrite that (SRV-14).
  ws.eachRow((r, n) => {
    if (n > 1) r.getCell('comment').alignment = { wrapText: true, vertical: 'top' };
  });

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', 'attachment; filename="auftakt-aufgaben.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});
