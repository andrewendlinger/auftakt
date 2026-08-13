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
import { createHash } from 'node:crypto';
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

/**
 * A tiny hall plan (WP-37), so the „Bild im Text" branch has something to look at without anyone
 * having to insert one by hand. 260×173 JPEG, ~6 KB — the CSV importer cannot express an image any
 * more than it can express `parent_id`, which is why the demo fixtures are code.
 *
 * The reference stored in the prose is the *content* token, so it is computed here rather than
 * written out: change a byte of the image and the row and the Markdown move together.
 */
const SAALPLAN_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQA' +
  'AAABAAABBKADAAQAAAABAAAArQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmA' +
  'CZjs+EJ+/8AAEQgArQEEAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQE' +
  'AAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldY' +
  'WVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk' +
  '5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMR' +
  'BAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdo' +
  'aWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz' +
  '9PX29/j5+v/bAEMADw8PDw8PGg8PGiQaGhokMSQkJCQxPjExMTExPks+Pj4+Pj5LS0tLS0tLS1paWlpaWmlpaWlpdnZ2dnZ2dnZ2' +
  'dv/bAEMBEhMTHhweNBwcNHtURVR7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e//dAAQA' +
  'Ef/aAAwDAQACEQMRAD8A76o3lSPG7PPTAJ/lUlQv/r4/o39KAE+0R+jf98n/AAo+0R+jf98n/Cp6KAIPtEfo3/fJ/wAKPtEfo3/f' +
  'J/wqeigCD7RH6N/3yf8ACj7RH6N/3yf8KnooAg+0R+jf98n/AAo+0R+jf98n/Cp6KAIPtEfo3/fJ/wAKPtEfo3/fJ/wouZxbW8lw' +
  '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';
const SAALPLAN_BYTES = Buffer.from(SAALPLAN_JPEG_B64, 'base64');
const SAALPLAN_TOKEN = createHash('sha256').update(SAALPLAN_BYTES).digest('hex').slice(0, 32);
const SAALPLAN_REF = `/api/images/${SAALPLAN_TOKEN}`;

// Appended to RICH_DESCRIPTION below — the shape migrateProjectsMergeNotes() leaves behind
// when a pre-merge project had both text fields filled. `?w=384` is what „Bild einfügen" writes
// today (the „Mittel" default), so this is the sized branch to eyeball; `?a=center` is the
// centered one. The float branch is the imported raw `align="right"` in the artist note below,
// and the linked image there stays unsized, i.e. „Original".
const RICH_PROJECT_NOTES = `**Bestätigt:** Termin, Saal und Honorar stehen. Rider liegt vor — Details im [Ordner](https://example.com/rider).

![Saalplan großer Saal](${SAALPLAN_REF}?w=384)

Fürs Programmheft, klein und zentriert:

![Saalplan zentriert](${SAALPLAN_REF}?w=192&a=center)`;

// The two image shapes only an *import* produces, side by side with the one the button writes —
// so the branches that used to disagree between reader and editor have something to look at.
// A raw `<img>` nested inside a block (here a quote) rendered outside any paragraph in the reader
// while the editor read it into one, and `width`/`align` used to be dropped on the way to the DOM,
// so the thumbnail jumped to full column width. Click into the note and out of it: nothing may
// move.
const RICH_ARTIST_NOTES = `Streichquartett, <u>Residenz</u> über das ganze Festival. Reisen gemeinsam an 🚐.

- Bevorzugt vegetarisches Catering
- Braucht Stimmzimmer ab Mittag

> Aus dem alten Notion-Export übernommen:
> <img src="${SAALPLAN_REF}" alt="Saalplan aus dem Export" width="120" align="right">

Und der Plan mit Link auf die Saalseite: [![Saalplan](${SAALPLAN_REF})](https://example.com/saal)`;

const RICH_EVENT_NOTES = `Doors 19:00, Beginn **19:30**. Zugabe ist abgesprochen 🎻.`;

