// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearWindowSeason,
  consumeSeasonGone,
  getWindowSeason,
  pinFromResponse,
  setWindowSeason,
} from './season';

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
