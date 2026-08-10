import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { ApiError } from './api/client';
import { reportError } from './lib/errors';
import { signalReady } from './boot';
import { Layout } from './components/Layout';
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
      refetchOnWindowFocus: false,
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
 * Total collapse. A throw *above* ErrorBoundary — in ToastProvider, UndoProvider,
 * QueryClientProvider — unwinds the whole tree, so no effect ever runs and BootReady
 * never gets to speak. React rethrows uncaught render errors to window.onerror, which
 * makes this the last place the boot screen can be told to come down.
 *
 * Revealing a blank window is the right answer here: it is the state the app is actually
 * in, and it leaves DevTools and the reload affordances reachable. Hiding it behind a
 * splash that plays out its full choreography would be worse. An error during boot is
 * also, on its own, a reason not to play a celebratory animation.
 */
window.addEventListener('error', () => signalReady(), { once: true });
window.addEventListener('unhandledrejection', () => signalReady(), { once: true });

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
                  </Route>
                  {/* Under Layout so the header navigation stays reachable from a dead link. */}
                  <Route path="*" element={<NotFound />} />
                </Route>
                <Route path="print/artist/:id" element={<PrintArtist />} />
                <Route path="print/project/:id" element={<PrintProject />} />
              </Routes>
            </ErrorBoundary>
          </HashRouter>
        </UndoProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
