import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryCache, QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import './index.css';
import { ApiError } from './api/client';
import { coalesced, onBroadcast } from './lib/broadcast';
import { reportError } from './lib/errors';
import { errorParts, logAppEvent } from './lib/logEvent';
import { signalFailed } from './boot';
import { Layout } from './components/Layout';
import { AnnouncementOverlay } from './components/AnnouncementOverlay';
import { BootReady } from './components/BootReady';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GlobalErrorSurface } from './components/GlobalErrorSurface';
import { ToastProvider } from './components/Toast';
import { UndoProvider } from './components/UndoProvider';
import { LandingPage } from './pages/LandingPage';
import { NotFound } from './pages/NotFound';
import { Dashboard } from './pages/Dashboard';
import { ArtistPage } from './pages/ArtistPage';
import { ProjectPage } from './pages/ProjectPage';
import { ArchivePage } from './pages/ArchivePage';
import {
  SettingsPage,
  SettingsTasksTab,
  SettingsCategoriesTab,
  SettingsDataTab,
  SettingsHelpTab,
} from './pages/SettingsPage';
import { PrintArtist } from './pages/PrintArtist';
import { PrintProject } from './pages/PrintProject';

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    // Only refetches of data already on screen. A first load's failure is the page's own
    // story — it renders an ErrorState with a retry — but a background refetch has no such
    // surface, so a season switch or a stopped server silently left stale rows in place.
    onError: (err, query) => {
      if (query.state.data !== undefined) reportError(err, 'Daten konnten nicht aktualisiert werden.');
    },
  }),
  defaultOptions: {
    queries: {
      // The backstop behind the cross-window broadcast: focusing a window catches anything
      // a missed message left stale. Safe for inline editors since TTU-12/TTU-38 — cells
      // keep their identity across a refetch and drafts seed only on start(), so a
      // background refetch reorders rows at worst, it does not remount an open editor.
      refetchOnWindowFocus: true,
      staleTime: 5_000,
      /**
       * The server is the local Express process, so a 4xx is a definitive answer — retrying it
       * buys nothing and costs the user the wait. React Query's default of three retries at 1s,
       * 2s and 4s turned one stale link (`#/artist/7` for a deleted artist) into four identical
       * failing requests and roughly seven seconds of spinner before the page could react at
       * all (CCL-25). Anything else — a dropped connection, a restarting server — is still
       * worth one retry.
       */
      retry: (count, err) =>
        !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

/**
 * refetchOnWindowFocus above is inert between Electron windows without this: React Query v5
 * listens to `visibilitychange` only, and two windows side by side on two screens are BOTH
 * permanently visible — switching between them never fires it. Feed the manager real
 * window focus as well, which is exactly the multi-window case the flag exists for here.
 *
 * **onFocus passes no argument on purpose.** A boolean routes to the manager's
 * `setFocused(focused)`, which is a no-op when `#focused` already holds that value — and with
 * both windows permanently visible nothing ever sets it back to false, so `handleFocus(true)`
 * was swallowed from the second focus onwards and this whole backstop was dead (#54). No
 * argument runs query-core's unconditional `onFocus()` instead. The `visibilitychange` handler
 * below is the one that legitimately reports a state, so it keeps its boolean.
 */
focusManager.setEventListener((handleFocus) => {
  const onFocus = () => handleFocus();
  const onVisibility = () => handleFocus(document.visibilityState === 'visible');
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisibility);
  };
});

/**
 * The receiving half of cross-window freshness: another window wrote (its
 * useInvalidateAll posted), so this window's cache is stale — invalidate everything, the
 * same blanket policy a local write applies. Module scope, not a component: it needs no
 * hooks, must not double-subscribe under StrictMode, and lives exactly as long as the
 * document (the channel dies with the window; nothing to unsubscribe). Deliberately calls
 * the QueryClient directly rather than useInvalidateAll — re-posting a received invalidate
 * would ping-pong between windows forever. The coalescer collapses bursts (a drag reorder
 * posts one invalidate per dropped row); active queries refetch immediately, the rest just
 * go stale, and a window on another season merely refetches its own season's data — the
 * message is season-agnostic on purpose, and the coalescer is what pays for it (DECISIONS.md,
 * PR50-15).
 */
const invalidate = coalesced(() => void queryClient.invalidateQueries(), 150);

onBroadcast((msg) => {
  if (msg.type === 'invalidate') invalidate();
});

