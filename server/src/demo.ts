/**
 * Builds a disposable demo database with invented data.
 *
 * Why this exists alongside seed.ts: the CSV importer cannot express subtasks
 * (`parent_id` is absent from its INSERT), per-task colors, or `custom_values`, so a CSV
 * fixture set cannot exercise the features that most need eyeballing. This writes rows
 * directly instead, and covers every edge the UI has a branch for — see the sections below.
 *
 * Dates are relative to today, so due dates stay meaningful and the archive cutoff keeps
 * working however long from now this runs.
 */
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Pin the data dir before the first getDb() call, which caches its connection. Defaulting it
 * here rather than in the npm script is what makes this script incapable of touching the real
 * database in `.data/` — unlike `npm run seed`, which clears whatever is active.
 *
 * Safe as a plain statement despite ESM hoisting: db.ts reads AUFTAKT_DATA_DIR inside
 * dataDir(), never at import time.
 */
const DEMO_DIR = process.env.AUFTAKT_DATA_DIR?.trim() || resolve(here, '../../.demo');
process.env.AUFTAKT_DATA_DIR = DEMO_DIR;

const { getDb, setSetting, getSetting, setActiveSeasonLabel, ARCHIVE_AFTER_DAYS } =
  await import('./db');

/** Distinct from the real data's default so the season chip never reads "Festival 2026". */
const SEASON_LABEL = 'Demofest 2026';

/* ---------- relative dates ---------- */

const DAY_MS = 86_400_000;

/** Date `n` days from today as `YYYY-MM-DD` (negative = past). */
function days(n: number): string {
  return new Date(Date.now() + n * DAY_MS).toISOString().slice(0, 10);
}

/** `YYYY-MM-DDTHH:MM` — the app's naive-local format for a timed event. */
function at(n: number, time: string): string {
  return `${days(n)}T${time}`;
}

/**
 * `YYYY-MM-DD HH:MM:SS` — SQLite's `datetime()` format. Used for erledigt_am and deleted_at
 * because both are compared against `datetime('now', ...)` as strings (queries.ts:27,
 * db.ts:639); an ISO string with its `T` separator would sort inconsistently against those.
 */
function stamp(n: number): string {
  return new Date(Date.now() + n * DAY_MS).toISOString().slice(0, 19).replace('T', ' ');
}

/** Comfortably past the archive cutoff, so `#/archiv` is never empty. */
const ARCHIVED = -(ARCHIVE_AFTER_DAYS + 15);

/* ---------- the dataset ---------- */

// A ~one-page project description exercising every rich-text construct (WP-Q): headings,
// bold, legacy <u>, nested bullet+ordered lists (3-space indent, the unit the renderer nests),
// a link, a GFM table, a blockquote and emoji. Its purpose is to eyeball the WYSIWYG editor
// and its Markdown round-trip in `npm run demo`.
const RICH_DESCRIPTION = `# Eröffnungskonzert

Das **Eröffnungskonzert** eröffnet das Festival im großen Saal — der wichtigste Abend der ersten Woche 🎉.

## Ablauf

- 14:00 — Soundcheck
- 19:00 — Einlass
   1. VIP-Gäste zuerst
   2. dann Abendkasse
- 20:00 — Beginn

## Technik

Die Bühne braucht <u>zwingend</u> zwei Monitore. Kontakt über [die Technik-Seite](https://festival.example.com/technik).

| Position | Person |
| --- | --- |
| Licht | Anna |
| Ton | Ben |

> Aufbau nur mit Helm 🎧`;

// Appended to RICH_DESCRIPTION below — the shape migrateProjectsMergeNotes() leaves behind
// when a pre-merge project had both text fields filled.
const RICH_PROJECT_NOTES = `**Bestätigt:** Termin, Saal und Honorar stehen. Rider liegt vor — Details im [Ordner](https://example.com/rider).`;

const RICH_ARTIST_NOTES = `Streichquartett, <u>Residenz</u> über das ganze Festival. Reisen gemeinsam an 🚐.

- Bevorzugt vegetarisches Catering
- Braucht Stimmzimmer ab Mittag`;

const RICH_EVENT_NOTES = `Doors 19:00, Beginn **19:30**. Zugabe ist abgesprochen 🎻.`;

