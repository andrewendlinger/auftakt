// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearWindowSeason,
  consumeSeasonGone,
  getWindowSeason,
  pinFromResponse,
  setWindowSeason,
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
 * seasonGone() navigates, so it needs the same window.location recorder switchSeason does.
 * The module is re-imported per test because the „am I the document being replaced" latch is
 * module state — a shared instance would leak the latch into whatever ran next.
 */
describe('seasonGone', () => {
  const nav: string[] = [];

  beforeEach(() => {
    sessionStorage.clear();
    nav.length = 0;
    vi.resetModules();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { replace: (url: string) => nav.push(url), reload: () => nav.push('reload') },
    });
  });

  it('drops the pin, relays the toast and restarts on the landing page', async () => {
    const fresh = await import('./season');
    fresh.setWindowSeason(3);
    fresh.seasonGone();
    expect(fresh.getWindowSeason()).toBeNull();
    expect(sessionStorage.getItem('auftakt-season-gone')).toBe('1');
    expect(nav).toEqual(['#/', 'reload']);
  });

  it('makes a burst of 410s one reload', async () => {
    const fresh = await import('./season');
    fresh.seasonGone();
    fresh.seasonGone();
    fresh.seasonGone();
    expect(nav).toEqual(['#/', 'reload']);
  });

  it('does not spend the relay flag in the document it is leaving', async () => {
    const fresh = await import('./season');
    fresh.seasonGone();
    // replace('#/') fires a hashchange here, so LandingPage mounts in THIS document and asks.
    // Answering yes spends the flag on a toast the pending reload is about to wipe.
    expect(fresh.consumeSeasonGone()).toBe(false);
    expect(sessionStorage.getItem('auftakt-season-gone')).toBe('1');
    // The reloaded document is a fresh module instance, and it gets the answer.
    vi.resetModules();
    const reloaded = await import('./season');
    expect(reloaded.consumeSeasonGone()).toBe(true);
  });
});

/**
 * switchSeason is the only legal way to change seasons, and what it does when a recovery is
 * already under way decides whether the window lands on the landing page or on a dashboard it
 * cannot explain. jsdom does not implement navigation, so window.location is a recorder — and
 * that recording is the assertion: over a recovery, switchSeason must navigate nowhere.
 */
describe('switchSeason', () => {
  const nav: string[] = [];

  /**
   * A fresh module graph per test. „Am I the document being replaced" is module state, and the
   * mocks are recreated with it, so nothing leaks from one test into the next.
   */
  const load = async () => {
    vi.resetModules();
    const [client, broadcast, season] = await Promise.all([
      import('../api/client'),
      import('./broadcast'),
      import('./season'),
    ]);
    return {
      activate: vi.mocked(client.api.activateSeason),
      broadcast: vi.mocked(broadcast.postBroadcast),
      ...season,
    };
  };

  beforeEach(() => {
    sessionStorage.clear();
    nav.length = 0;
    // resetModules() gives a fresh season module but reuses the mocked ones, so call history
    // outlives it — clear it here or a later test reads an earlier test's broadcast.
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
    const m = await load();
    m.activate.mockResolvedValue({ activeId: 7, activeFile: 's7.db', seasons: [] });
    await m.switchSeason(7);
    expect(m.getWindowSeason()).toBe(7);
    expect(m.activate).toHaveBeenCalledWith(7);
    expect(m.broadcast).toHaveBeenCalledWith({ v: 1, type: 'invalidate' });
    expect(nav).toEqual(['#/dashboard', 'reload']);
  });

  it('keeps the switch when moving the default fails for any other reason', async () => {
    const m = await load();
    m.activate.mockRejectedValue(Object.assign(new Error('kaputt'), { status: 500 }));
    await m.switchSeason(7);
    expect(m.getWindowSeason()).toBe(7);
    expect(m.broadcast).toHaveBeenCalledWith({ v: 1, type: 'invalidate' });
    expect(nav).toEqual(['#/dashboard', 'reload']);
  });

  it('yields when its own activate comes back 410', async () => {
    const m = await load();
    // Exactly what http() does with a 410: run seasonGone(), then throw.
    m.activate.mockImplementation(() => {
      m.seasonGone();
      return Promise.reject(Object.assign(new Error('Saison existiert nicht mehr'), { status: 410 }));
    });
    await m.switchSeason(5);
    // seasonGone's own navigation to the landing page, and nothing after it. A '#/dashboard'
    // here means LandingPage — the only consumer of the relay flag — never mounts (PR50-01).
    expect(nav).toEqual(['#/', 'reload']);
    expect(m.broadcast).not.toHaveBeenCalled();
    expect(m.getWindowSeason()).toBeNull();
  });

  it('yields to a recovery another request started, even when the activate succeeds', async () => {
    const m = await load();
    // A dashboard query 410'd first — the switch is to a season that still exists, so nothing
    // about this call fails. Keying the yield on our own rejection would miss exactly this.
    m.seasonGone();
    nav.length = 0;
    m.activate.mockResolvedValue({ activeId: 2, activeFile: 's2.db', seasons: [] });
    await m.switchSeason(2);
    expect(nav).toEqual([]);
    expect(m.broadcast).not.toHaveBeenCalled();
  });
});
