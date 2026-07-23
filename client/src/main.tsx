import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/Toast';
import { UndoProvider } from './components/UndoProvider';
import { LandingPage } from './pages/LandingPage';
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
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, staleTime: 5_000 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <UndoProvider>
          <HashRouter>
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
              </Route>
              <Route path="print/artist/:id" element={<PrintArtist />} />
              <Route path="print/project/:id" element={<PrintProject />} />
            </Routes>
          </HashRouter>
        </UndoProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
