import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { announcementQueue, announcementTone, splitSignoff } from '../lib/announcement';
import { APP_VERSION } from '../lib/changelog';
import { registerModalLayer, tabbables, topModalDepth } from './fields';
import { Btn } from './ui';
import { Fireworks } from './Fireworks';
import { Markdown } from './Markdown';

/**
 * „Was ist neu" after an update, and dated announcements from the local configuration (WP-63).
 *
 * **Two triggers, one card.** The version half compares the running build against the last one
 * this installation confirmed and renders the matching `CHANGELOG.md` entries — Windows updates
 * silently through electron-updater, so without it the app changes under the user and nothing
 * ever says what changed. The dated half comes from the registry's `announcements` key, matched
 * server-side (`server/src/lib/announcements.ts`) so the client owns no date logic at all.
 *
 * **It renders `null` unless there is something to show, and on almost every installation there
 * never is.** That is not a nicety: `npm run check:browser` drives a freshly seeded demo
 * database, and an unexpected full-screen overlay there would swallow every click in the gate.
 * A fresh database is a first start, a first start initialises the marker silently, and there is
 * no `announcements` key — so the feature is inert end to end, which the gate asserts.
 *
 * Mounted in `main.tsx` **inside** `<ErrorBoundary>` as a sibling of `<Routes>`: it has to
 * survive navigation (it is not a page), and a defect in it has to land on the German fallback
 * panel rather than in a blank window.
 *
 * Not built on `Modal`, and the reasons are all structural rather than cosmetic: the card has no
 * title bar and no ✕, a canvas layer sits *behind* it, the scrim changes colour with
 * `celebrate`, and it has to render above the toasts (`z-50`) rather than below them at
 * `Modal`'s `z-40`. What it does take from `Modal` is the contract — it registers as a dialog
 * layer, so ⌘F/⌘K stay out (`registerModalLayer`), closes on Escape and on the backdrop, and
 * hands focus to the confirm button.
 */
