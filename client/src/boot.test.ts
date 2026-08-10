// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetBootSignalsForTest, signalMounted, signalReady } from './boot';

/**
 * The boot screen in client/index.html is driven entirely by these two signals, and it
 * holds a full-viewport overlay with `#root` inert until it hears one. Every case here
 * is a way the app could otherwise be left covered by a still frame, or revealed twice.
 */
describe('boot signals', () => {
  beforeEach(() => resetBootSignalsForTest());

  it('publishes mounted as both an attribute and an event', () => {
    const heard = vi.fn();
    document.addEventListener('auftakt:mounted', heard);
    signalMounted();
    expect(document.documentElement.dataset.appMounted).toBe('1');
    expect(heard).toHaveBeenCalledTimes(1);
    document.removeEventListener('auftakt:mounted', heard);
  });

  it('does not re-announce a signal it has already sent', () => {
    const heard = vi.fn();
    document.addEventListener('auftakt:mounted', heard);
    signalMounted();
    signalMounted();
    signalMounted();
    expect(heard).toHaveBeenCalledTimes(1);
    document.removeEventListener('auftakt:mounted', heard);
  });

  it('treats ready as implying mounted', () => {
    // The failure paths — a throw above the ErrorBoundary, a caught render error — reach
    // signalReady without a healthy mount ever happening. The overlay listens for
    // mounted to decide whether a click may reveal the app, so it has to hear both.
    const mounted = vi.fn();
    const ready = vi.fn();
    document.addEventListener('auftakt:mounted', mounted);
    document.addEventListener('auftakt:ready', ready);

    signalReady();

    expect(document.documentElement.dataset.appMounted).toBe('1');
    expect(document.documentElement.dataset.appReady).toBe('1');
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledTimes(1);
    document.removeEventListener('auftakt:mounted', mounted);
    document.removeEventListener('auftakt:ready', ready);
  });

  it('sends ready once when the normal path and a failure path both fire', () => {
    // BootReady's idle callback and its data budget can both land, and window.onerror
    // can land on top of either. A second reveal would restart the overlay's fade.
    const ready = vi.fn();
    document.addEventListener('auftakt:ready', ready);
    signalMounted();
    signalReady();
    signalReady();
    expect(ready).toHaveBeenCalledTimes(1);
    document.removeEventListener('auftakt:ready', ready);
  });
});