// What WP-49 has to make readable again, in one note. The fence and the four-space paragraph are
// what the app itself used to store when a user indented a line — both rendered as a grey code
// box with the `<u>` printed literally. The backticks are the other half of the grey, and the
// last block is the indentation Tab writes now (U+00A0, spelled out so it stays visible in a
// diff). Nothing here may render as code, and nothing may go missing.
const LEGACY_CODE_NOTES = [
  'Ablauf am Abend — die Einrückungen kamen aus der alten Fassung:',
  '',
  // Blank line and sub-indentation inside the fence, because that is what an indented block
  // swallowed: as hard breaks the blank line came back as a paragraph break, and the indentation
  // has to survive as U+00A0 or the reader loses it (`lib/legacyCode.ts`).
  '```',
  'Soundcheck 14:00',
  '  Bühne frei ab 13:30',
  '',
  'Einlass 19:00',
  '```',
  '',
  '    Bühne dann <u>komplett</u> geräumt',
  '',
  'Dateiname war `set-final-v3`, bitte so übernehmen.',
  '',
  `${'\u00a0'.repeat(3)}Nachbereitung ab 23:00`,
].join('\n');

/**
 * A per-entity section arrangement (WP-25). Only artist 2 and project 3 carry one; everyone else
 * stays `NULL` and follows the `artist_layout`/`project_layout` template, so the two states — and
 * the fact that arranging one artist leaves the others alone — are both on screen. Artist 2 also
 * un-hides `stats`, which both entity pages ship as `defaultHidden`, and tombstones
 * `aufmerksamkeit` (a removed section, WP-45) so „+ Bereich" has something to offer back and the
 * removed state is eyeballable without removing anything first.
 */
