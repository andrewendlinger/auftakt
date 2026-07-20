import type {
  Artist,
  Contact,
  CustomColumn,
  Dashboard,
  EventItem,
  ID,
  LinkItem,
  Project,
  SearchResults,
  Season,
  SeasonList,
  Settings,
  Task,
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

function qs(params?: Record<string, unknown>): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
}

function resource<T, Create = Partial<T>, Update = Partial<T>>(path: string) {
  return {
    list: (params?: Record<string, unknown>) => http<T[]>('GET', path + qs(params)),
    get: (id: ID) => http<T>('GET', `${path}/${id}`),
    create: (data: Create) => http<T>('POST', path, data),
    update: (id: ID, data: Update) => http<T>('PATCH', `${path}/${id}`, data),
    remove: (id: ID) => http<{ id: ID; deleted: boolean }>('DELETE', `${path}/${id}`),
    restore: (id: ID) => http<T>('POST', `${path}/${id}/restore`),
  };
}

export const api = {
  dashboard: () => http<Dashboard>('GET', '/dashboard'),
  search: (q: string) => http<SearchResults>('GET', `/search${qs({ q })}`),
  getSettings: () => http<Settings>('GET', '/settings'),
  patchSettings: (patch: Partial<Settings>) => http<Settings>('PATCH', '/settings', patch),

  artists: resource<Artist>('/artists'),
  projects: resource<Project>('/projects'),
  contacts: resource<Contact>('/contacts'),
  events: resource<EventItem>('/events'),
  tasks: resource<Task>('/tasks'),
  links: resource<LinkItem>('/links'),
  customColumns: resource<CustomColumn>('/custom-columns'),

  duplicateEvent: (id: ID) => http<EventItem>('POST', `/events/${id}/duplicate`),

  seasons: () => http<SeasonList>('GET', '/seasons'),
  createSeason: (
    label: string,
    opts?: { copyFrom?: ID; includeProjects?: boolean; includeTasks?: boolean },
  ) => http<Season>('POST', '/seasons', { label, ...opts }),
  activateSeason: (id: ID) => http<SeasonList>('POST', `/seasons/${id}/activate`),
  renameSeason: (id: ID, label: string) => http<SeasonList>('PATCH', `/seasons/${id}`, { label }),
  deleteSeason: (id: ID) => http<SeasonList>('DELETE', `/seasons/${id}`),
};
