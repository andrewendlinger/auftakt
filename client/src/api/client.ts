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
  DependentCounts,
  EventCreate,
  EventItem,
  EventUpdate,
  ID,
  ImageUpload,
  ImageUploaded,
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
import { getWindowSeason, pinFromResponse, seasonGone } from '../lib/season';

const BASE = '/api';

export class ApiError extends Error {
  status: number;
  /**
   * The parsed error response, when there was one. `failure()` reads it anyway to find the
   * German `error` string, so keeping it costs nothing and it is what lets a caller act on a
   * rejection rather than only report it: the landing's 409 carries the content the write lost
   * to, so `useLanding().update()` re-applies onto it without a second GET.
   */
  body?: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/**
 * The window's season as a request header — every call out of this module carries it. Unpinned
 * requests send nothing, resolve the server's default and pin from the echo (see applySeason).
 */
function seasonHeader(): Record<string, string> {
  const season = getWindowSeason();
  return season !== null ? { 'x-auftakt-season': String(season) } : {};
}

/**
 * The season half of every response. 410 means this window's season was deleted (410 is
 * reserved for exactly that; row-level misses stay 404): drop the pin and restart on the
 * landing page. No echo to pin from — the middleware rejects before setting it.
 *
 * **Any request that skips this is a request the app cannot recover from.** That was PR50-04:
 * the .xlsx export was a plain `<a href>`, so its 410 arrived as a navigation instead, and the
 * window sat on the raw JSON with no pin cleared and no way back.
 */
function applySeason(res: Response): void {
  if (res.status === 410) seasonGone();
  else pinFromResponse(res.headers.get('x-auftakt-season'));
}

/** A non-ok response as the thrown error, preferring the server's German `error` over the status text. */
async function failure(res: Response): Promise<ApiError> {
  let msg = res.statusText;
  let body: unknown;
  try {
    body = await res.json();
    const j = body as { error?: string };
    if (j?.error) msg = j.error;
  } catch {
    /* ignore */
  }
  return new ApiError(res.status, msg, body);
}

async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...seasonHeader(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  applySeason(res);
  if (!res.ok) throw await failure(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** `attachment; filename="auftakt-aufgaben.xlsx"` → the name, so the server keeps owning it. */
function dispositionName(header: string | null): string | undefined {
  return /filename="?([^";]+)"?/i.exec(header ?? '')?.[1];
}

/**
 * Fetch a file and hand it to the browser's download machinery — the same layer as every other
 * request, on purpose: `seasonHeader()` routes it and `applySeason()` recovers it. The
 * alternative, a plain `<a href>` to the endpoint, cannot send a header and has no recovery at
 * all; a 410 answer is JSON with no `Content-Disposition`, so Chromium renders it and the
 * Electron window — no address bar, no Back, and Reload re-fetches the same `no-store` 410 —
 * is stranded until it is closed (PR50-04).
 */
async function download(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(BASE + path, { headers: seasonHeader() });
  applySeason(res);
  if (!res.ok) throw await failure(res);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = dispositionName(res.headers.get('content-disposition')) ?? fallbackName;
  // Attached before the click: a detached anchor is not reliably actionable, and revoking on
  // the next task rather than inline keeps the URL alive until the download has taken it.
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * The one query-string encoder. Module-private again since the .xlsx export stopped building
 * its own URL: it was the only outside caller, and the second copy it once carried disagreed
 * about which values are droppable (SHL-30). Keep it that way — a URL built out there is a URL
 * built without `seasonHeader()`.
 */
function qs(params?: Record<string, unknown>): string {
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
  /**
   * The task export. A file rather than JSON, but an ordinary member here on purpose — it is
   * `params` the caller varies, never the season, which rides the header like everything else.
   * The filename comes back in `Content-Disposition` (`server/src/routes/export.ts`); the
   * argument is only the fallback.
   */
  exportTasks: (params?: Record<string, unknown>) =>
    download(`/export/tasks.xlsx${qs(params)}`, 'auftakt-aufgaben.xlsx'),
  getSettings: () => http<Settings>('GET', '/settings'),
  patchSettings: (patch: Partial<WritableSettings>) => http<Settings>('PATCH', '/settings', patch),

  /**
   * `dependents` is spread on rather than added to `resource()`: only these two tables have a
   * delete affordance at page level, and the endpoint has no meaning for a leaf table. Counts
   * what a soft delete would *hide*, which is not what the trash's cascade count means — see
   * `DependentCounts`.
   */
  artists: {
    ...resource<Artist, ArtistCreate, ArtistUpdate>('/artists'),
    dependents: (id: ID) => http<DependentCounts>('GET', `/artists/${id}/dependents`),
  },
  projects: {
    ...resource<Project, ProjectCreate, ProjectUpdate>('/projects'),
    dependents: (id: ID) => http<DependentCounts>('GET', `/projects/${id}/dependents`),
  },
  contacts: resource<Contact, ContactCreate, ContactUpdate>('/contacts'),
  events: resource<EventItem, EventCreate, EventUpdate>('/events'),
  tasks: {
    ...resource<Task, TaskCreate, TaskUpdate>('/tasks'),
    /**
     * Move a task and its whole live subtree to another scope, in one server-side transaction.
     * All three placement fields are explicit and always written, so this same call is also the
     * undo: post back the placement the row had in the response's `before` (TTU-03).
     */
    // `sort_order` optional on the way in: omitting it lands the task at the head of its
    // destination, passing the captured one back is how the undo restores the exact slot.
    move: (id: ID, to: Omit<TaskPlacement, 'id' | 'sort_order'> & { sort_order?: number }) =>
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
  /**
   * Store an image for the flowing text (WP-37) and get back the reference to write into the
   * Markdown. The **server** composes that URL; nothing here builds one, so the stored form stays
   * decided in a single place.
   */
  uploadImage: (body: ImageUpload) => http<ImageUploaded>('POST', '/images', body),
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
    /**
     * `rev` names the generation the patch was computed from; the server answers 409 (carrying
     * the current content) instead of overwriting a newer one. Omit it only where there is no
     * generation to name — nothing in the client does, and `useLanding().update()` is the one
     * caller.
     */
    patch: (patch: LandingPatch, rev?: number) =>
      http<LandingContent>('PATCH', '/landing', rev === undefined ? patch : { ...patch, rev }),
  },
};
