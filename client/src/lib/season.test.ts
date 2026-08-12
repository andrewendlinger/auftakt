// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { postBroadcast } from './broadcast';
import {
  clearWindowSeason,
  consumeSeasonGone,
  getWindowSeason,
  pinFromResponse,
  setWindowSeason,
  switchSeason,
} from './season';

// switchSeason's two collaborators. api/client is mocked rather than fetch-stubbed because the
// interesting input is the *shape of the rejection* http() produces, not the request.
vi.mock('../api/client', () => ({ api: { activateSeason: vi.fn() } }));
vi.mock('./broadcast', () => ({ postBroadcast: vi.fn() }));

/**
 * The pin is what routes every API call of a window to its season (X-Auftakt-Season in
 * api/client.ts), so the failure modes here are all of the silent-wrong-database kind:
 * a garbage pin that reads as a number, an echo overwriting a switch in flight, a stale
 * „Saison gelöscht" flag that toasts on every landing visit. jsdom provides the real
 * sessionStorage; seasonGone()/reloadToDashboard() navigate and are exercised in the
 * browser, not here (jsdom's location.reload is not implemented).
 */
describe('window season pin', () => {
  beforeEach(() => sessionStorage.clear());

  it('round-trips a pin', () => {
    expect(getWindowSeason()).toBeNull();
    setWindowSeason(3);
    expect(getWindowSeason()).toBe(3);
    clearWindowSeason();
    expect(getWindowSeason()).toBeNull();
  });

  it('reads garbage as unpinned', () => {
    for (const junk of ['', 'abc', '1.5', '-2', '0', 'NaN']) {
      sessionStorage.setItem('auftakt-season', junk);
      expect(getWindowSeason()).toBeNull();
    }
  });

  it('pins from the first echo only', () => {
    pinFromResponse('4');
    expect(getWindowSeason()).toBe(4);
    // Already pinned: a later echo (or a stale in-flight response) must not move the pin —
    // that would undo a season switch that happened between request and response.
    pinFromResponse('9');
    expect(getWindowSeason()).toBe(4);
  });

  it('ignores echoes that are absent or garbage', () => {
    pinFromResponse(null);
    pinFromResponse('');
    pinFromResponse('abc');
    pinFromResponse('-1');
    expect(getWindowSeason()).toBeNull();
  });

  it('reports a deleted season exactly once', () => {
    expect(consumeSeasonGone()).toBe(false);
    sessionStorage.setItem('auftakt-season-gone', '1');
    expect(consumeSeasonGone()).toBe(true);
    expect(consumeSeasonGone()).toBe(false);
  });
});

/**
 * switchSeason is the only legal way to change seasons, and its failure branch decides whether
 * a window that clicked a just-deleted season recovers or is left pinned to nothing. jsdom does
 * not implement navigation, so window.location is replaced with a recorder — which is also the
 * assertion: the 410 branch must navigate nowhere, because seasonGone() already did.
 */
describe('switchSeason', () => {
  const activate = vi.mocked(api.activateSeason);
  const broadcast = vi.mocked(postBroadcast);
  const nav: string[] = [];

  beforeEach(() => {
    sessionStorage.clear();
    nav.length = 0;
    vi.clearAllMocks();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        replace: (url: string) => nav.push(url),
        reload: () => nav.push('reload'),
      },
    });
  });

  it('pins, moves the default and reloads', async () => {
    activate.mockResolvedValue({ activeId: 7, activeFile: 's7.db', seasons: [] });
    await switchSeason(7);
    expect(getWindowSeason()).toBe(7);
    expect(activate).toHaveBeenCalledWith(7);
    expect(broadcast).toHaveBeenCalledWith({ v: 1, type: 'invalidate' });
    expect(nav).toEqual(['#/dashboard', 'reload']);
  });

  it('keeps the switch when moving the default fails for any other reason', async () => {
    activate.mockRejectedValue(Object.assign(new Error('kaputt'), { status: 500 }));
    await switchSeason(7);
    expect(getWindowSeason()).toBe(7);
    expect(broadcast).toHaveBeenCalledWith({ v: 1, type: 'invalidate' });
    expect(nav).toEqual(['#/dashboard', 'reload']);
  });

  it('yields to the 410 recovery instead of overriding it', async () => {
    // What http() does before it throws a 410: seasonGone() clears the pin, sets the relay
    // flag and starts a navigation to the landing page.
    activate.mockImplementation(() => {
      clearWindowSeason();
      sessionStorage.setItem('auftakt-season-gone', '1');
      return Promise.reject(Object.assign(new Error('Saison existiert nicht mehr'), { status: 410 }));
    });
    await switchSeason(5);
    // No second navigation: '#/dashboard' here would override '#/' and LandingPage — the only
    // consumer of the flag — would never mount (PR50-01).
    expect(nav).toEqual([]);
    expect(broadcast).not.toHaveBeenCalled();
    // So the recovery state survives for the landing page to pick up, instead of latching and
    // making every later 410 in this window a no-op.
    expect(getWindowSeason()).toBeNull();
    expect(consumeSeasonGone()).toBe(true);
  });
});
