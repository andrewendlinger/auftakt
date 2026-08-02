import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { ApiError } from './api/client';
import { reportError } from './lib/errors';
import { Layout } from './components/Layout';
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
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