export function AnnouncementOverlay() {
  /**
   * A one-shot read. `staleTime: Infinity` + no focus refetch on purpose: this is a startup
   * question, and the app-wide `refetchOnWindowFocus` would otherwise re-ask it every time the
   * user came back to the window. Confirming writes the marker, so a genuine refetch would
   * answer the same thing anyway — but only after a round trip in which the card would flash.
   */
  const { data } = useQuery({
    queryKey: ['announcements'],
    queryFn: api.announcements.get,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const cardRef = useRef<HTMLDivElement>(null);
  // mousedown and mouseup must *both* land outside the card, exactly as `Modal` requires: a drag
  // that starts on the message and ends on the backdrop is a text selection, not a dismissal
  // (TTU-17).
  const downOutside = useRef(false);

  /**
   * No canvas when the user has asked for less motion — the card alone, on a slightly lighter
   * scrim (a near-black screen with nothing happening on it reads as a defect).
   *
   * Read live rather than once, because Playwright's `emulateMedia` and the OS setting can both
   * change under a mounted page. Deliberately unrelated to the boot gesture's own
   * reduced-motion escape hatch in `client/index.html`, which every driving script depends on
   * and which nothing here touches.
   */
  const [reduced, setReduced] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const queue = useMemo(
    () => announcementQueue(data, APP_VERSION, dismissed),
    [data, dismissed],
  );
  const current = queue[0] ?? null;

  /**
   * The first start ever: nothing has recorded a version, so record one and say nothing.
   *
   * Someone who has just installed the app needs no list of what used to be different — and the
   * same is true for the release that introduces this mechanism, since „never seen a version"
   * and „installed before the marker existed" are the same state and nothing can tell them
   * apart. From the next update on, the card has a real answer.
   *
   * Failure is silent by design. This is a marker, not the user's data: a failed write costs one
   * unnecessary card on the next start, and a German toast about it at the moment the app opens
   * would be worse than the thing it reports.
   */
  useEffect(() => {
    if (data?.version === null) void api.announcements.seen({ version: APP_VERSION }).catch(() => {});
  }, [data]);

  const dismiss = useCallback(() => {
    if (!current) return;
    setDismissed((prev) => new Set(prev).add(current.id));
    // A version confirms a version; anything else confirms its id, and the server stamps the day.
    const what = current.version !== undefined ? { version: current.version } : { id: current.id };
    void api.announcements.seen(what).catch(() => {});
  }, [current]);

  // A dialog layer for as long as a card is up — see `registerModalLayer`.
  useEffect(() => {
    if (!current) return;
    return registerModalLayer();
  }, [current]);

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, dismiss]);

  /**
   * Tab cycles inside the card, exactly as it does inside a `Modal`.
   *
   * `aria-modal="true"` promises a screen reader that nothing behind this exists; without the
   * cycle a keyboard user still walks straight out of it and lands on a link on the page below,
   * invisible behind a full-screen backdrop. That is the state `Modal`'s own Tab handler exists
   * to prevent, and the body here is Markdown — a link in an announcement is one keystroke away
   * from being the thing focus escapes through.
   *
   * `tabbables` is `Modal`'s, not a second copy. The guard is the same shape too: nothing else
   * can be open above this layer (the shortcuts that open dialogs are gated by `anyModalOpen()`,
   * which this registers with), so a non-zero top means some dialog owns the key and this must
   * keep its hands off.
   */
  useEffect(() => {
    if (!current) return;
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.defaultPrevented || topModalDepth() !== 0) return;
      const card = cardRef.current;
      const active = document.activeElement as HTMLElement | null;
      const loose = !active || active === document.body;
      if (!card || (!loose && !card.contains(active))) return;
      const items = tabbables(card);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (loose || (e.shiftKey ? active === first : active === last)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener('keydown', onTab);
    return () => window.removeEventListener('keydown', onTab);
  }, [current]);

  if (!current) return null;

  const tone = announcementTone(current);
  const { lead, signoff } = splitSignoff(current);
  const celebrate = current.celebrate === true;
  const fireworks = celebrate && !reduced;

  return (
    <div
      // `no-print`, or it prints on page 1 of the Cmd-P sheets. `z-[60]`: the toast layer is at
      // z-50 and was the ceiling until this.
      className="no-print fixed inset-0 z-[60] flex items-center justify-center p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="announcement-title"
      data-announcement={current.id}
      onMouseDown={(e) => {
        // Anywhere outside the card — the scrim and the canvas alike — dismisses it.
        downOutside.current = !cardRef.current?.contains(e.target as Node);
      }}
      onClick={(e) => {
        if (downOutside.current && !cardRef.current?.contains(e.target as Node)) dismiss();
        downOutside.current = false;
      }}
    >
      <div
        aria-hidden="true"
        className={`absolute inset-0 transition-colors duration-500 ${
          celebrate
            ? reduced
              ? // Without the fireworks a near-black screen just looks broken.
                'bg-[rgba(20,23,38,0.80)]'
              : 'bg-[rgba(9,11,20,0.86)]'
            : 'bg-black/30'
        }`}
      />
      {/* Translucent, never opaque: the app has to stay faintly visible behind it so it is
          obvious the user is still inside Auftakt. */}
      {fireworks && <Fireworks />}
      <div
        ref={cardRef}
        // Keyed, so a second queued card remounts: the confirm button's `autoFocus` fires again
        // and a long set of release notes does not open scrolled to where the last one was.
        key={current.id}
        className={`relative flex max-h-[calc(100vh-6rem)] w-[min(32.5rem,100%)] flex-col overflow-y-auto rounded-2xl bg-white px-8 pb-6 pt-8 shadow-[0_24px_70px_rgba(0,0,0,0.28)] ${
          tone.centered ? 'text-center' : ''
        }`}
      >
        {tone.eyebrow && (
          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-neutral-500">
            {tone.eyebrow}
          </p>
        )}
        <h2
          id="announcement-title"
          className="mb-3.5 text-[1.55rem] font-semibold leading-tight tracking-tight text-neutral-900"
        >
          {current.title}
        </h2>
        <Markdown className="announcement-body text-neutral-700">{lead}</Markdown>
        {signoff && <Markdown className="announcement-signoff">{signoff}</Markdown>}
        <div className={`mt-6 flex ${tone.centered ? 'justify-center' : 'justify-end'}`}>
          {/* Focused on open, so the keystroke that reaches the card answers *it* — the rule
              `Modal`'s confirm overlay already follows. */}
          <Btn autoFocus variant="primary" onClick={dismiss} data-announcement-confirm>
            {tone.confirm}
          </Btn>
        </div>
      </div>
      <p
        className={`pointer-events-none absolute inset-x-0 bottom-8 text-center text-[11.5px] ${
          celebrate ? 'text-white/50' : 'text-black/55'
        }`}
      >
        Klick irgendwo oder Esc zum Schließen
      </p>
    </div>
  );
}