const ARTIST_2_LAYOUT = JSON.stringify([
  { key: 'kontakte', width: 'half' },
  { key: 'stats', width: 'half' },
  { key: 'termine', width: 'full' },
  { key: 'aufmerksamkeit', width: 'full', hidden: true },
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
  { id: 6, artist_id: 3, code: 'KH2', name: 'Late-Night-Set', status: 'Not Started', description: LEGACY_CODE_NOTES },
  { id: 7, artist_id: 4, code: 'JW1', name: 'Solo-Rezital', status: 'Done', description: 'Programm steht, Werbung läuft.' },
  { id: 8, artist_id: 4, code: 'JW2', name: 'Meisterkurs', status: 'In Progress', description: 'Drei Tage, zwölf Teilnehmende.' },
  // Soft-deleted (in the trash) — its live child task 52 makes the cascade count demonstrable.
  { id: 9, artist_id: 4, code: 'JW3', name: 'Gestrichenes Nebenkonzert', status: 'Not Started', description: null, deleted_at: stamp(-4) },
];

const CONTACTS = [
  // Two with notes (one rich, one plain), the rest without — the inline contact text
  // field needs both the filled and the hover-only-placeholder branch on screen.
  //
  // Project 1 carries three and artist 1 two, so both contact surfaces can actually be dragged
  // (WP-35). Every other parent keeps exactly one — artist 3 in particular, whose „1 Kontakt" is
  // one of the four numbers docs/VERIFYING.md pins for the WP-34 delete dialog. Note what that
  // contact is *not*: it hangs off the artist directly, so it says nothing about the count
  // walking through projects — the 14 tasks are what prove that. Moving it onto project 5 or 6
  // would leave the total unchanged and still break the documented fixture.
  { id: 1, artist_id: null, project_id: 1, role: 'Management', name: 'Merle Dahlke', email: 'merle.dahlke@example.org', phone: '+49 151 0000001', notes: 'Erreichbar **vormittags**, sonst per [Mail](mailto:merle.dahlke@example.org).' },
  { id: 2, artist_id: 1, project_id: null, role: 'Tourmanagement', name: 'Piet Aalders', email: 'piet@example.org', phone: null, notes: 'Regelt auch die Backline.' },
  { id: 3, artist_id: null, project_id: 3, role: 'Booking', name: 'Rosa Enríquez', email: 'rosa@example.org', phone: '+351 900 000 000' },
  { id: 4, artist_id: 3, project_id: null, role: 'Label', name: 'Halbton Records', email: 'kontakt@example.org', phone: null },
  { id: 5, artist_id: null, project_id: 7, role: 'Agentur', name: 'Ines Kubowski', email: 'ines@example.org', phone: '+49 151 0000002' },
  // Soft-deleted contact — a leaf in the trash (nothing references it).
  { id: 6, artist_id: 1, project_id: null, role: 'Fahrer', name: 'Ehemaliger Fahrer', email: null, phone: null, deleted_at: stamp(-5) },
  // The rows that make a contact list reorderable. One of them is coloured: the drop highlight is
  // a ring, and a coloured row draws its own left border, so the two have to be seen together.
  { id: 7, artist_id: null, project_id: 1, role: 'Technik', name: 'Tobias Reinke', email: 'tobias.reinke@example.org', phone: '+49 151 0000003', color: '#f59e0b' },
  { id: 8, artist_id: null, project_id: 1, role: 'Abendspielleitung', name: 'Wanda Groß', email: null, phone: '+49 151 0000004', notes: 'Nur am Konzerttag erreichbar.' },
  { id: 9, artist_id: 1, project_id: null, role: 'Backline', name: 'Sven Ostermann', email: 'sven@example.org', phone: null },
  // Season-level contact (no parent at all, WP-47) — fills the Übersicht's „Saison-Kontakte"
  // section, and its GlobalSearch hit must land on /dashboard, not an artist or project page.
  { id: 10, artist_id: null, project_id: null, role: 'Festivalbüro', name: 'Greta Simoneit', email: 'buero@example.org', phone: '+49 151 0000005' },
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
  // Season-level event (no parent at all, WP-47) — fills „Saison-Termine" on the Übersicht and
  // joins the „Nächste Termine" roll-up as the row whose link stays on /dashboard (WP-48). Dated
  // inside the default 14-day window so both appearances are on the first screen; the season
  // copy passes `events: true`, so it also exercises the parentless copy arm into Demofest 2027.
  { id: 11, artist_id: null, project_id: null, type: 'Termin', title: 'Team-Sitzung Saisonplanung', start_at: days(6), end_at: null, all_day: 1, location: 'Festivalbüro' },
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
  // The comment cell's share of the WP-49 fixture: an old note whose indentation the app stored
  // as a fence, in the one place a note is rendered inside a table cell.
  { id: 14, project_id: 6, title: 'Lichtkonzept abstimmen', status: 'new', priority: 'niedrig', comment: 'Alte Notiz:\n\n```\nGobos prüfen\n```' },
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
  //
  // Odd by *status*, not by priority: since WP-32 a hidden column no longer orders the table and
  // Priorität ships hidden, so a „hoch" among „mittel" is no rank difference at all — under the
  // default `[status]` the whole block would tie and the fixture would have stopped testing
  // anything. Status is the one rule that is on by default and visible.
  { id: 41, project_id: 5, title: 'Requisiten sichten', status: 'new', priority: 'mittel' },
  { id: 42, project_id: 5, title: 'Kostüme aussortieren', status: 'new', priority: 'mittel' },
  { id: 43, project_id: 5, title: 'Werkstatt aufräumen', status: 'new', priority: 'mittel' },
  { id: 44, project_id: 5, title: 'Bestandsliste ergänzen', status: 'new', priority: 'mittel' },
  { id: 45, project_id: 5, title: 'Versicherung prüfen (andere Rangstufe)', status: 'active', priority: 'hoch' },
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
 *
 * Artist 1 repeats that spread on the artist page's own „Dokumente & Links" (WP-36), and it has
 * to be artist 1: it carries no `layout` of its own, so it is the one that shows the section in
 * its default position. Artist 2 stores a layout and therefore gets the section appended last —
 * both states matter, and its single uncategorized link covers the ungrouped rendering.
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
  // Artist 1's documents (WP-36) — two „Vertrag" rows so the within-category drag has somewhere
  // to go, one „Presse" row, and one without a category so „Ohne Kategorie" renders last.
  { id: 13, artist_id: 1, label: 'Rahmenvertrag 2026', url: 'https://example.org/rahmenvertrag.pdf', category: 'vertrag', notes: 'Gilt für alle Projekte dieser Saison.' },
  { id: 14, artist_id: 1, label: 'Honorarvereinbarung', url: 'https://example.org/honorar.pdf', category: 'vertrag' },
  { id: 15, artist_id: 1, label: 'Pressefotos (Download)', url: 'https://example.org/pressefotos', category: 'presse' },
  { id: 16, artist_id: 1, label: 'Kurzbiografie', url: null, notes: 'Liegt nur **auf Papier** vor — noch einscannen.' },
  // Season-level link (all five parent FKs NULL, WP-47) — fills the Übersicht's
  // „Dokumente & Links" section; as a parentless link it rides the `settings` copy group.
  { id: 17, label: 'Förderantrag 2026 (bewilligt)', url: 'https://example.org/foerderantrag.pdf', category: 'vertrag' },
];

/**
 * Custom task columns — the only way to exercise the data-driven task table. `scope` defaults to
 * the season-wide one; a row naming a parent is that page's own column and appears nowhere else
 * (WP-51), which is the branch the artist entry below is here to show.
 */
const CUSTOM_COLUMNS: Array<{
  name: string;
  type: string;
  icon: string;
  options: string | null;
  scope?: string;
  artist_id?: number;
}> = [
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
  // The `date` branch of `CustomCell`, which had no fixture at all — and it is the branch with
  // its own keyboard rules (a half-typed date commits nothing, WP-43), so „eyeball it" means
  // typing into it.
  { name: 'Abgabe', type: 'date', icon: '📆', options: null },
  // Artist-scoped: visible on Nordlicht Quartett's own task list and on no other page. Its two
  // values sit on tasks 16 and 51, the artist-level tasks of that artist.
  {
    name: 'Freigabe',
    type: 'select',
    icon: '📝',
    scope: 'artist',
    artist_id: 1,
    options: JSON.stringify([
      { value: 'ausstehend', label: 'ausstehend', color: '#fef3c7' },
      { value: 'erteilt', label: 'erteilt', color: '#dcfce7' },
    ]),
  },
];

/**
 * taskId → value per custom column, keyed by the column *name* in CUSTOM_COLUMNS. Left sparse
 * on purpose so empty cells show too — an omitted key is an empty cell. Keyed rather than
 * positional because a fixed [Bereich, Bestätigt] tuple silently wrote the select value into
 * the checkbox column and vice versa as soon as CUSTOM_COLUMNS was reordered (SDB-12).
 */
const CUSTOM_VALUES: Record<
  number,
  Partial<Record<'Bereich' | 'Bestätigt' | 'Abgabe' | 'Freigabe', string | boolean>>
> = {
  1: { Bereich: 'logistik', Bestätigt: false, Abgabe: days(6) },
  3: { Bereich: 'logistik', Bestätigt: true },
  5: { Bereich: 'technik', Bestätigt: true, Abgabe: days(2) },
  7: { Bereich: 'logistik', Bestätigt: false },
  10: { Bereich: 'kommunikation' },
  13: { Bereich: 'technik', Bestätigt: false },
  20: { Bereich: 'kommunikation', Bestätigt: true },
  21: { Bereich: 'kommunikation', Bestätigt: false },
  31: { Bestätigt: true },
  36: { Bereich: 'technik', Bestätigt: false },
  // Artist 1's own tasks, the only rows where the artist-scoped „Freigabe" column is visible.
  16: { Freigabe: 'ausstehend' },
  51: { Bereich: 'kommunikation', Freigabe: 'erteilt' },
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
  // The demo hall plan. `ON CONFLICT DO NOTHING` mirrors the real upload path, so re-seeding is
  // idempotent for the same reason a second paste of the same picture is.
  db.prepare(
    `INSERT INTO images (token, mime, bytes, byte_size, width, height, name)
     VALUES (?, 'image/jpeg', ?, ?, 260, 173, 'saalplan.jpg')
     ON CONFLICT(token) DO NOTHING`,
  ).run(SAALPLAN_TOKEN, SAALPLAN_BYTES, SAALPLAN_BYTES.length);

  const insProject = db.prepare(
    `INSERT INTO projects (id, artist_id, code, name, status, description, color, layout, deleted_at, sort_order)
     VALUES (@id, @artist_id, @code, @name, @status, @description, @color, @layout, @deleted_at, @sort_order)`,
  );
  const insContact = db.prepare(
    `INSERT INTO contacts (id, artist_id, project_id, role, name, email, phone, notes, color, deleted_at, sort_order)
     VALUES (@id, @artist_id, @project_id, @role, @name, @email, @phone, @notes, @color, @deleted_at, @sort_order)`,
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
    `INSERT INTO custom_columns (name, type, scope, artist_id, project_id, options, icon, kind, enabled, deletable, sort_order)
     VALUES (@name, @type, @scope, @artist_id, NULL, @options, @icon, 'custom', 1, 1, @sort_order)`,
  );

  const tx = db.transaction(() => {
    ARTISTS.forEach((a, i) => insArtist.run({ layout: null, ...a, sort_order: i }));
    PROJECTS.forEach((p, i) =>
      insProject.run({ color: null, layout: null, deleted_at: null, ...p, sort_order: i }),
    );
    CONTACTS.forEach((c, i) => insContact.run({ notes: null, color: null, deleted_at: null, ...c, sort_order: i }));
    EVENTS.forEach((e, i) => insEvent.run({ notes: null, deleted_at: null, ...e, sort_order: i }));

    // Custom columns first: their generated ids are the keys inside tasks.custom_values.
    const colIds = new Map<string, number>();
    CUSTOM_COLUMNS.forEach((c, i) =>
      colIds.set(
        c.name,
        Number(
          insColumn.run({ scope: 'global', artist_id: null, ...c, sort_order: 100 + i })
            .lastInsertRowid,
        ),
      ),
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

    // Fällig ships hidden (WP-32), which left the built-in date cell invisible in the demo and
    // therefore unverifiable. Showing it here is a fixture choice, not a changed default: the
    // stored `task_sort` is `[status]`, so waking the column up orders nothing differently.
    db.prepare(`UPDATE custom_columns SET enabled = 1 WHERE kind = 'builtin' AND key = 'due'`).run();

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
  // The Übersicht's layout, opting the three season sections in — they ship `defaultHidden`, so
  // without this row the fixtures above would sit invisibly behind „+ Bereich". Order matches
  // the spec order a fresh dashboard produces (widgets cs1/cs2 auto-append last), with `termine`
  // right after the read-only roll-up so the two hint-line states sit together, and the
  // kontakte/links pair half-width — the arrangement the picker's re-add cannot produce on its
  // own, only the width toggle can.
  setSetting(
    db,
    'dashboard_layout',
    JSON.stringify([
      { key: 'artists', width: 'full' },
      { key: 'events', width: 'full' },
      { key: 'termine', width: 'full' },
      { key: 'kontakte', width: 'half' },
      { key: 'links', width: 'half' },
      { key: 'stats', width: 'full' },
      { key: 'tasks', width: 'full' },
      { key: 'aufmerksamkeit', width: 'full' },
      { key: 'cs1', width: 'full' },
      { key: 'cs2', width: 'full' },
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
        // Two rows, not one: a custom Dokumente-Bereich writes its documents through its own
        // section row rather than through `landing.documents`, and with a single row that second
        // reorder path cannot be dragged at all (WP-50).
        documents: [
          { label: 'Bühnenbau-Angebot', url: 'https://example.org/angebot.pdf' },
          { label: 'Technik-Angebot', url: 'https://example.org/technik.pdf' },
        ],
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
