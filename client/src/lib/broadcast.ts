/**
 * Cross-window signalling over a BroadcastChannel. With several Electron windows on the same
 * origin, each renderer has its own React Query cache; this is how a write in one window
 * reaches the others (see useInvalidateAll in hooks.ts and the listener in main.tsx).
 *
 * THE SINGLETON IS THE SELF-SUPPRESSION. The spec suppresses delivery only to the posting
 * channel *object* — a second `new BroadcastChannel('auftakt')` in the same window WOULD
 * receive this window's own posts, and an invalidate that echoes back to its sender turns
 * every write into a refetch loop. Post and listen through this module only.
 *
 * Messages are versioned pure signals, never data — the receiver refetches, matching the
 * blanket-invalidation policy. Unknown shapes parse to null so a future schema change
 * degrades to "ignored", not "misread".
 *
 * jsdom (check:markdown, boot.test.ts) has no BroadcastChannel, hence the typeof guard;
 * Chromium and Node (check:unit) both ship it.
 */

export const BROADCAST_CHANNEL = 'auftakt';

export type BroadcastMessage = { v: 1; type: 'invalidate' };

/** undefined = not tried yet, null = unsupported here (jsdom). */
let channel: BroadcastChannel | null | undefined;

function getChannel(): BroadcastChannel | null {
  if (channel === undefined) {
    channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(BROADCAST_CHANNEL);
    // Node's BroadcastChannel keeps the process alive while open; unref (absent in the
    // browser) keeps a leaked channel from hanging `vitest run` forever.
    (channel as { unref?: () => void } | null)?.unref?.();
  }
  return channel;
}

/** Defensive: foreign or future shapes become null, never a throw or a misread. */
export function parseBroadcastMessage(raw: unknown): BroadcastMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as { v?: unknown; type?: unknown };
  if (m.v !== 1) return null;
  if (m.type === 'invalidate') return { v: 1, type: 'invalidate' };
  return null;
}

/** Fire-and-forget; a no-op where BroadcastChannel does not exist. */
export function postBroadcast(msg: BroadcastMessage): void {
  try {
    getChannel()?.postMessage(msg);
  } catch {
    // A channel closed mid-unload throws InvalidStateError; the window is going away.
  }
}

/** Subscribe to parsed, known messages from *other* windows. Returns unsubscribe. */
export function onBroadcast(handler: (msg: BroadcastMessage) => void): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const listener = (ev: MessageEvent) => {
    const msg = parseBroadcastMessage(ev.data);
    if (msg) handler(msg);
  };
  ch.addEventListener('message', listener as EventListener);
  return () => ch.removeEventListener('message', listener as EventListener);
}

/** Close and reset the singleton (tests; harmless anywhere else). */
export function closeBroadcast(): void {
  if (channel) channel.close();
  channel = undefined;
}

/**
 * Leading-edge coalescer with a trailing flush: the first call runs immediately, repeats
 * inside `ms` collapse into one run at the window's end. Cheap insurance against bursts —
 * a drag reorder or rapid settings edits post one invalidate per write.
 */
export function coalesced(fn: () => void, ms: number): () => void {
  let last = 0;
  let pending: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (pending) return;
    const wait = ms - (Date.now() - last);
    if (wait <= 0) {
      last = Date.now();
      fn();
    } else {
      pending = setTimeout(() => {
        pending = null;
        last = Date.now();
        fn();
      }, wait);
    }
  };
}
