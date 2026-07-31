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

/**
 * The only file names the importer reads. Branch selection has to agree with this list rather
 * than with "anything ending in .csv": an import dir holding only differently-named exports
 * (singular `artist.csv`, a Notion export, `Aufgaben.csv`) used to take the CSV branch, wipe
 * the database and insert nothing (SDB-03).
 */
const CSV_FILES = ['artists.csv', 'projects.csv', 'contacts.csv', 'events.csv', 'tasks.csv', 'links.csv'];

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

/**
 * Problems found while reading the CSVs, collected rather than thrown one at a time so a bad
 * file can be fixed in one pass. They are reported before the transaction opens, so a
 * malformed cell never reaches the database at all.
 */
type Problems = string[];

/** `index` is the 0-based data row; CSV line numbers count the header and start at 1. */
function problem(p: Problems, file: string, index: number, message: string): void {
  p.push(`${file} line ${index + 2}: ${message}`);
}

function throwProblems(p: Problems): void {
  if (p.length === 0) return;
  throw new Error(`${p.length} problem(s) in the import CSVs:\n  ${p.join('\n  ')}`);
}

/**
 * Optional integer FK: an empty cell is a legitimate NULL, anything non-numeric is not.
 * Number() used to take both — it turns '' into 0 and a missing column into NaN (SDB-04).
 */
function optId(p: Problems, file: string, index: number, field: string, v: string | undefined): number | null {
  const s = nn(v);
  if (s === null) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) {
    problem(p, file, index, `${field} "${s}" is not a positive whole number`);
    return null;
  }
  return n;
}

/** Required integer id or FK — an empty cell is a problem, not a 0. */
function reqId(p: Problems, file: string, index: number, field: string, v: string | undefined): number {
  if (nn(v) === null) {
    problem(p, file, index, `${field} is empty`);
    return 0; // never inserted: throwProblems() runs before anything is written
  }
  return optId(p, file, index, field, v) ?? 0;
}

/** A value like "2026-08-31" is date-only (all-day); "2026-09-04 22:00" is timed. */
function isDateOnly(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}

/** Normalise a datetime cell to ISO local: "2026-09-04 22:00" → "2026-09-04T22:00". */
function toIsoLocal(v: string): string {
  return v.trim().replace(' ', 'T');
}

/**
 * Wipe every seeded data table (settings deliberately survive). custom_sections was missing,
 * so a re-seed left stale widget sections on re-used artist/project ids.
 *
 * Deliberately NOT its own transaction: it must run inside main()'s, under
 * `defer_foreign_keys = ON`. Committing the wipe separately from the insert is what used to
 * leave a real database empty when a single CSV row failed (SDB-01), and the wipe on its own
 * cannot satisfy the FKs anyway — `DELETE FROM tasks` deletes parents and children in one
 * statement, in no defined order.
 */
function clearTables(db: Database.Database): void {
  const tables = [
    'links',
    'tasks',
    'events',
    'contacts',
    'projects',
    'artists',
    'custom_columns',
    'custom_sections',
  ];
  const placeholders = tables.map(() => '?').join(',');
  for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();
  // Derived from the same list so the AUTOINCREMENT reset can never drift from it.
  db.prepare(`DELETE FROM sqlite_sequence WHERE name IN (${placeholders})`).run(...tables);
}

interface ArtistIns {
  id: number;
  name: string | undefined;
  color: string;
  notes: string | null;
  sort_order: number;
}
interface ProjectIns {
  id: number;
  artist_id: number;
  code: string | undefined;
  name: string | undefined;
  status: string | null;
  description: string | null;
  color: string | null;
  sort_order: number;
}
interface ContactIns {
  id: number;
  artist_id: number | null;
  project_id: number | null;
  role: string | null;
  name: string | undefined;
  email: string | null;
  phone: string | null;
  notes: string | null;
  sort_order: number;
}
interface EventIns {
  id: number;
  artist_id: number | null;
  project_id: number | null;
  type: string;
  title: string | undefined;
  start_at: string | null;
  end_at: string | null;
  all_day: number;
  location: string | null;
  notes: string | null;
  sort_order: number;
}
interface TaskIns {
  id: number;
  artist_id: number | null;
  project_id: number | null;
  title: string | undefined;
  status: string;
  priority: string;
  due_date: string | null;
  comment: string | null;
  erledigt_am: string | null;
  sort_order: number;
}
interface LinkIns {
  id: number;
  artist_id: number | null;
  project_id: number | null;
  event_id: number | null;
  task_id: number | null;
  label: string | undefined;
  url: string | null;
  sort_order: number;
}

interface SeedData {
  artists: ArtistIns[];
  projects: ProjectIns[];
  contacts: ContactIns[];
  events: EventIns[];
  tasks: TaskIns[];
  links: LinkIns[];
  /** Event types found in the data, absorbed into the editable list after the insert. */
  eventTypes: Set<string>;
}

