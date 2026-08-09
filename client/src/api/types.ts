// The only import here, and deliberately one-way: selectOptions.ts imports from this file
// type-only, so the edge is erased at build and no runtime cycle exists.
import { normalizeSelectOptions } from '../lib/selectOptions';

export type ID = number;

interface SoftDeletable {
  id: ID;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Artist extends SoftDeletable {
  name: string;
  color: string;
  notes: string | null;
  /** Profile picture as a resized data URL (JPEG), or null. */
  image: string | null;
  /**
   * This page's own section arrangement as JSON text — a `LayoutEntry[]`, unparsed the way every
   * JSON-in-TEXT column arrives (the crud factory has no read transform). `null` means „never
   * arranged": the page then follows the `artist_layout` setting, which is the template. Read it
   * through `parseEntityLayout` (SectionArranger.tsx), never `JSON.parse` at a call site.
   */
  layout: string | null;
}

export interface ArtistCard extends Artist {
  project_count: number;
  open_task_count: number;
}

export interface Project extends SoftDeletable {
  artist_id: ID;
  code: string;
  name: string;
  status: string | null;
  description: string | null;
  color: string | null;
  /** This page's own section arrangement — see `Artist.layout`; the template is `project_layout`. */
  layout: string | null;
}

export type ContactParent = { artist_id: ID | null; project_id: ID | null };

export interface Contact extends SoftDeletable, ContactParent {
  role: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  color: string | null;
}

/** Fields the denormalised list endpoints add on top of the base row. */
export interface Resolved {
  resolved_artist_id: ID | null;
  artist_name: string | null;
  artist_color: string | null;
  project_code: string | null;
  project_name: string | null;
  project_color: string | null;
}

export interface EventItem extends SoftDeletable, Partial<Resolved> {
  artist_id: ID | null;
  project_id: ID | null;
  type: string;
  title: string;
  /** NULL = kein festes Datum („Datum offen" / TBD). */
  start_at: string | null;
  end_at: string | null;
  all_day: number;
  location: string | null;
  notes: string | null;
}

/** Status/priority are now user-editable category values, so both are free strings. */
export type TaskStatus = string;
export type TaskPriority = string;

export interface Task extends SoftDeletable, Partial<Resolved> {
  artist_id: ID | null;
  project_id: ID | null;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  comment: string | null;
  color: string | null;
  custom_values: string; // JSON string keyed by custom column id
  erledigt_am: string | null;
  /** Subtask link: the parent task's id, or null for a top-level task. */
  parent_id: ID | null;
}

/**
 * Where a task sits in the tree and the scope hierarchy — everything a subtree move rewrites,
 * and therefore everything its undo has to put back. Returned by `POST /tasks/:id/move` as the
 * placement each affected row had *before* the move.
 */
export interface TaskPlacement {
  id: ID;
  artist_id: ID | null;
  project_id: ID | null;
  parent_id: ID | null;
}

/** Custom column widgets, plus the built-in bindings (status/title/priority/due/comment). */
export type CustomColumnType =
  | 'text'
  | 'date'
  | 'checkbox'
  | 'select'
  | 'status'
  | 'title'
  | 'priority'
  | 'due'
  | 'comment'
  // Read-only built-ins bound to the task's timestamps.
  | 'created'
  | 'updated';
export type CustomColumnScope = 'global' | 'project';
export type CustomColumnKind = 'builtin' | 'custom';

export interface CustomColumnOption {
  label: string;
  value: string;
  color: string;
  /** Status column only: the single terminal "done" category. */
  done?: boolean;
}

export interface CustomColumn extends SoftDeletable {
  name: string;
  type: CustomColumnType;
  scope: CustomColumnScope;
  project_id: ID | null;
  options: string | null; // JSON string of CustomColumnOption[]
  /** Optional emoji/symbol shown in the column header (custom columns). */
  icon: string | null;
  /** Built-in columns bind to a real task field via this key; custom columns have key = null. */
  key: string | null;
  kind: CustomColumnKind;
  enabled: number; // 0/1 — hidden columns are kept but not shown
  deletable: number; // 0/1 — Status & Aufgabe can't be removed
}

export interface LinkItem extends SoftDeletable {
  artist_id: ID | null;
  project_id: ID | null;
  event_id: ID | null;
  task_id: ID | null;
  section_id: ID | null;
  label: string;
  url: string | null;
  color: string | null;
  /** A `link_categories` option `value` (rename-safe), or null for "Ohne Kategorie". */
  category: string | null;
  /** Short description under the row, edited inline (WP-26). Markdown, like every other note. */
  notes: string | null;
}

/**
 * A user-added widget section (WP-S) on the dashboard (both parents null), an artist page or
 * a project page. Per-entity: the row carries its own content — `value` holds the rich text
 * for `type: 'text'`; a `links` widget's items are the links with this `section_id`.
 */
export interface CustomSection extends SoftDeletable {
  artist_id: ID | null;
  project_id: ID | null;
  name: string;
  type: 'text' | 'links';
  value: string | null;
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
 * Write payloads — the client half of the server's `writable` allowlists.
 *
 * `crudRouter` (server/src/lib/crud.ts) filters every body through `writable` and drops the rest
 * without a word, so a column that is not on that list is a *silent* no-op on the wire. Typing
 * create/update as `Partial<Row>` let the whole row through: `customColumns.create({ …, key:
 * 'status', kind: 'builtin' })` compiled, and produced a column bound to nothing that rendered
 * empty for every task with no error at either end (CCL-24).
 *
 * `…Update` is the allowlist, all optional — PATCH is column-set semantics, only the supplied
 * columns reach the SET clause. `…Create` adds the router's `required` list.
 *
 * These restate server/src/routes/entities.ts and are kept in step by hand — the same
 * arrangement as `SERVER_DEFAULT_RULES` in TaskTable.tsx, which restates `taskOrder` from
 * server/src/lib/queries.ts. There is no shared type package: `shared/` is dependency-free by
 * design and the REST boundary is the boundary. A column added on the server is unreachable
 * from here until it is added below.
 *
 * **Invariant:** every `…Update` *widens* its row type — same key, same or wider value type.
 * That is what keeps a set of raw row values a legal patch, which `useUndoablePatch` relies on
 * to build an inverse. Never narrow a column here.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * `layout` widens the row's `string | null` by the parsed array, the way `TaskUpdate` widens
 * `custom_values`: the server stringifies an array (`jsonColumns`) and stores `null` as-is, so a
 * writer may send either and a raw row value stays a legal patch.
 */
type LayoutPatch = { layout?: string | LayoutEntry[] | null };

export type ArtistUpdate = Partial<Pick<Artist, 'name' | 'color' | 'notes' | 'image' | 'sort_order'>> &
  LayoutPatch;
export type ArtistCreate = ArtistUpdate & Pick<Artist, 'name'>;

export type ProjectUpdate = Partial<
  Pick<Project, 'artist_id' | 'code' | 'name' | 'status' | 'description' | 'color' | 'sort_order'>
> &
  LayoutPatch;
export type ProjectCreate = ProjectUpdate & Pick<Project, 'artist_id' | 'code' | 'name'>;

export type ContactUpdate = Partial<
  Pick<
    Contact,
    'artist_id' | 'project_id' | 'role' | 'name' | 'email' | 'phone' | 'notes' | 'color' | 'sort_order'
  >
>;
export type ContactCreate = ContactUpdate & Pick<Contact, 'name'>;

export type EventUpdate = Partial<
  Pick<
    EventItem,
    | 'artist_id'
    | 'project_id'
    | 'type'
    | 'title'
    | 'start_at'
    | 'end_at'
    | 'all_day'
    | 'location'
    | 'notes'
    | 'sort_order'
  >
>;
export type EventCreate = EventUpdate & Pick<EventItem, 'type' | 'title'>;

export type LinkUpdate = Partial<
  Pick<
    LinkItem,
    | 'artist_id'
    | 'project_id'
    | 'event_id'
    | 'task_id'
    | 'section_id'
    | 'label'
    | 'url'
    | 'color'
    | 'category'
    | 'notes'
    | 'sort_order'
  >
>;
export type LinkCreate = LinkUpdate & Pick<LinkItem, 'label'>;

export type CustomSectionUpdate = Partial<
  Pick<CustomSection, 'artist_id' | 'project_id' | 'name' | 'type' | 'value' | 'sort_order'>
>;
export type CustomSectionCreate = CustomSectionUpdate & Pick<CustomSection, 'name' | 'type'>;

export type CustomColumnUpdate = Partial<
  Pick<
    CustomColumn,
    'name' | 'type' | 'scope' | 'project_id' | 'icon' | 'enabled' | 'deletable' | 'sort_order'
  >
> & {
  /**
   * Written as the option *array* — `jsonColumns: ['options']` stringifies it server-side. The
   * `| string` arm keeps a raw row value a legal patch (see the widening invariant above);
   * `readOptions` accepts the JSON text too. Read back as the string the row type declares.
   */
  options?: CustomColumnOption[] | string | null;
};
/** `key` and `kind` are absent on purpose: not in `writable`, and a create is always `kind: 'custom'`. */
export type CustomColumnCreate = CustomColumnUpdate & Pick<CustomColumn, 'name' | 'type'>;

export type TaskUpdate = Partial<
  Pick<
    Task,
    | 'artist_id'
    | 'project_id'
    | 'title'
    | 'status'
    | 'priority'
    | 'due_date'
    | 'comment'
    | 'color'
    | 'parent_id'
    | 'sort_order'
    /**
     * Writable on purpose, and it has to stay: the undo stack restores the original completion
     * date, and `acceptsErledigtAm()` server-side drops anything that is not that undo (SDL-02).
     * Every other write of it is server-derived from the status flip.
     */
    | 'erledigt_am'
  >
> & {
  /**
   * An **object** patches the named keys into the row's own blob (merged server-side); a
   * **string** replaces the blob verbatim. Both arms are load-bearing — the object arm is what
   * makes concurrent cell edits safe, the string arm is what lets `useUndoablePatch` put a whole
   * pre-edit blob back.
   */
  custom_values?: Record<string, unknown> | string;
};
export type TaskCreate = TaskUpdate & Pick<Task, 'title'>;

/**
 * The content entities a user directly deletes and can find again in the archive's trash.
 * `column` is a user-added task column — built-ins never appear, since ensureBuiltinColumns()
 * re-creates a missing one on the next launch.
 */
export type DeletedType =
  | 'artist'
  | 'project'
  | 'contact'
  | 'event'
  | 'task'
  | 'link'
  | 'section'
  | 'column';

/** One soft-deleted row surfaced in the "Gelöschte Items" section. */
export interface DeletedItem {
  type: DeletedType;
  id: ID;
  /** Human label (e.g. task title, "CODE · Projektname"). */
  label: string;
  /** Owner context (artist name / project code), or null for season-wide/leaf rows. */
  sublabel: string | null;
  deleted_at: string;
  /**
   * When the automatic purge removes it (deleted_at + PURGE_AFTER_DAYS), or null when a live
   * entry still references it — the purge skips those, so only "Endgültig löschen" clears them.
   */
  purge_at: string | null;
  /** What a permanent delete cascades to. `column` = a project's custom columns. */
  dependents: { total: number; byType: Partial<Record<DeletedType, number>> };
}

export interface Season {
  id: ID;
  label: string;
  file: string;
  /** Naive local „YYYY-MM-DD HH:MM:SS" — formatDate takes it as-is. */
  createdAt: string;
  /** User override for the card's „Angelegt am …" line; absent = auto text. */
  subtitle?: string;
  /** User override for the card's auto Zeitraum line; absent = auto text. */
  period?: string;
  /** Set when the season was created but copying from another one failed. */
  copyError?: string;
}

export interface SeasonPatch {
  label?: string;
  subtitle?: string | null; // null clears the override
  period?: string | null;
}

/** What a new season carries over from an existing one. Every group is optional. */
export interface SeasonCopyOptions {
  artists: boolean;
  contacts: boolean;
  events: boolean;
  projects: boolean;
  tasks: boolean;
  columns: boolean;
  settings: boolean;
}

/** The user-renameable word for a season („Saison"/„Saisons" by default). */
export interface SeasonTerms {
  season?: string;
  seasonPlural?: string;
}

export interface SeasonList {
  activeId: ID;
  activeFile: string;
  seasons: Season[];
  terms?: SeasonTerms;
}

/** Per-season Kennzahlen for the landing page; null when the file can't be read. */
export interface SeasonStats {
  artists: number;
  projects: number;
  openTasks: number;
  firstEvent: string | null;
  lastEvent: string | null;
}

export type SeasonStatsMap = Record<ID, SeasonStats | null>;

/** Cross-season landing-page content, stored in the seasons.json registry. */
export interface LandingDoc {
  id: ID;
  label: string;
  url: string | null;
}

/** A user-created section on the landing page: a Textfeld or its own Dokumente list. */
export interface LandingSection {
  id: ID;
  name: string;
  type: 'text' | 'links';
  value: string | null; // Markdown; text sections only
  documents?: LandingDoc[]; // links sections only
}

export interface LandingContent {
  notes: string | null; // Markdown
  documents: LandingDoc[];
  layout: LayoutEntry[];
  sections: LandingSection[];
}

/** New documents/sections are sent id-less; the server assigns max+1. */
export type LandingDocInput = Omit<LandingDoc, 'id'> & { id?: ID };
export type LandingSectionInput = Omit<LandingSection, 'id' | 'documents'> & {
  id?: ID;
  documents?: LandingDocInput[];
};

/**
 * A landing write. Every key present replaces its whole value — the registry stores what it is
 * given, it does not merge — which is why the caller has to compute each array from the list as
 * it is *now* (`useLanding().current()`) rather than from a render snapshot.
 */
export interface LandingPatch {
  notes?: string | null;
  documents?: LandingDocInput[];
  layout?: LayoutEntry[];
  sections?: LandingSectionInput[];
}

/** One section's placement in a page layout: its key and how wide it renders. */
export interface LayoutEntry {
  key: string;
  width: 'full' | 'half';
  /** Section removed by the user. Built-ins only — custom `cs<id>` widgets are soft-deleted rows, never hidden. */
  hidden?: boolean;
}

/**
 * One renamed UI heading. Stored as an array rather than a `Record` because the settings
 * PATCH only JSON-stringifies arrays (`server/src/routes/settings.ts`) — an object would be
 * silently persisted as the string "[object Object]".
 */
export interface LabelOverride {
  /** A `LabelKey` from `lib/labels.ts`; unknown ids are ignored on read. */
  key: string;
  label: string;
}

/** One level of the automatic task-ordering hierarchy (Settings → Automatische Sortierung). */
export interface TaskSortRule {
  /** A sortable builtin column id: status | priority | due | title | created | updated. */
  id: string;
  dir: 'asc' | 'desc';
}

/**
 * Every settings key a client may write — the mirror of `WRITABLE_SETTINGS` in
 * server/src/routes/settings.ts, which drops anything not on its list *silently*: the PATCH
 * answers 200, the Settings page looks saved, and the control snaps back on the next refetch
 * with nothing logged. Keep the two lists in step; add a new setting to both (CCL-22).
 */
export interface WritableSettings {
  saison: string;
  /**
   * Coloured options `{ value, label, color }[]` (WP-I). Existing seasons still hold the legacy
   * plain `string[]`, hence the union — always read through `normalizeSelectOptions`
   * (`useEventTypeOptions` / `useProjectStatusOptions`), never off the raw setting.
   */
  event_types: Array<string | CustomColumnOption>;
  project_statuses: Array<string | CustomColumnOption>;
  /** Link categories (WP-P); unset on older seasons. Read via `useLinkCategoryOptions`. */
  link_categories?: Array<string | CustomColumnOption>;
  /**
   * The **default** a project page inherits while its own `projects.layout` column is NULL —
   * order, width, hidden of the sections (termine/kontakte/stats/…). Written by „Als Standard für
   * neue Seiten speichern"; never holds a `cs<id>` widget key, which belongs to one page only.
   */
  project_layout?: LayoutEntry[];
  /** The same default for artist pages, read while `artists.layout` is NULL. */
  artist_layout?: LayoutEntry[];
  /** Layout of the dashboard sections (artists/events/tasks + custom widgets) — order + width. */
  dashboard_layout?: LayoutEntry[];
  /**
   * The **saved** project layout — a second, independent store the user applies to a page on
   * demand („Gespeichertes Layout anwenden"), rather than the one new pages inherit (WP-31).
   * Also widget-free, since it is applied to pages other than the one it was saved from.
   */
  project_layout_saved?: LayoutEntry[];
  /** The same saved store for artist pages. */
  artist_layout_saved?: LayoutEntry[];
  /** Automatic ordering hierarchy for the main task table. */
  task_sort?: TaskSortRule[];
  /** User-renamed headings; only overrides are stored, defaults live in `lib/labels.ts`. */
  labels?: LabelOverride[];
  /** Enabled task-insight metric keys (`TaskMetric`); parsed via `useTaskStatsConfig`. */
  task_stats?: string[];
  /** „Braucht Aufmerksamkeit“ window in days, stored as a scalar string. */
  attention_window_days?: string;
}

/**
 * What `GET /api/settings` answers with: every writable setting, plus read-only values the
 * server splices into the response. Anything added here and *not* to `WritableSettings` is
 * invisible to `patchSettings` by construction — which is the point.
 *
 * There is deliberately no `[key: string]: unknown` index signature. It used to disable
 * excess-property checking on the PATCH, so a mistyped key compiled cleanly and was dropped
 * server-side with no error anywhere (CCL-22).
 */
export interface Settings extends WritableSettings {
  /**
   * The configured backup folder, `''` while none is set. Read-only here: it lives in
   * seasons.json rather than any season's settings table (WP-39), and is saved through the
   * `chooseBackupDir` IPC path → `POST /api/backup/dir`, never through `patchSettings`.
   */
  backup_dir: string;
  /**
   * Server retention constants (`ARCHIVE_AFTER_DAYS` / `PURGE_AFTER_DAYS`, server/src/db.ts),
   * spliced into the response so the German copy can state the policy in force rather than
   * hardcode it (PGS-24). Read through `useRetention()`. Never writable — they are absent from
   * `WritableSettings`, and the server's own allowlist drops them too. Optional so a response
   * from an older server still type-checks.
   */
  readonly archive_after_days?: number;
  readonly purge_after_days?: number;
}

/**
 * The settings whose value is a JSON array — the mirror of `ARRAY_KEYS` in
 * server/src/routes/settings.ts, which is what makes them round-trip parsed and what makes a
 * non-array value a 400 (SDL-06). Written out rather than derived from `WritableSettings`,
 * because the server's list is the one that decides, not this file's value types.
 */
export type SettingsArrayKey =
  | 'event_types'
  | 'project_statuses'
  | 'link_categories'
  | 'project_layout'
  | 'artist_layout'
  | 'dashboard_layout'
  | 'project_layout_saved'
  | 'artist_layout_saved'
  | 'task_sort'
  | 'labels'
  | 'task_stats';

/** The array a settings key holds, with the optionality-induced `undefined` stripped. */
export type SettingsArrayValue<K extends SettingsArrayKey> = NonNullable<WritableSettings[K]>;

export interface Dashboard {
  artists: ArtistCard[];
  upcoming14: EventItem[];
  nextUp: EventItem[];
  tasks: Task[];
}

export interface SearchResults {
  artists: Array<{ id: ID; name: string }>;
  projects: Array<{ id: ID; artist_id: ID; code: string; name: string }>;
  tasks: Array<{
    id: ID;
    title: string;
    status: TaskStatus;
    project_id: ID | null;
    artist_id: ID | null;
    resolved_artist_id: ID | null;
    project_code: string | null;
  }>;
  events: Array<{
    id: ID;
    title: string;
    type: string;
    start_at: string | null;
    all_day: number;
    project_id: ID | null;
    artist_id: ID | null;
    resolved_artist_id: ID | null;
    project_code: string | null;
  }>;
  contacts: Array<{
    id: ID;
    name: string;
    role: string | null;
    email: string | null;
    project_id: ID | null;
    artist_id: ID | null;
    resolved_artist_id: ID | null;
    project_code: string | null;
  }>;
}

/**
 * A task's `custom_values` blob. The syntax-error guard was not enough: `JSON.parse('null')`
 * parses fine and returns `null`, the cast hid it, and the very next property access in
 * `customValueOf` threw — blanking the whole task table for that season. Reachable through the
 * Electron DB-import path (`validateImportCandidate` never inspects cell contents) and through
 * a non-UI `PATCH /api/tasks/:id {"custom_values":"null"}`, which stores the four characters
 * verbatim because `applyJson` only stringifies objects (CCL-07).
 */
export function parseCustomValues(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const v: unknown = JSON.parse(json);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * A column's `options` blob. Routed through the same normalisation as the event-type and
 * project-status settings: it casts nothing, coerces the legacy plain-string form, skips
 * entries without a usable value and supplies the fallback colour.
 *
 * The cast this replaces was the problem — an option missing `color` (a legacy season, a
 * hand-edited or imported database) reached `contrastText(opt.color)` in PillSelect, where
 * `hexToRgb(undefined)` calls `undefined.replace()` and throws *during render* (CCL-07).
 */
export function parseColumnOptions(json: string | null | undefined): CustomColumnOption[] {
  if (!json) return [];
  try {
    return normalizeSelectOptions(JSON.parse(json));
  } catch {
    return [];
  }
}

/**
 * How many rows still hold each option value, counted server-side over *every* row — trashed
 * and archived ones included, because those come back and a guard that can't see them lets a
 * category be deleted out from under them. Read through `useOptionUsage()`.
 */
export interface OptionUsage {
  event_types: Record<string, number>;
  project_statuses: Record<string, number>;
  link_categories: Record<string, number>;
  task_status: Record<string, number>;
  task_priority: Record<string, number>;
  /** Column id → value → count, scanned out of the `tasks.custom_values` blobs. */
  custom_columns: Record<string, Record<string, number>>;
}

/** Which store a bulk option rewrite targets. Matches the server's allowlist. */
export type ReassignField =
  | 'event_type'
  | 'project_status'
  | 'link_category'
  | 'task_status'
  | 'task_priority'
  | 'custom_column';

/** One „move everything on this value over to that one" step. */
export interface OptionReassign {
  field: ReassignField;
  /** Required for `field: 'custom_column'`. */
  columnId?: ID;
  from: string;
  to: string;
}

/**
 * A task's parsed `custom_values`, cached per row object. **Treat the result as read-only** — it
 * is shared by every reader of that row.
 *
 * Parsing per *access* was quietly quadratic. `makeSortValue` promises O(1) per comparison in its
 * own docstring, but its custom-column branch called `customValueOf`, which re-parsed the whole
 * blob every time — and `sortTasks` calls it twice per comparison, so clicking a custom column
 * header on a 1500–2000 task season ran tens of thousands of `JSON.parse`s of the same strings in
 * one synchronous pass and blocked the main thread for seconds. The cell path paid it again,
 * once per custom column per row per render (TTU-22).
 *
 * Keyed by the row object rather than by the JSON text, so a refetch replaces the rows and the
 * old entries are collected — a string-keyed cache would accumulate every historical blob.
 */
const CUSTOM_VALUE_CACHE = new WeakMap<Task, Record<string, unknown>>();

export function customValues(task: Task): Record<string, unknown> {
  let parsed = CUSTOM_VALUE_CACHE.get(task);
  if (!parsed) {
    parsed = parseCustomValues(task.custom_values);
    CUSTOM_VALUE_CACHE.set(task, parsed);
  }
  return parsed;
}

/** A custom column's value on one task, stringified. Custom values are keyed by column id. */
export function customValueOf(task: Task, colId: ID): string {
  const v = customValues(task)[String(colId)];
  return v == null ? '' : String(v);
}

/**
 * The display order of the task columns: global (built-ins included) before project-scoped,
 * then `sort_order`, then id.
 *
 * `sort_order` alone is not a total order. CustomColumnManager renumbers one scope group from 0
 * — `reorder` sets `sort_order = i` over exactly the ids it is sent, and on a project page that
 * is the project columns only — so a project column and a global column routinely share an
 * ordinal. Every consumer therefore has to apply the same scope-first key, or the live table and
 * the print sheet order the same columns differently (TTU-21).
 */
export function compareColumns(a: CustomColumn, b: CustomColumn): number {
  return (
    (a.scope === 'global' ? 0 : 1) - (b.scope === 'global' ? 0 : 1) ||
    a.sort_order - b.sort_order ||
    a.id - b.id
  );
}

/** The Status column's option flagged `done` — drives gray-out, sink-to-bottom, archiving. */
export function doneValueOf(cols: CustomColumn[]): string {
  const status = cols.find((c) => c.kind === 'builtin' && c.key === 'status');
  return parseColumnOptions(status?.options).find((o) => o.done)?.value ?? 'done';
}
