import type {
  Artist,
  ArtistCreate,
  ArtistUpdate,
  Contact,
  ContactCreate,
  ContactUpdate,
  CustomColumn,
  CustomColumnCreate,
  CustomColumnUpdate,
  CustomSection,
  CustomSectionCreate,
  CustomSectionUpdate,
  Dashboard,
  DeletedItem,
  DeletedType,
  EventCreate,
  EventItem,
  EventUpdate,
  ID,
  LandingContent,
  LandingPatch,
  LinkCreate,
  LinkItem,
  LinkUpdate,
  OptionReassign,
  OptionUsage,
  Project,
  ProjectCreate,
  ProjectUpdate,
  SearchResults,
  Season,
  SeasonCopyOptions,
  SeasonList,
  SeasonPatch,
  SeasonStatsMap,
  Settings,
  Task,
  TaskCreate,
  TaskPlacement,
  TaskUpdate,
  WritableSettings,
} from './types';

const BASE = '/api';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * The one query-string encoder. Exported because the .xlsx export is a plain `<a href>` rather
 * than a `fetch`, so it builds its URL itself — and had grown a second copy of this that
 * disagreed about which values are droppable (SHL-30). Anything that changes here (array
 * values, repeated keys, `URLSearchParams`) has to reach that link too.
 */
export function qs(params?: Record<string, unknown>): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
}

/**
 * `Create`/`Update` have no defaults on purpose. They used to default to `Partial<T>` — the whole
 * row — so every non-writable column type-checked and was silently dropped by the server's
 * allowlist (CCL-24). Requiring both makes a future one-argument `resource<Foo>()` a compile
 * error rather than a quiet reopening of that hole.
 */
function resource<T, Create, Update>(path: string) {
  return {
    list: (params?: Record<string, unknown>) => http<T[]>('GET', path + qs(params)),
    get: (id: ID) => http<T>('GET', `${path}/${id}`),
    create: (data: Create) => http<T>('POST', path, data),
    update: (id: ID, data: Update) => http<T>('PATCH', `${path}/${id}`, data),
    remove: (id: ID) => http<{ id: ID; deleted: boolean }>('DELETE', `${path}/${id}`),
    restore: (id: ID) => http<T>('POST', `${path}/${id}/restore`),
    /** Renumber sort_order to match `ids`. Only exists server-side where sort_order is writable. */
    reorder: (ids: ID[]) => http<{ ok: true; count: number }>('POST', `${path}/reorder`, { ids }),
  };
}

export const api = {
  dashboard: () => http<Dashboard>('GET', '/dashboard'),
  search: (q: string) => http<SearchResults>('GET', `/search${qs({ q })}`),
  getSettings: () => http<Settings>('GET', '/settings'),
  patchSettings: (patch: Partial<WritableSettings>) => http<Settings>('PATCH', '/settings', patch),

  artists: resource<Artist, ArtistCreate, ArtistUpdate>('/artists'),
  projects: resource<Project, ProjectCreate, ProjectUpdate>('/projects'),
  contacts: resource<Contact, ContactCreate, ContactUpdate>('/contacts'),
  events: resource<EventItem, EventCreate, EventUpdate>('/events'),
  tasks: {
    ...resource<Task, TaskCreate, TaskUpdate>('/tasks'),
    /**
     * Move a task and its whole live subtree to another scope, in one server-side transaction.
     * All three placement fields are explicit and always written, so this same call is also the
     * undo: post back the placement the row had in the response's `before` (TTU-03).
     */
    move: (id: ID, to: Omit<TaskPlacement, 'id'>) =>
      http<{ ids: ID[]; before: TaskPlacement[] }>('POST', `/tasks/${id}/move`, to),
    /**
     * Soft-delete a task and its whole live subtree in one transaction. Answers with the ids it
     * actually took — pass those to `restoreTree` to undo, so a descendant that was already in
     * the Papierkorb is not resurrected along with them (TTU-35).
     */
    removeTree: (id: ID) => http<{ ids: ID[]; deleted: boolean }>('DELETE', `/tasks/${id}/tree`),
    restoreTree: (id: ID, ids: ID[]) =>
      http<{ ids: ID[] }>('POST', `/tasks/${id}/tree/restore`, { ids }),
  },
  links: resource<LinkItem, LinkCreate, LinkUpdate>('/links'),
  customColumns: resource<CustomColumn, CustomColumnCreate, CustomColumnUpdate>('/custom-columns'),
  customSections: resource<CustomSection, CustomSectionCreate, CustomSectionUpdate>('/custom-sections'),

  duplicateEvent: (id: ID) => http<EventItem>('POST', `/events/${id}/duplicate`),

  /** How many rows hold each option value, and the bulk rewrite that lets one be retired. */
  usage: () => http<OptionUsage>('GET', '/usage'),
  reassignOption: (r: OptionReassign) => http<{ ok: true; changed: number }>('POST', '/usage/reassign', r),

  /** The archive's trash: list soft-deleted rows, restore one, or permanently (cascade) purge one. */
  deleted: {
    list: () => http<DeletedItem[]>('GET', '/deleted'),
    restore: (type: DeletedType, id: ID) => http<{ ok: true }>('POST', `/deleted/${type}/${id}/restore`),
    purge: (type: DeletedType, id: ID) =>
      http<{ ok: true; removed: DeletedItem['dependents'] }>('DELETE', `/deleted/${type}/${id}`),
  },

  seasons: () => http<SeasonList>('GET', '/seasons'),
  seasonStats: () => http<SeasonStatsMap>('GET', '/seasons/stats'),
  createSeason: (label: string, opts?: { copyFrom?: ID } & Partial<SeasonCopyOptions>) =>
    http<Season>('POST', '/seasons', {
      label,
      copyFrom: opts?.copyFrom,
      includeArtists: opts?.artists,
      includeContacts: opts?.contacts,
      includeEvents: opts?.events,
      includeProjects: opts?.projects,
      includeTasks: opts?.tasks,
      includeColumns: opts?.columns,
      includeSettings: opts?.settings,
    }),
  activateSeason: (id: ID) => http<SeasonList>('POST', `/seasons/${id}/activate`),
  updateSeason: (id: ID, patch: SeasonPatch) => http<SeasonList>('PATCH', `/seasons/${id}`, patch),
  deleteSeason: (id: ID) => http<SeasonList>('DELETE', `/seasons/${id}`),
  reorderSeasons: (ids: ID[]) => http<SeasonList>('POST', '/seasons/reorder', { ids }),
  updateSeasonTerms: (terms: { season?: string | null; seasonPlural?: string | null }) =>
    http<SeasonList>('PATCH', '/seasons/terms', terms),

  /** Cross-season landing-page content (Notizen, Dokumente, Textfelder, Layout). */
  landing: {
    get: () => http<LandingContent>('GET', '/landing'),
    patch: (patch: LandingPatch) => http<LandingContent>('PATCH', '/landing', patch),
  },
};