/**
 * Parse, validate and map every CSV into rows ready to bind. Deliberately runs BEFORE the
 * transaction opens: a malformed cell is reported without the database being touched at all,
 * rather than surfacing as a constraint failure halfway through the insert (SDB-04).
 */
function readSeedData(dir: string): SeedData {
  const nowIso = new Date().toISOString();
  const p: Problems = [];
  const eventTypes = new Set<string>();

  const rawArtists = readCsv(dir, 'artists.csv');
  const rawProjects = readCsv(dir, 'projects.csv');
  const rawContacts = readCsv(dir, 'contacts.csv');
  const rawEvents = readCsv(dir, 'events.csv');
  const rawTasks = readCsv(dir, 'tasks.csv');
  const rawLinks = readCsv(dir, 'links.csv');

  // A CSV set that parses to nothing would replace the database with an empty one and still
  // report "Seed complete" (SDB-03) — an empty import dir is what the sample branch is for.
  const total =
    rawArtists.length + rawProjects.length + rawContacts.length + rawEvents.length + rawTasks.length + rawLinks.length;
  if (total === 0) {
    throw new Error(`The CSVs in ${dir} hold no rows — refusing to replace the database with an empty one.`);
  }

  const artists: ArtistIns[] = rawArtists.map((r, i) => ({
    id: reqId(p, 'artists.csv', i, 'id', r.id),
    name: r.name,
    color: nn(r.color) ?? '#888888',
    notes: nn(r.notes),
    sort_order: i,
  }));

  const projects: ProjectIns[] = rawProjects.map((r, i) => {
    // Legacy CSVs carry description AND notes; the schema keeps one field, so merge.
    const description = nn(r.description);
    const notes = nn(r.notes);
    return {
      id: reqId(p, 'projects.csv', i, 'id', r.id),
      artist_id: reqId(p, 'projects.csv', i, 'artist_id', r.artist_id),
      code: r.code,
      name: r.name,
      status: mapProjectStatus(nn(r.status)),
      description: description && notes ? `${description}\n\n${notes}` : (description ?? notes),
      color: nn(r.color), // NULL => auto-derived shade at render time
      sort_order: i,
    };
  });

  const contacts: ContactIns[] = rawContacts.map((r, i) => ({
    id: reqId(p, 'contacts.csv', i, 'id', r.id),
    artist_id: optId(p, 'contacts.csv', i, 'artist_id', r.artist_id),
    project_id: optId(p, 'contacts.csv', i, 'project_id', r.project_id),
    role: nn(r.role),
    name: r.name,
    email: nn(r.email),
    phone: nn(r.phone),
    notes: nn(r.notes),
    sort_order: i,
  }));

  const events: EventIns[] = rawEvents.map((r, i) => {
    const startRaw = r.start ?? '';
    const endRaw = nn(r.end);
    const allDay = isDateOnly(startRaw) ? 1 : 0;
    const eventType = nn(r.type);
    if (eventType) eventTypes.add(eventType);
    return {
      id: reqId(p, 'events.csv', i, 'id', r.id),
      artist_id: optId(p, 'events.csv', i, 'artist_id', r.artist_id),
      project_id: optId(p, 'events.csv', i, 'project_id', r.project_id),
      type: eventType ?? 'Termin',
      title: r.title,
      start_at: startRaw.trim() === '' ? null : allDay ? startRaw.trim() : toIsoLocal(startRaw), // NULL = "Datum offen" (TBD)
      end_at: endRaw === null ? null : allDay ? endRaw : toIsoLocal(endRaw),
      all_day: allDay,
      location: nn(r.location),
      notes: nn(r.notes),
      sort_order: i,
    };
  });

  const tasks: TaskIns[] = rawTasks.map((r, i) => {
    // Map the legacy CSV status (offen/erledigt) to the New/Active/Done model.
    const rawStatus = nn(r.status) ?? 'offen';
    const status = rawStatus === 'erledigt' ? 'done' : rawStatus === 'offen' ? 'active' : rawStatus;
    // Confirmed decision: completed tasks with no completion date get erledigt_am = seed date.
    const erledigt_am = status === 'done' ? nowIso : null;
    return {
      id: reqId(p, 'tasks.csv', i, 'id', r.id),
      artist_id: optId(p, 'tasks.csv', i, 'artist_id', r.artist_id),
      project_id: optId(p, 'tasks.csv', i, 'project_id', r.project_id),
      title: r.title,
      status,
      priority: nn(r.priority) ?? 'mittel',
      due_date: nn(r.due_date),
      comment: nn(r.comment),
      erledigt_am,
      sort_order: i,
    };
  });

  const links: LinkIns[] = rawLinks.map((r, i) => ({
    id: reqId(p, 'links.csv', i, 'id', r.id),
    artist_id: optId(p, 'links.csv', i, 'artist_id', r.artist_id),
    project_id: optId(p, 'links.csv', i, 'project_id', r.project_id),
    event_id: optId(p, 'links.csv', i, 'event_id', r.event_id),
    task_id: optId(p, 'links.csv', i, 'task_id', r.task_id),
    label: r.label,
    url: nn(r.url), // label-only placeholders keep url = NULL
    sort_order: i,
  }));

  throwProblems(p);
  return { artists, projects, contacts, events, tasks, links, eventTypes };
}

