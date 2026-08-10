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
// Safe as a static import despite the deferred ./db import below: shared/time has no
// side effects and reads no environment.
import { localDay, localStamp } from '../../shared/time';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Pin the data dir before the first getDb() call, which caches its connection. Hardcoding it
 * here rather than reading the npm script's environment is what makes this script incapable of
 * touching the real database in `.data/` — unlike `npm run seed`, which clears whatever is
 * active.
 *
 * Deliberately NOT overridable by an inherited AUFTAKT_DATA_DIR: main() starts with
 * `rmSync(DEMO_DIR, { recursive: true })`, so honouring an exported value would delete whatever
 * real data directory happened to be in the environment — every season file and seasons.json.
 *
 * Safe as a plain statement despite ESM hoisting: db.ts reads AUFTAKT_DATA_DIR inside
 * dataDir(), never at import time.
 */
const DEMO_DIR = resolve(here, '../../.demo');
process.env.AUFTAKT_DATA_DIR = DEMO_DIR;

const {
  getDb,
  setSetting,
  getSetting,
  setActiveSeasonLabel,
  createSeason,
  copySeasonData,
  updateSeason,
  patchLanding,
  ARCHIVE_AFTER_DAYS,
} = await import('./db');

/** Distinct from the real data's default so the season chip never reads "Festival 2026". */
const SEASON_LABEL = 'Demofest 2026';

/* ---------- relative dates ---------- */

const DAY_MS = 86_400_000;

/**
 * Date `n` days from today as `YYYY-MM-DD` (negative = past), on the **local** calendar.
 *
 * `toISOString()` would anchor it on the UTC day, and the client's `daysUntil()` anchors
 * "today" on the local one — so east of Greenwich, rebuilding the demo between local midnight
 * and the offset shifted every relative date back a day: the "due tomorrow" fixture showed as
 * due today and the „Überfällig" counts the demo exists to showcase were off by one (SDB-08).
 */
function days(n: number): string {
  return localDay(new Date(Date.now() + n * DAY_MS));
}

/** `YYYY-MM-DDTHH:MM` — the app's naive-local format for a timed event. */
function at(n: number, time: string): string {
  return `${days(n)}T${time}`;
}

/**
 * `YYYY-MM-DD HH:MM:SS` — SQLite's `datetime()` format, local like everything else
 * (shared/time.ts). Used for erledigt_am and deleted_at because both are compared against
 * `datetime('now', 'localtime', …)` as strings; an ISO string with its `T` separator would
 * sort inconsistently against those.
 */