const ARTISTS = [
  { id: 1, name: 'Nordlicht Quartett', color: '#3b82f6', notes: RICH_ARTIST_NOTES },
  { id: 2, name: 'Ana Belém Trio', color: '#ec4899', notes: 'Anreise aus Lissabon — Visa früh klären.' },
  { id: 3, name: 'Kollektiv Halbton', color: '#10b981', notes: null },
  { id: 4, name: 'Jonas Wehrmann', color: '#f59e0b', notes: 'Solopianist, spielt auch den Meisterkurs.' },
];

const PROJECTS = [
  { id: 1, artist_id: 1, code: 'NQ1', name: 'Eröffnungskonzert', status: 'In Progress', description: `${RICH_DESCRIPTION}\n\n${RICH_PROJECT_NOTES}` },
  // The only project with an explicit colour — deliberately off its artist's blue, so the
  // "explicitly set" and "inherits a shade" states of the colour field are both eyeballable.
  { id: 2, artist_id: 1, code: 'NQ2', name: 'Schulworkshop', status: 'Not Started', description: 'Vormittagsformat für zwei Schulklassen.', color: '#8b5cf6' },
  { id: 3, artist_id: 2, code: 'AB1', name: 'Hauptkonzert', status: 'In Progress', description: null },
  { id: 4, artist_id: 2, code: 'AB2', name: 'Radio-Session', status: 'In Progress', description: 'Mitschnitt für den Kultursender.' },
  { id: 5, artist_id: 3, code: 'KH1', name: 'Klanginstallation', status: 'In Progress', description: 'Läuft durchgehend im Foyer.' },
  { id: 6, artist_id: 3, code: 'KH2', name: 'Late-Night-Set', status: 'Not Started', description: null },
  { id: 7, artist_id: 4, code: 'JW1', name: 'Solo-Rezital', status: 'Done', description: 'Programm steht, Werbung läuft.' },
  { id: 8, artist_id: 4, code: 'JW2', name: 'Meisterkurs', status: 'In Progress', description: 'Drei Tage, zwölf Teilnehmende.' },
  // Soft-deleted (in the trash) — its live child task 52 makes the cascade count demonstrable.
  { id: 9, artist_id: 4, code: 'JW3', name: 'Gestrichenes Nebenkonzert', status: 'Not Started', description: null, deleted_at: stamp(-4) },
];

const CONTACTS = [
  // Two with notes (one rich, one plain), the rest without — the inline contact text
  // field needs both the filled and the hover-only-placeholder branch on screen.
  { id: 1, artist_id: null, project_id: 1, role: 'Management', name: 'Merle Dahlke', email: 'merle.dahlke@example.org', phone: '+49 151 0000001', notes: 'Erreichbar **vormittags**, sonst per [Mail](mailto:merle.dahlke@example.org).' },
  { id: 2, artist_id: 1, project_id: null, role: 'Tourmanagement', name: 'Piet Aalders', email: 'piet@example.org', phone: null, notes: 'Regelt auch die Backline.' },
  { id: 3, artist_id: null, project_id: 3, role: 'Booking', name: 'Rosa Enríquez', email: 'rosa@example.org', phone: '+351 900 000 000' },
  { id: 4, artist_id: 3, project_id: null, role: 'Label', name: 'Halbton Records', email: 'kontakt@example.org', phone: null },
  { id: 5, artist_id: null, project_id: 7, role: 'Agentur', name: 'Ines Kubowski', email: 'ines@example.org', phone: '+49 151 0000002' },
  // Soft-deleted contact — a leaf in the trash (nothing references it).
  { id: 6, artist_id: 1, project_id: null, role: 'Fahrer', name: 'Ehemaliger Fahrer', email: null, phone: null, deleted_at: stamp(-5) },
];