/**
 * The second feed into that same invalidate, and the only signal that comes from *main*:
 * the backup folder is registry-wide, so a pick in any window — or from the Datei menu, or
 * from the first-launch prompt, neither of which has a renderer behind it — changes what
 * every window's Einstellungen should show. Main used to reload all of them, which cost
 * unsaved drafts in windows nobody had touched (PR50-05); this is the non-destructive half
 * the broadcast channel already implements, reached from the other process.
 *
 * Optional-chained twice over: there is no bridge in browser dev, and an older packaged
 * preload would not have this member. The unsubscribe is discarded on purpose — same as
 * onBroadcast above, this listener lives exactly as long as the document.
 */
window.auftakt?.onBackupConfigChanged?.(invalidate);

/**
 * Total collapse. A throw *above* ErrorBoundary — in ToastProvider, UndoProvider,
 * QueryClientProvider — unwinds the whole tree, so no effect ever runs and BootReady
 * never gets to speak. React rethrows uncaught render errors to window.onerror, which
 * makes this the last place the boot screen can be told to come down.
 *
 * Revealing a blank window is the right answer here: it is the state the app is actually
 * in, and it leaves DevTools and the reload affordances reachable. Hiding it behind a
 * splash that plays out its full choreography would be worse. An error during boot is
 * also, on its own, a reason not to play a celebratory animation — which is why this is
 * `signalFailed` and not `signalReady`. The two are the same reveal; only the second one
 * lets the overlay decide it has something to celebrate.
 */
window.addEventListener('error', () => signalFailed(), { once: true });
window.addEventListener('unhandledrejection', () => signalFailed(), { once: true });

/**
 * The same two events a second time, and deliberately not the same two listeners (WP-69e).
 *
 * The pair above belongs to the boot screen: `{once:true}` because there is exactly one reveal
 * to signal, and folding a log call into them would make the *second* failure of a session
 * invisible — which is the one a customer usually reports. These are the log's, so they are
 * permanent and they run for every failure the window sees.
 *
 * Both values are read defensively: `event.error` is whatever was thrown (a string, a DOM
 * exception, `undefined` when Chromium withheld it across origins) and `event.reason` whatever
 * a promise rejected with. `logAppEvent` no-ops without the Electron bridge, so in browser dev
 * — and under `check:browser` — this costs two property reads and nothing else.
 */
window.addEventListener('error', (event) => {
  const { msg, stack } = errorParts(event.error ?? event.message);
  // The source location only when the value carried no stack: a string throw, or the „Script
  // error." Chromium reduces a cross-origin failure to, is otherwise unplaceable — and against
  // a minified bundle a file and a line are the whole of what can be looked up.
  const where = stack || !event.filename ? '' : ` (${event.filename}:${event.lineno})`;
  logAppEvent('window-error', msg + where, stack);
});
window.addEventListener('unhandledrejection', (event) => {
  const { msg, stack } = errorParts(event.reason);
  logAppEvent('unhandled-rejection', msg, stack);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Outside ErrorBoundary on purpose: a route that throws must not unmount the
          component whose job is to reveal the app. */}
      <BootReady />
      <ToastProvider>
        <GlobalErrorSurface />
        <UndoProvider>
          <HashRouter>
            {/* Inside the router (so the fallback's links resolve) and inside ToastProvider
                (so it can still toast), but around the whole tree — a throw anywhere below
                would otherwise unmount everything to a blank window (CCL-08). */}
            <ErrorBoundary>
              <Routes>
                <Route element={<Layout />}>
                  <Route index element={<LandingPage />} />
                  <Route path="dashboard" element={<Dashboard />} />
                  <Route path="artist/:id" element={<ArtistPage />} />
                  <Route path="project/:id" element={<ProjectPage />} />
                  <Route path="archiv" element={<ArchivePage />} />
                  <Route path="einstellungen" element={<SettingsPage />}>
                    <Route index element={<Navigate to="/einstellungen/aufgaben" replace />} />
                    <Route path="aufgaben" element={<SettingsTasksTab />} />
                    <Route path="kategorien" element={<SettingsCategoriesTab />} />
                    <Route path="daten" element={<SettingsDataTab />} />
                    <Route path="hilfe" element={<SettingsHelpTab />} />
                  </Route>
                  {/* Under Layout so the header navigation stays reachable from a dead link. */}
                  <Route path="*" element={<NotFound />} />
                </Route>
                <Route path="print/artist/:id" element={<PrintArtist />} />
                <Route path="print/project/:id" element={<PrintProject />} />
              </Routes>
              {/* A sibling of <Routes>, not a route: it has to survive navigation, and it is not
                  a page. Inside ErrorBoundary so a defect in it lands on the German fallback
                  rather than in a blank window. Renders null unless there is something to
                  announce, which on an installation without a payload is always (WP-63). */}
              <AnnouncementOverlay />
            </ErrorBoundary>
          </HashRouter>
        </UndoProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
