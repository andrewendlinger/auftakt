import { parse } from 'csv-parse/sync';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  getDb,
  setSetting,
  getSetting,
  ensureBuiltinColumns,
  DEFAULT_EVENT_TYPES,
  DEFAULT_PROJECT_STATUSES,
} from './db';

const here = dirname(fileURLToPath(import.meta.url));

/** Import folder: AUFTAKT_IMPORT_DIR env, else <repo>/files. */
function importDir(): string {
  if (process.env.AUFTAKT_IMPORT_DIR && process.env.AUFTAKT_IMPORT_DIR.trim() !== '') {
    return process.env.AUFTAKT_IMPORT_DIR;
  }
  return resolve(here, '../../files');
}

type Row = Record<string, string>;

function readCsv(dir: string, file: string): Row[] {
  const path = join(dir, file);
  if (!existsSync(path)) return [];
  const content = readFileSync(path, 'utf8');
  return parse(content, { columns: true, skip_empty_lines: true, bom: true, trim: true }) as Row[];
}

/** '' → null; otherwise the trimmed string. */
function nn(v: string | undefined): string | null {
  if (v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/**
 * Map legacy German project statuses in the CSVs onto the current 3-state default
 * (Not Started / In Progress / Done). Only `aktiv` occurs in the sample data; any
 * other value is passed through unchanged.
 */
function mapProjectStatus(v: string | null): string | null {
  return v === 'aktiv' ? 'In Progress' : v;
}

/** Integer FK or null. */
function ni(v: string | undefined): number | null {
  const s = nn(v);
  return s === null ? null : Number(s);
}

/** A value like "2026-08-31" is date-only (all-day); "2026-09-04 22:00" is timed. */
function isDateOnly(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}

/** Normalise a datetime cell to ISO local: "2026-09-04 22:00" → "2026-09-04T22:00". */
function toIsoLocal(v: string): string {
  return v.trim().replace(' ', 'T');
}

function clearTables(db: Database.Database): void {
  const tables = ['links', 'tasks', 'events', 'contacts', 'projects', 'artists', 'custom_columns'];
  // PRAGMA foreign_keys is a no-op inside a transaction, so toggle it around one.
  db.pragma('foreign_keys = OFF');
  const tx = db.transaction(() => {
    for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();
    db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('links','tasks','events','contacts','projects','artists','custom_columns')").run();
  });
  tx();
  db.pragma('foreign_keys = ON');
}

function seedFromCsv(db: Database.Database, dir: string): void {
  const nowIso = new Date().toISOString();

  const artists = readCsv(dir, 'artists.csv');
  const projects = readCsv(dir, 'projects.csv');
  const contacts = readCsv(dir, 'contacts.csv');
  const events = readCsv(dir, 'events.csv');
  const tasks = readCsv(dir, 'tasks.csv');
  const links = readCsv(dir, 'links.csv');

  const insArtist = db.prepare(
    `INSERT INTO artists (id, name, color, notes, sort_order) VALUES (@id, @name, @color, @notes, @sort_order)`,
  );
  const insProject = db.prepare(
    `INSERT INTO projects (id, artist_id, code, name, status, description, color, sort_order)
     VALUES (@id, @artist_id, @code, @name, @status, @description, @color, @sort_order)`,
  );
  const insContact = db.prepare(
    `INSERT INTO contacts (id, artist_id, project_id, role, name, email, phone, notes, sort_order)
     VALUES (@id, @artist_id, @project_id, @role, @name, @email, @phone, @notes, @sort_order)`,
  );
  const insEvent = db.prepare(
    `INSERT INTO events (id, artist_id, project_id, type, title, start_at, end_at, all_day, location, notes, sort_order)
     VALUES (@id, @artist_id, @project_id, @type, @title, @start_at, @end_at, @all_day, @location, @notes, @sort_order)`,
  );
  const insTask = db.prepare(
    `INSERT INTO tasks (id, artist_id, project_id, title, status, priority, due_date, comment, custom_values, erledigt_am, sort_order)
     VALUES (@id, @artist_id, @project_id, @title, @status, @priority, @due_date, @comment, '{}', @erledigt_am, @sort_order)`,
  );
  const insLink = db.prepare(
    `INSERT INTO links (id, artist_id, project_id, event_id, task_id, label, url, sort_order)
     VALUES (@id, @artist_id, @project_id, @event_id, @task_id, @label, @url, @sort_order)`,
  );

  const foundEventTypes = new Set<string>();

  const tx = db.transaction(() => {
    artists.forEach((r, i) => {
      insArtist.run({
        id: Number(r.id),
        name: r.name,
        color: nn(r.color) ?? '#888888',
        notes: nn(r.notes),
        sort_order: i,
      });
    });

    projects.forEach((r, i) => {
      // Legacy CSVs carry description AND notes; the schema keeps one field, so merge.
      const description = nn(r.description);
      const notes = nn(r.notes);
      insProject.run({
        id: Number(r.id),
        artist_id: Number(r.artist_id),
        code: r.code,
        name: r.name,
        status: mapProjectStatus(nn(r.status)),
        description: description && notes ? `${description}\n\n${notes}` : (description ?? notes),
        color: nn(r.color), // NULL => auto-derived shade at render time
        sort_order: i,
      });
    });

    contacts.forEach((r, i) => {
      insContact.run({
        id: Number(r.id),
        artist_id: ni(r.artist_id),
        project_id: ni(r.project_id),
        role: nn(r.role),
        name: r.name,
        email: nn(r.email),
        phone: nn(r.phone),
        notes: nn(r.notes),
        sort_order: i,
      });
    });

    events.forEach((r, i) => {
      const startRaw = r.start ?? '';
      const endRaw = nn(r.end);
      const allDay = isDateOnly(startRaw) ? 1 : 0;
      const eventType = nn(r.type);
      if (eventType) foundEventTypes.add(eventType);
      insEvent.run({
        id: Number(r.id),
        artist_id: ni(r.artist_id),
        project_id: ni(r.project_id),
        type: eventType ?? 'Termin',
        title: r.title,
        start_at: startRaw.trim() === '' ? null : allDay ? startRaw.trim() : toIsoLocal(startRaw), // NULL = "Datum offen" (TBD)
        end_at: endRaw === null ? null : allDay ? endRaw : toIsoLocal(endRaw),
        all_day: allDay,
        location: nn(r.location),
        notes: nn(r.notes),
        sort_order: i,
      });
    });

    tasks.forEach((r, i) => {
      // Map the legacy CSV status (offen/erledigt) to the New/Active/Done model.
      const rawStatus = nn(r.status) ?? 'offen';
      const status = rawStatus === 'erledigt' ? 'done' : rawStatus === 'offen' ? 'active' : rawStatus;
      // Confirmed decision: completed tasks with no completion date get erledigt_am = seed date.
      const erledigt_am = status === 'done' ? nowIso : null;
      insTask.run({
        id: Number(r.id),
        artist_id: ni(r.artist_id),
        project_id: ni(r.project_id),
        title: r.title,
        status,
        priority: nn(r.priority) ?? 'mittel',
        due_date: nn(r.due_date),
        comment: nn(r.comment),
        erledigt_am,
        sort_order: i,
      });
    });

    links.forEach((r, i) => {
      insLink.run({
        id: Number(r.id),
        artist_id: ni(r.artist_id),
        project_id: ni(r.project_id),
        event_id: ni(r.event_id),
        task_id: ni(r.task_id),
        label: r.label,
        url: nn(r.url), // label-only placeholders keep url = NULL
        sort_order: i,
      });
    });
  });
  tx();

  // Absorb any event types found in the data (e.g. "Probe") into the editable list as
  // coloured options (WP-I): defaults first, then any novel imported type, deduped by value.
  const LEGACY_EVENT_COLORS: Record<string, string> = {
    Auftritt: '#fef3c7', Termin: '#e2e8f0', Anreise: '#e0f2fe', Deadline: '#fee2e2', Probe: '#ede9fe',
  };
  const FALLBACK_COLORS = ['#fee2e2', '#fef3c7', '#dcfce7', '#e0f2fe', '#ede9fe', '#fce7f3', '#f1f5f9'];
  const byValue = new Map(DEFAULT_EVENT_TYPES.map((o) => [o.value, o]));
  let fi = 0;
  for (const name of foundEventTypes) {
    if (byValue.has(name)) continue;
    byValue.set(name, { value: name, label: name, color: LEGACY_EVENT_COLORS[name] ?? FALLBACK_COLORS[fi++ % FALLBACK_COLORS.length]! });
  }
  setSetting(db, 'event_types', JSON.stringify([...byValue.values()]));
}

/** Minimal sample data when ./files is empty — keeps a fresh install usable. */
function seedSample(db: Database.Database): void {
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO artists (id, name, color, notes) VALUES (1, 'Beispiel-Künstlerin', '#4F7CAC', 'Automatisch erzeugte Beispieldaten')`).run();
    db.prepare(`INSERT INTO projects (id, artist_id, code, name, status, description) VALUES (1, 1, 'B1', 'Beispielprojekt', 'In Progress', 'Beispielbeschreibung')`).run();
    db.prepare(`INSERT INTO contacts (id, project_id, role, name, email) VALUES (1, 1, 'Management', 'Max Mustermann', 'max@example.com')`).run();
    db.prepare(`INSERT INTO events (id, project_id, type, title, start_at, end_at, all_day, location) VALUES (1, 1, 'Auftritt', 'Beispielkonzert', '2026-09-01T20:00', '2026-09-01T21:30', 0, 'Konzerthaus')`).run();
    db.prepare(`INSERT INTO tasks (id, project_id, title, status, priority, comment) VALUES (1, 1, 'Beispielaufgabe', 'active', 'hoch', 'Notiz mit Link https://example.com')`).run();
  });
  tx();
}

function count(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

function main(): void {
  const db = getDb();
  const dir = importDir();
  const hasCsv = existsSync(dir) && readdirSync(dir).some((f) => f.endsWith('.csv'));

  clearTables(db);
  if (hasCsv) {
    console.log(`Seeding from CSVs in ${dir}`);
    seedFromCsv(db, dir);
  } else {
    console.log(`No CSVs found in ${dir} — generating sample data`);
    seedSample(db);
  }
  // clearTables wipes custom_columns, so re-create the built-in task columns.
  ensureBuiltinColumns(db);
  // Settings survive clearTables, so re-seeding an existing DB keeps stale defaults.
  // Reset the project-status list to the current default (the label/default migration).
  setSetting(db, 'project_statuses', JSON.stringify(DEFAULT_PROJECT_STATUSES));

  console.log('\nSeed complete. Row counts:');
  for (const t of ['artists', 'projects', 'contacts', 'events', 'tasks', 'links']) {
    console.log(`  ${t.padEnd(10)} ${count(db, t)}`);
  }
  console.log(`\n  Saison             ${getSetting(db, 'saison')}`);
  console.log(`  event_types        ${getSetting(db, 'event_types')}`);
  console.log(`  project_statuses   ${getSetting(db, 'project_statuses')}`);
}

main();