/** Mix of all-day (date-only start) and timed rows — the UI renders them differently. */
const EVENTS = [
  { id: 1, artist_id: null, project_id: 1, type: 'Auftritt', title: 'Eröffnungskonzert', start_at: at(14, '19:30'), end_at: at(14, '21:15'), all_day: 0, location: 'Großer Saal', notes: RICH_EVENT_NOTES },
  { id: 2, artist_id: null, project_id: 1, type: 'Deadline', title: 'Programmtext-Abgabe', start_at: days(4), end_at: null, all_day: 1, location: null },
  { id: 3, artist_id: null, project_id: 3, type: 'Auftritt', title: 'Hauptkonzert Ana Belém Trio', start_at: at(16, '20:00'), end_at: at(16, '22:00'), all_day: 0, location: 'Kammermusiksaal' },
  { id: 4, artist_id: 2, project_id: null, type: 'Anreise', title: 'Anreise aus Lissabon', start_at: days(15), end_at: null, all_day: 1, location: 'Flughafen' },
  { id: 5, artist_id: null, project_id: 5, type: 'Termin', title: 'Aufbau Klanginstallation', start_at: days(10), end_at: days(12), all_day: 1, location: 'Foyer' },
  { id: 6, artist_id: null, project_id: 7, type: 'Auftritt', title: 'Solo-Rezital', start_at: at(-9, '19:00'), end_at: at(-9, '20:30'), all_day: 0, location: 'Großer Saal' },
  { id: 7, artist_id: null, project_id: 8, type: 'Termin', title: 'Meisterkurs Tag 1', start_at: days(21), end_at: null, all_day: 1, location: 'Probenraum 2' },
  // start_at NULL = "Datum offen" (TBD) — renders as its own block above the dated events.
  { id: 8, artist_id: null, project_id: 7, type: 'Termin', title: 'Nachholtermin Solo-Rezital', start_at: null, end_at: null, all_day: 0, location: null },
  // Soft-deleted event — a leaf in the trash.
  { id: 9, artist_id: null, project_id: 3, type: 'Termin', title: 'Abgesagter Soundcheck', start_at: days(9), end_at: null, all_day: 1, location: null, deleted_at: stamp(-8) },
];

interface DemoTask {
  id: number;
  artist_id?: number | null;
  project_id?: number | null;
  parent_id?: number | null;
  title: string;
  status?: string;
  priority?: string;
  due_date?: string | null;
  comment?: string | null;
  color?: string | null;
  erledigt_am?: string | null;
  deleted_at?: string | null;
}

/**
 * Task fixtures, grouped by the UI state each block is here to produce. Ids are explicit so
 * `parent_id` references stay stable across edits.
 */