/** Insert pre-validated rows. Must run inside main()'s transaction. */
function insertSeedData(db: Database.Database, data: SeedData): void {
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

  for (const r of data.artists) insArtist.run(r);
  for (const r of data.projects) insProject.run(r);
  for (const r of data.contacts) insContact.run(r);
  for (const r of data.events) insEvent.run(r);
  for (const r of data.tasks) insTask.run(r);
  for (const r of data.links) insLink.run(r);

  // Absorb any event types found in the data (e.g. "Probe") into the editable list as
  // coloured options (WP-I): defaults first, then any novel imported type, deduped by value.
  const LEGACY_EVENT_COLORS: Record<string, string> = {
    Auftritt: '#fef3c7', Termin: '#e2e8f0', Anreise: '#e0f2fe', Deadline: '#fee2e2', Probe: '#ede9fe',
  };
  const FALLBACK_COLORS = ['#fee2e2', '#fef3c7', '#dcfce7', '#e0f2fe', '#ede9fe', '#fce7f3', '#f1f5f9'];
  const byValue = new Map(DEFAULT_EVENT_TYPES.map((o) => [o.value, o]));
  let fi = 0;
  for (const name of data.eventTypes) {
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

/**
 * True when `dir` holds at least one of the files the importer actually reads. Throws when it
 * holds CSVs under other names: falling through to the sample branch there would wipe a real
 * database and replace it with five rows, and taking the CSV branch would empty it outright.
 */
function hasImportCsvs(dir: string): boolean {
  if (!existsSync(dir)) return false;
  const present = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.csv'));
  if (present.some((f) => CSV_FILES.includes(f))) return true;
  if (present.length > 0) {
    throw new Error(
      `${dir} holds CSV files, but none the importer reads (${CSV_FILES.join(', ')}):\n` +
        `  ${present.join('\n  ')}\n` +
        'Rename them or point AUFTAKT_IMPORT_DIR somewhere else — seeding would have replaced the database with nothing.',
    );
  }
  return false;
}

function main(): void {
  const db = getDb();
  const dir = importDir();
  const hasCsv = hasImportCsvs(dir);

  console.log(hasCsv ? `Seeding from CSVs in ${dir}` : `No CSVs found in ${dir} — generating sample data`);

  // Read and validate everything first: a malformed CSV must fail with the database untouched.
  const data = hasCsv ? readSeedData(dir) : null;

  // One transaction over the wipe AND the insert. Anything that throws — a constraint on a
  // malformed row, a dangling FK the deferred check catches at COMMIT — takes the wipe with
  // it, so a failed seed leaves the database exactly as it was instead of empty (SDB-01).
  const seed = db.transaction(() => {
    // PRAGMA foreign_keys is a no-op inside a transaction; defer_foreign_keys is not. It
    // moves every FK check to COMMIT, which is what lets clearTables() drop parents and
    // children together while the rows replacing them are still validated.
    db.pragma('defer_foreign_keys = ON');
    clearTables(db);
    if (data) insertSeedData(db, data);
    else seedSample(db);
    // clearTables wipes custom_columns, so re-create the built-in task columns.
    ensureBuiltinColumns(db);
    // Settings survive clearTables, so re-seeding an existing DB keeps stale defaults.
    // Reset the project-status list to the current default (the label/default migration).
    setSetting(db, 'project_statuses', JSON.stringify(DEFAULT_PROJECT_STATUSES));
  });
  seed();

  console.log('\nSeed complete. Row counts:');
  for (const t of ['artists', 'projects', 'contacts', 'events', 'tasks', 'links']) {
    console.log(`  ${t.padEnd(10)} ${count(db, t)}`);
  }
  console.log(`\n  Saison             ${getSetting(db, 'saison')}`);
  console.log(`  event_types        ${getSetting(db, 'event_types')}`);
  console.log(`  project_statuses   ${getSetting(db, 'project_statuses')}`);
}

try {
  main();
} catch (err) {
  // The wipe and the insert share one transaction, so a failure here rolled both back —
  // say so, and print the reason rather than a stack trace.
  console.error(`\nSeed failed — the database was left unchanged.\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
