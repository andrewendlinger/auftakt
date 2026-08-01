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

export interface Settings {
  saison: string;
  backup_dir: string | null;
  first_run_done: string;
  /**
   * Coloured options `{ value, label, color }[]` (WP-I). Existing seasons still hold the legacy
   * plain `string[]`, hence the union — always read through `normalizeSelectOptions`
   * (`useEventTypeOptions` / `useProjectStatusOptions`), never off the raw setting.
   */
  event_types: Array<string | CustomColumnOption>;
  project_statuses: Array<string | CustomColumnOption>;
  /** Link categories (WP-P); unset on older seasons. Read via `useLinkCategoryOptions`. */
  link_categories?: Array<string | CustomColumnOption>;
  /** Layout of the project-page sections (termine/kontakte/stats/… + custom widgets) — order, width, hidden. */
  project_layout?: LayoutEntry[];
  /** Layout of the artist-page sections (projekte/termine/kontakte/… + custom widgets) — order, width, hidden. */
  artist_layout?: LayoutEntry[];
  /** Layout of the dashboard sections (artists/events/tasks + custom widgets) — order + width. */
  dashboard_layout?: LayoutEntry[];
  /** Automatic ordering hierarchy for the main task table. */
  task_sort?: TaskSortRule[];
  /** User-renamed headings; only overrides are stored, defaults live in `lib/labels.ts`. */
  labels?: LabelOverride[];
  /** Enabled task-insight metric keys (`TaskMetric`); parsed via `useTaskStatsConfig`. */
  task_stats?: string[];
  /** „Braucht Aufmerksamkeit" window in days, stored as a scalar string. */
  attention_window_days?: string;
  [key: string]: unknown;
}

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

export function parseCustomValues(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function parseColumnOptions(json: string | null | undefined): CustomColumnOption[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as CustomColumnOption[]) : [];
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

/** A custom column's value on one task, stringified. Custom values are keyed by column id. */
export function customValueOf(task: Task, colId: ID): string {
  const v = parseCustomValues(task.custom_values)[String(colId)];
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