const TASKS: DemoTask[] = [
  // Subtask tree: a plain parent with a coloured child and a recently-done child.
  { id: 1, project_id: 1, title: 'Instrumente – Anmietung und Transport', status: 'active', priority: 'hoch', due_date: days(12) },
  { id: 2, project_id: 1, parent_id: 1, title: 'Anmietung Schlagzeug klären', status: 'active' },
  { id: 3, project_id: 1, parent_id: 1, title: 'Transporter buchen', status: 'active', color: '#f59e0b' },
  { id: 4, project_id: 1, parent_id: 1, title: 'Rückgabe nach dem Konzert planen', status: 'done', erledigt_am: stamp(-3) },
  { id: 5, project_id: 1, title: 'Bühnenplan an Technik schicken', status: 'active', priority: 'hoch', due_date: days(5), comment: 'Siehe Rider, Abschnitt **3.2** — Monitorwege.' },
  { id: 6, project_id: 1, title: 'Backline-Liste final abgleichen', status: 'new', priority: 'niedrig' },

  // Coloured parent: the group rail picks up the parent's colour.
  { id: 7, project_id: 3, title: 'Hotelzimmer buchen', status: 'active', priority: 'hoch', due_date: days(9), color: '#3b82f6' },
  { id: 8, project_id: 3, parent_id: 7, title: 'Doppelzimmer bestätigen', status: 'active' },
  { id: 9, project_id: 3, parent_id: 7, title: 'Anreise mit Management abstimmen', status: 'new' },
  { id: 10, project_id: 3, title: 'Setlist final freigeben', status: 'active', due_date: days(15) },

  // Orphan: parent is soft-deleted, so the child must render flat with no connector.
  // deleted_at stays recent — purgeExpired() hard-deletes past PURGE_AFTER_DAYS and
  // tasks.parent_id is a real FK.
  { id: 11, project_id: 5, title: 'Gelöschter Elterntask', status: 'active', deleted_at: stamp(-2) },
  { id: 12, project_id: 5, parent_id: 11, title: 'Verwaiste Unteraufgabe', status: 'active' },

  { id: 13, project_id: 5, title: 'Sensorik im Foyer testen', status: 'active', priority: 'hoch', due_date: days(3) },
  { id: 14, project_id: 6, title: 'Lichtkonzept abstimmen', status: 'new', priority: 'niedrig' },
  { id: 15, project_id: 6, title: 'Übergabe an DJ-Set klären', status: 'active' },

  // Artist-level todos (no project) — these render the "Allgemein" chip.
  { id: 16, artist_id: 1, title: 'Pressefotos anfordern', status: 'active', due_date: days(20) },
  { id: 17, artist_id: 2, title: 'Vertrag gegenzeichnen', status: 'active', priority: 'hoch', due_date: days(2) },
  { id: 18, artist_id: 2, parent_id: 17, title: 'Scan an Buchhaltung', status: 'new' },
  { id: 19, artist_id: 4, title: 'Reisekostenformular schicken', status: 'new', priority: 'niedrig' },

  // Season-wide todos: neither artist nor project — the violet "Festival" chip.
  { id: 20, title: 'Programmheft in den Druck geben', status: 'active', priority: 'hoch', due_date: days(7) },
  { id: 21, title: 'Akkreditierungen an Presse versenden', status: 'active', due_date: days(11) },
  { id: 22, parent_id: 20, title: 'Korrekturlauf Programmheft', status: 'active' },
  { id: 23, title: 'Helfer-Briefing terminieren', status: 'new', priority: 'niedrig' },

  // Archived: done longer ago than ARCHIVE_AFTER_DAYS, so they leave the live views.
  { id: 24, project_id: 1, title: 'Probenraum gebucht', status: 'done', erledigt_am: stamp(ARCHIVED) },
  { id: 25, project_id: 3, title: 'Technikrider geprüft', status: 'done', erledigt_am: stamp(ARCHIVED - 7) },
  { id: 26, artist_id: 3, title: 'Vorvertrag unterschrieben', status: 'done', erledigt_am: stamp(ARCHIVED - 3) },
  { id: 27, title: 'Save-the-Date verschickt', status: 'done', erledigt_am: stamp(ARCHIVED - 16) },

  // Recently done: struck through but still in the live list.
  { id: 28, project_id: 7, title: 'Flügel stimmen lassen', status: 'done', erledigt_am: stamp(-1) },
  { id: 29, project_id: 7, title: 'Programmtext eingereicht', status: 'done', erledigt_am: stamp(-6) },

  { id: 30, project_id: 7, title: 'Saalbestuhlung klären', status: 'active', due_date: days(18) },
  { id: 31, project_id: 8, title: 'Teilnehmerliste finalisieren', status: 'active', priority: 'hoch', due_date: days(4) },
  { id: 32, project_id: 8, title: 'Räume für Meisterkurs buchen', status: 'active', due_date: days(8) },
  { id: 33, project_id: 8, parent_id: 32, title: 'Zweitraum als Fallback anfragen', status: 'new', priority: 'niedrig' },
  { id: 34, project_id: 2, title: 'Schulen kontaktieren', status: 'active', due_date: days(25) },
  { id: 35, project_id: 2, title: 'Material für Workshop drucken', status: 'new', priority: 'niedrig' },
  { id: 36, project_id: 4, title: 'Studiotermin bestätigen', status: 'active', priority: 'hoch', due_date: days(6) },
  { id: 37, project_id: 4, parent_id: 36, title: 'Techniker anfragen', status: 'active' },
  { id: 38, project_id: 4, parent_id: 36, title: 'Backup-Termin halten', status: 'new', priority: 'niedrig', color: '#a855f7' },
  { id: 39, project_id: 6, title: 'Getränke für die Crew organisieren', status: 'new', priority: 'niedrig' },
  { id: 40, project_id: 2, title: 'Feedbackbogen entwerfen', status: 'new', priority: 'niedrig' },

  // Manual drag order: one block of same-rank siblings (identical status, priority and a null
  // due date), so every automatic rule ties and only sort_order separates them — the only
  // arrangement in which a row is draggable. The parent below repeats it one level down, and
  // task 45 is the odd rank that must refuse every drop in the block.
  { id: 41, project_id: 5, title: 'Requisiten sichten', status: 'new', priority: 'mittel' },
  { id: 42, project_id: 5, title: 'Kostüme aussortieren', status: 'new', priority: 'mittel' },
  { id: 43, project_id: 5, title: 'Werkstatt aufräumen', status: 'new', priority: 'mittel' },
  { id: 44, project_id: 5, title: 'Bestandsliste ergänzen', status: 'new', priority: 'mittel' },
  { id: 45, project_id: 5, title: 'Versicherung prüfen (andere Rangstufe)', status: 'new', priority: 'hoch' },
  { id: 46, project_id: 5, parent_id: 41, title: 'Fundus Halle A', status: 'new', priority: 'mittel' },
  { id: 47, project_id: 5, parent_id: 41, title: 'Fundus Halle B', status: 'new', priority: 'mittel' },
  { id: 48, project_id: 5, parent_id: 41, title: 'Fundus Aussenlager', status: 'new', priority: 'mittel' },

  // Overdue and due-tomorrow, on artist 1 (project NQ1 + one general todo): without these every
  // demo due date is in the future, so the „Überfällig" metric and the „Braucht Aufmerksamkeit"
  // list would have nothing to show.
  { id: 49, project_id: 1, title: 'Werbematerial finalisieren', status: 'active', priority: 'hoch', due_date: days(-4) },
  { id: 50, project_id: 1, title: 'Pressemitteilung freigeben', status: 'active', due_date: days(1) },
  { id: 51, artist_id: 1, title: 'Rider an Veranstalter schicken', status: 'active', priority: 'hoch', due_date: days(-1) },

  // Live task under a soft-deleted project (id 9) — purging that project cascades this away.
  { id: 52, project_id: 9, title: 'Aufgabe im gestrichenen Projekt', status: 'active' },
];

