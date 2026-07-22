import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/Toast';
import { UndoProvider } from './components/UndoProvider';
import { Dashboard } from './pages/Dashboard';
import { ArtistPage } from './pages/ArtistPage';
import { ProjectPage } from './pages/ProjectPage';
import { ArchivePage } from './pages/ArchivePage';
import { SettingsPage } from './pages/SettingsPage';
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
                <Route index element={<Dashboard />} />
                <Route path="artist/:id" element={<ArtistPage />} />
                <Route path="project/:id" element={<ProjectPage />} />
                <Route path="archiv" element={<ArchivePage />} />
                <Route path="einstellungen" element={<SettingsPage />} />
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
