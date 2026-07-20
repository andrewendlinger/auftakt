import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/Toast';
import { Dashboard } from './pages/Dashboard';
import { ArtistPage } from './pages/ArtistPage';
import { ProjectPage } from './pages/ProjectPage';
import { ArchivePage } from './pages/ArchivePage';
import { SettingsPage } from './pages/SettingsPage';
import { PrintArtist } from './pages/PrintArtist';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, staleTime: 5_000 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
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
          </Routes>
        </HashRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