/** Colored link categories (WP-P) — the "Dokumente & Links" lists group by these. */
const LINK_CATEGORIES = [
  { value: 'vertrag', label: 'Vertrag', color: '#fee2e2' },
  { value: 'technik', label: 'Technik', color: '#dbeafe' },
  { value: 'presse', label: 'Presse', color: '#dcfce7' },
];

/**
 * One row per link parent type, so all four branches of the links CHECK are covered.
 * Project 1 spans two categories plus an uncategorized link, so the grouped rendering
 * (incl. "Ohne Kategorie" last) is eyeballable on one page.
 */
const LINKS = [
  { id: 1, artist_id: null, project_id: 1, event_id: null, task_id: null, label: 'Technikrider (PDF)', url: 'https://example.org/rider.pdf', category: 'technik' },
  { id: 2, artist_id: 2, project_id: null, event_id: null, task_id: null, label: 'Künstlerwebsite', url: 'https://example.org/ana-belem' },
  { id: 3, artist_id: null, project_id: null, event_id: 1, task_id: null, label: 'Saalplan', url: 'https://example.org/saalplan' },
  { id: 4, artist_id: null, project_id: null, event_id: null, task_id: 20, label: 'Druckerei-Angebot', url: 'https://example.org/angebot' },
  // Soft-deleted document — a leaf in the trash.
  { id: 5, artist_id: null, project_id: 2, event_id: null, task_id: null, label: 'Veraltetes Angebot', url: 'https://example.org/alt-angebot', deleted_at: stamp(-1) },
  { id: 6, artist_id: null, project_id: 1, event_id: null, task_id: null, label: 'Vertrag (unterschrieben)', url: 'https://example.org/vertrag.pdf', category: 'vertrag' },
  { id: 7, artist_id: null, project_id: 1, event_id: null, task_id: null, label: 'Bühnenplan', url: 'https://example.org/buehnenplan', category: 'technik' },
  { id: 8, artist_id: null, project_id: 1, event_id: null, task_id: null, label: 'Sonstiges Dokument', url: null },
];

/** Custom task columns — the only way to exercise the data-driven task table. */
const CUSTOM_COLUMNS = [
  {
    name: 'Bereich',
    type: 'select',
    icon: '🏷',
    options: JSON.stringify([
      { value: 'technik', label: 'Technik', color: '#dbeafe' },
      { value: 'logistik', label: 'Logistik', color: '#fef3c7' },
      { value: 'kommunikation', label: 'Kommunikation', color: '#dcfce7' },
    ]),
  },
  { name: 'Bestätigt', type: 'checkbox', icon: '✓', options: null },
];

/** taskId → [Bereich, Bestätigt]. Left sparse on purpose so empty cells show too. */
const CUSTOM_VALUES: Record<number, [string | null, boolean | null]> = {
  1: ['logistik', false],
  3: ['logistik', true],
  5: ['technik', true],
  7: ['logistik', false],
  10: ['kommunikation', null],
  13: ['technik', false],
  20: ['kommunikation', true],
  21: ['kommunikation', false],
  31: [null, true],
  36: ['technik', false],
};

/* ---------- insert ---------- */