function stamp(n: number): string {
  return localStamp(new Date(Date.now() + n * DAY_MS));
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

/**
 * A per-entity section arrangement (WP-25). Only artist 2 and project 3 carry one; everyone else
 * stays `NULL` and follows the `artist_layout`/`project_layout` template, so the two states — and
 * the fact that arranging one artist leaves the others alone — are both on screen. Artist 2 also
 * un-hides `stats`, which both entity pages ship as `defaultHidden`.
 */
const ARTIST_2_LAYOUT = JSON.stringify([
  { key: 'kontakte', width: 'half' },
  { key: 'stats', width: 'half' },
  { key: 'termine', width: 'full' },
  { key: 'projekte', width: 'full' },
  { key: 'aufgaben', width: 'full' },
]);

const PROJECT_3_LAYOUT = JSON.stringify([
  { key: 'aufgaben', width: 'full' },
  { key: 'termine', width: 'half' },
  { key: 'kontakte', width: 'half' },
]);

const ARTISTS = [
  { id: 1, name: 'Nordlicht Quartett', color: '#3b82f6', notes: RICH_ARTIST_NOTES },
  { id: 2, name: 'Ana Belém Trio', color: '#ec4899', notes: 'Anreise aus Lissabon — Visa früh klären.', layout: ARTIST_2_LAYOUT },
  { id: 3, name: 'Kollektiv Halbton', color: '#10b981', notes: null },
  { id: 4, name: 'Jonas Wehrmann', color: '#f59e0b', notes: 'Solopianist, spielt auch den Meisterkurs.' },
];

const PROJECTS = [
  { id: 1, artist_id: 1, code: 'NQ1', name: 'Eröffnungskonzert', status: 'In Progress', description: `${RICH_DESCRIPTION}\n\n${RICH_PROJECT_NOTES}` },
  // The only project with an explicit colour — deliberately off its artist's blue, so the
  // "explicitly set" and "inherits a shade" states of the colour field are both eyeballable.
  { id: 2, artist_id: 1, code: 'NQ2', name: 'Schulworkshop', status: 'Not Started', description: 'Vormittagsformat für zwei Schulklassen.', color: '#8b5cf6' },
  { id: 3, artist_id: 2, code: 'AB1', name: 'Hauptkonzert', status: 'In Progress', description: null, layout: PROJECT_3_LAYOUT },
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
  // Crosses midnight: the shape the event dialog *derives* (23:00–01:00 with no end date typed)
  // and the one `withStartDate` has to keep overnight when the event is moved (WP-40).
  { id: 10, artist_id: null, project_id: 1, type: 'Auftritt', title: 'Aftershow-Set', start_at: at(14, '23:00'), end_at: at(15, '01:00'), all_day: 0, location: 'Club' },
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
  // The pair survives indefinitely: once the parent crosses PURGE_AFTER_DAYS, purgeExpired()
  // skips it precisely because this live child still references it (SDL-01). Only the archive
  // page's "Endgültig löschen" — which counts and warns first — takes both.
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

  // Live task under a soft-deleted project (id 9): the startup purge leaves both alone, and
  // the live task lists drop it because its owning project is in the trash (SDL-01, SDL-03).
  { id: 52, project_id: 9, title: 'Aufgabe im gestrichenen Projekt', status: 'active' },

  // Archived child under a live parent (task 1): absent from the live table, but the move
  // dialog collects the tree via scope 'all' — its „mitverschoben" count must include it.
  { id: 53, project_id: 1, parent_id: 1, title: 'Angebot Backline eingeholt', status: 'done', erledigt_am: stamp(ARCHIVED) },
];

/**
 * Custom widget sections (WP-S): one text and one links widget per surface — dashboard
 * (both parents NULL), artist 1 and project 1 — plus a soft-deleted one whose live link
 * exercises the trash cascade count and the purge guard that skips it.
 */
const CUSTOM_SECTIONS = [
  { id: 1, artist_id: null, project_id: null, name: 'Saison-Motto', type: 'text', value: 'Diese Saison steht unter dem Motto **„Klang & Raum“** 🎶.' },
  { id: 2, artist_id: null, project_id: null, name: 'Wichtige Dokumente', type: 'links', value: null },
  { id: 3, artist_id: 1, project_id: null, name: 'Reiseplanung', type: 'text', value: 'Anreise gemeinsam im Nightliner — Details im [Tourplan](https://example.org/tourplan).\n\n- Abfahrt 08:00\n- Ankunft ca. 14:30' },
  { id: 4, artist_id: null, project_id: 1, name: 'Werbematerial', type: 'links', value: null },
  // Soft-deleted widget — its live link 11 makes the "Bereich" trash row's cascade count visible.
  { id: 5, artist_id: null, project_id: 1, name: 'Alte Sammlung', type: 'links', value: null, deleted_at: stamp(-6) },
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
 * (incl. "Ohne Kategorie" last) is eyeballable on one page. Its "Technik" group holds two
 * rows on purpose — one group with a single row can't show the drag-reorder (WP-26) — and
 * `notes` is set on some rows and left null on others, which are two different renderings:
 * the description, or the hover-only „+ hinzufügen" placeholder.
 */
const LINKS = [
  { id: 1, artist_id: null, project_id: 1, event_id: null, task_id: null, label: 'Technikrider (PDF)', url: 'https://example.org/rider.pdf', category: 'technik', notes: 'Stand März — gilt nur für die Quartettbesetzung.' },
  { id: 2, artist_id: 2, project_id: null, event_id: null, task_id: null, label: 'Künstlerwebsite', url: 'https://example.org/ana-belem' },
  { id: 3, artist_id: null, project_id: null, event_id: 1, task_id: null, label: 'Saalplan', url: 'https://example.org/saalplan' },
  { id: 4, artist_id: null, project_id: null, event_id: null, task_id: 20, label: 'Druckerei-Angebot', url: 'https://example.org/angebot' },
  // Soft-deleted document — a leaf in the trash.
  { id: 5, artist_id: null, project_id: 2, event_id: null, task_id: null, label: 'Veraltetes Angebot', url: 'https://example.org/alt-angebot', deleted_at: stamp(-1) },
  { id: 6, artist_id: null, project_id: 1, event_id: null, task_id: null, label: 'Vertrag (unterschrieben)', url: 'https://example.org/vertrag.pdf', category: 'vertrag' },
  { id: 7, artist_id: null, project_id: 1, event_id: null, task_id: null, label: 'Bühnenplan', url: 'https://example.org/buehnenplan', category: 'technik' },
  { id: 8, artist_id: null, project_id: 1, event_id: null, task_id: null, label: 'Sonstiges Dokument', url: null, notes: 'Noch **unsortiert** — Kategorie fehlt.' },
  // Links inside custom widgets (section_id as the fifth exclusive parent, WP-S).
  { id: 9, section_id: 2, label: 'Festival-Handbuch', url: 'https://example.org/handbuch.pdf', category: 'presse', notes: 'Für alle Beteiligten, bitte vor dem ersten Tag lesen.' },
  { id: 10, section_id: 2, label: 'Lageplan Gelände', url: 'https://example.org/lageplan' },
  { id: 11, section_id: 4, label: 'Plakatmotiv (Druckdaten)', url: 'https://example.org/plakat.pdf', category: 'presse' },
  // Live link under the soft-deleted widget 5 — invisible in the app, counted in its trash row.
  { id: 12, section_id: 5, label: 'Verwaistes Dokument', url: 'https://example.org/verwaist' },
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

/**
 * taskId → value per custom column, keyed by the column *name* in CUSTOM_COLUMNS. Left sparse
 * on purpose so empty cells show too — an omitted key is an empty cell. Keyed rather than
 * positional because a fixed [Bereich, Bestätigt] tuple silently wrote the select value into
 * the checkbox column and vice versa as soon as CUSTOM_COLUMNS was reordered (SDB-12).
 */
const CUSTOM_VALUES: Record<number, Partial<Record<'Bereich' | 'Bestätigt', string | boolean>>> = {
  1: { Bereich: 'logistik', Bestätigt: false },
  3: { Bereich: 'logistik', Bestätigt: true },
  5: { Bereich: 'technik', Bestätigt: true },
  7: { Bereich: 'logistik', Bestätigt: false },
  10: { Bereich: 'kommunikation' },
  13: { Bereich: 'technik', Bestätigt: false },
  20: { Bereich: 'kommunikation', Bestätigt: true },
  21: { Bereich: 'kommunikation', Bestätigt: false },
  31: { Bestätigt: true },
  36: { Bereich: 'technik', Bestätigt: false },
};

/* ---------- insert ---------- */

function main(): void {
  // Clean slate. Dropping the directory is simpler than replicating seed.ts's clearTables(),
  // and getDb() rebuilds schema, defaults, migrations and seasons.json from nothing.
  rmSync(DEMO_DIR, { recursive: true, force: true });
  const db = getDb();

  const insArtist = db.prepare(
    `INSERT INTO artists (id, name, color, notes, layout, sort_order)
     VALUES (@id, @name, @color, @notes, @layout, @sort_order)`,
  );
  const insProject = db.prepare(
    `INSERT INTO projects (id, artist_id, code, name, status, description, color, layout, deleted_at, sort_order)
     VALUES (@id, @artist_id, @code, @name, @status, @description, @color, @layout, @deleted_at, @sort_order)`,
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
    `INSERT INTO links (id, artist_id, project_id, event_id, task_id, section_id, label, url, category, notes, deleted_at, sort_order)
     VALUES (@id, @artist_id, @project_id, @event_id, @task_id, @section_id, @label, @url, @category, @notes, @deleted_at, @sort_order)`,
  );
  const insSection = db.prepare(
    `INSERT INTO custom_sections (id, artist_id, project_id, name, type, value, deleted_at, sort_order)
     VALUES (@id, @artist_id, @project_id, @name, @type, @value, @deleted_at, @sort_order)`,
  );
  const insColumn = db.prepare(
    `INSERT INTO custom_columns (name, type, scope, project_id, options, icon, kind, enabled, deletable, sort_order)
     VALUES (@name, @type, 'global', NULL, @options, @icon, 'custom', 1, 1, @sort_order)`,
  );

  const tx = db.transaction(() => {
    ARTISTS.forEach((a, i) => insArtist.run({ layout: null, ...a, sort_order: i }));
    PROJECTS.forEach((p, i) =>
      insProject.run({ color: null, layout: null, deleted_at: null, ...p, sort_order: i }),
    );
    CONTACTS.forEach((c, i) => insContact.run({ notes: null, deleted_at: null, ...c, sort_order: i }));
    EVENTS.forEach((e, i) => insEvent.run({ notes: null, deleted_at: null, ...e, sort_order: i }));

    // Custom columns first: their generated ids are the keys inside tasks.custom_values.
    const colIds = new Map<string, number>();
    CUSTOM_COLUMNS.forEach((c, i) =>
      colIds.set(c.name, Number(insColumn.run({ ...c, sort_order: 100 + i }).lastInsertRowid)),
    );

    TASKS.forEach((t, i) => {
      const cv: Record<string, unknown> = {};
      for (const [column, value] of Object.entries(CUSTOM_VALUES[t.id] ?? {})) {
        const colId = colIds.get(column);
        if (colId === undefined) throw new Error(`CUSTOM_VALUES references unknown column "${column}"`);
        cv[String(colId)] = value;
      }
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

    CUSTOM_SECTIONS.forEach((s, i) => insSection.run({ deleted_at: null, ...s, sort_order: i }));
    // Sections first: widget links reference custom_sections(id).
    LINKS.forEach((l, i) =>
      insLink.run({
        artist_id: null,
        project_id: null,
        event_id: null,
        task_id: null,
        section_id: null,
        category: null,
        notes: null,
        deleted_at: null,
        ...l,
        sort_order: i,
      }),
    );
  });
  tx();

  // The season switcher reads the registry label in seasons.json, not the `saison` setting,
  // so both have to be set or the chip still says "Festival 2026".
  setSetting(db, 'saison', SEASON_LABEL);
  setActiveSeasonLabel(SEASON_LABEL);
  setSetting(db, 'link_categories', JSON.stringify(LINK_CATEGORIES));
  // A saved artist layout, so „Gespeichertes Layout anwenden" has something to apply on a fresh
  // demo instead of sitting disabled. Deliberately *not* the same as any page's own arrangement,
  // and deliberately not written to `artist_layout` — the point of WP-31 is that the saved layout
  // and the standard for new pages are two separate stores.
  setSetting(
    db,
    'artist_layout_saved',
    JSON.stringify([
      { key: 'termine', width: 'half' },
      { key: 'kontakte', width: 'half' },
      { key: 'projekte', width: 'full' },
      { key: 'aufgaben', width: 'full' },
    ]),
  );

  // Two extra seasons so the Saison-Übersicht (landing page) has every card branch on
  // screen: a populated inactive one (exercises the real copy path; no tasks → 0 offene
  // Aufgaben) and an empty one („Noch keine Termine", Kennzahlen all zero). Season 1
  // stays active.
  const next = createSeason('Demofest 2027');
  copySeasonData(next.id, 1, {
    artists: true,
    contacts: false,
    events: true,
    projects: true,
    tasks: false,
    columns: true,
    settings: true,
  });
  createSeason('Demofest 2028 (in Planung)');

  // Landing-card overrides on 2027 only — 2026/2028 keep the auto „Angelegt am"/Zeitraum
  // fallbacks, so both branches render. Plus cross-season Notizen/Dokumente incl. a
  // url-less document for the „(kein Link hinterlegt)" branch.
  updateSeason(next.id, { subtitle: 'Planung startet im Herbst', period: 'Juni – Juli 2027' });
  patchLanding({
    notes:
      'Saisonübergreifend: Förderanträge jeweils bis **März** einreichen 📌. Details im [Förderportal](https://example.org/foerderung).',
    documents: [
      { label: 'Fördervertrag Stadt (PDF)', url: 'https://example.org/foerdervertrag.pdf' },
      { label: 'Vorlage Künstlervertrag', url: 'https://example.org/vertragsvorlage.docx' },
      { label: 'Altes Sponsoring-Konzept', url: null },
    ],
    // One custom section of each type so both landing branches are on screen.
    sections: [
      {
        name: 'Ideen für 2027',
        type: 'text',
        value: 'Open-Air-Bühne prüfen · zweite Förderschiene recherchieren',
      },
      {
        name: 'Verträge 2027',
        type: 'links',
        value: null,
        documents: [{ label: 'Bühnenbau-Angebot', url: 'https://example.org/angebot.pdf' }],
      },
    ],
  });

  console.log(`Demo-Datenbank neu gebaut in ${DEMO_DIR}`);
  console.log('\nRow counts:');
  for (const t of ['artists', 'projects', 'contacts', 'events', 'tasks', 'links', 'custom_columns', 'custom_sections']) {
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    console.log(`  ${t.padEnd(15)} ${n}`);
  }
  console.log(`\n  Saison          ${getSetting(db, 'saison')}`);
}

main();