function main(): void {
  // Clean slate. Dropping the directory is simpler than replicating seed.ts's clearTables(),
  // and getDb() rebuilds schema, defaults, migrations and seasons.json from nothing.
  rmSync(DEMO_DIR, { recursive: true, force: true });
  const db = getDb();

  const insArtist = db.prepare(
    `INSERT INTO artists (id, name, color, notes, sort_order) VALUES (@id, @name, @color, @notes, @sort_order)`,
  );
  const insProject = db.prepare(
    `INSERT INTO projects (id, artist_id, code, name, status, description, color, deleted_at, sort_order)
     VALUES (@id, @artist_id, @code, @name, @status, @description, @color, @deleted_at, @sort_order)`,
  );
  const insContact = db.prepare(
    `INSERT INTO contacts (id, artist_id, project_id, role, name, email, phone, notes, deleted_at, sort_order)
     VALUES (@id, @artist_id, @project_id, @role, @name, @email, @phone, @notes, @deleted_at, @sort_order)`,
  );
  const insEvent = db.prepare(
    `INSERT INTO events (id, artist_id, project_id, type, title, start_at, end_at, all_day, location, notes, deleted_at, sort_order)
     VALUES (@id, @artist_id, @project_id, @type, @title, @start_at, @end_at, @all_day, @location, @notes, @deleted_at, @sort_order)`,
  );
  const insTask = db.prepare(
    `INSERT INTO tasks (id, artist_id, project_id, parent_id, title, status, priority, due_date,
                        comment, color, custom_values, erledigt_am, deleted_at, sort_order)
     VALUES (@id, @artist_id, @project_id, @parent_id, @title, @status, @priority, @due_date,
             @comment, @color, @custom_values, @erledigt_am, @deleted_at, @sort_order)`,
  );
  const insLink = db.prepare(
    `INSERT INTO links (id, artist_id, project_id, event_id, task_id, label, url, category, deleted_at, sort_order)
     VALUES (@id, @artist_id, @project_id, @event_id, @task_id, @label, @url, @category, @deleted_at, @sort_order)`,
  );
  const insColumn = db.prepare(
    `INSERT INTO custom_columns (name, type, scope, project_id, options, icon, kind, enabled, deletable, sort_order)
     VALUES (@name, @type, 'global', NULL, @options, @icon, 'custom', 1, 1, @sort_order)`,
  );

  const tx = db.transaction(() => {
    ARTISTS.forEach((a, i) => insArtist.run({ ...a, sort_order: i }));
    PROJECTS.forEach((p, i) => insProject.run({ color: null, deleted_at: null, ...p, sort_order: i }));
    CONTACTS.forEach((c, i) => insContact.run({ notes: null, deleted_at: null, ...c, sort_order: i }));
    EVENTS.forEach((e, i) => insEvent.run({ notes: null, deleted_at: null, ...e, sort_order: i }));

    // Custom columns first: their generated ids are the keys inside tasks.custom_values.
    const colIds = CUSTOM_COLUMNS.map(
      (c, i) => Number(insColumn.run({ ...c, sort_order: 100 + i }).lastInsertRowid),
    );

    TASKS.forEach((t, i) => {
      const [bereich, bestaetigt] = CUSTOM_VALUES[t.id] ?? [null, null];
      const cv: Record<string, unknown> = {};
      if (bereich !== null) cv[String(colIds[0])] = bereich;
      if (bestaetigt !== null) cv[String(colIds[1])] = bestaetigt;
      insTask.run({
        artist_id: null,
        project_id: null,
        parent_id: null,
        status: 'active',
        priority: 'mittel',
        due_date: null,
        comment: null,
        color: null,
        erledigt_am: null,
        deleted_at: null,
        ...t,
        custom_values: JSON.stringify(cv),
        sort_order: i,
      });
    });

    LINKS.forEach((l, i) => insLink.run({ category: null, deleted_at: null, ...l, sort_order: i }));
  });
  tx();

  // The season switcher reads the registry label in seasons.json, not the `saison` setting,
  // so both have to be set or the chip still says "Festival 2026".
  setSetting(db, 'saison', SEASON_LABEL);
  setActiveSeasonLabel(SEASON_LABEL);
  setSetting(db, 'link_categories', JSON.stringify(LINK_CATEGORIES));

  console.log(`Demo-Datenbank neu gebaut in ${DEMO_DIR}`);
  console.log('\nRow counts:');
  for (const t of ['artists', 'projects', 'contacts', 'events', 'tasks', 'links', 'custom_columns']) {
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    console.log(`  ${t.padEnd(15)} ${n}`);
  }
  console.log(`\n  Saison          ${getSetting(db, 'saison')}`);
}

main();
