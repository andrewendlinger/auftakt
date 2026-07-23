import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, purgeExpired } from './db';
import {
  artistsRouter,
  contactsRouter,
  customColumnsRouter,
  customSectionsRouter,
  eventsRouter,
  linksRouter,
  projectsRouter,
  tasksRouter,
} from './routes/entities';
import { dashboardRouter } from './routes/dashboard';
import { deletedRouter } from './routes/deleted';
import { searchRouter } from './routes/search';
import { settingsRouter } from './routes/settings';
import { exportRouter } from './routes/export';
import { seasonsRouter } from './routes/seasons';
import { landingRouter } from './routes/landing';
import { backupRouter } from './routes/backup';

const PORT = Number(process.env.AUFTAKT_PORT ?? 4317);

const db = getDb();
// Hard-delete rows soft-deleted more than 30 days ago. Never fatal: a purge blocked by a
// lingering FK reference must not keep the whole app from starting.
try {
  purgeExpired(db);
} catch (err) {
  console.error('purgeExpired failed (continuing without purge):', err);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '4mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.use('/api/artists', artistsRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/contacts', contactsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/links', linksRouter);
app.use('/api/custom-columns', customColumnsRouter);
app.use('/api/custom-sections', customSectionsRouter);
app.use('/api/deleted', deletedRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/search', searchRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/export', exportRouter);
app.use('/api/seasons', seasonsRouter);
app.use('/api/landing', landingRouter);
app.use('/api/backup', backupRouter);

// In the packaged Electron app the server also serves the built client (loaded
// via http://localhost:PORT), so the client's relative /api calls just work.
// The UI uses HashRouter, so only "/" is ever requested — static serving suffices.
const here = dirname(fileURLToPath(import.meta.url));
const clientDist = process.env.AUFTAKT_CLIENT_DIST || resolve(here, '../../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
}

// Map SQLite constraint violations (e.g. the artist-XOR-project CHECKs) to 400s.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const code = (err as { code?: string })?.code;
  const message = (err as { message?: string })?.message ?? 'Internal error';
  if (typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT')) {
    return res.status(400).json({ error: message, code });
  }
  console.error(err);
  res.status(500).json({ error: message });
});

// Bind to loopback only: this is a single-user local app, so there's no reason to
// listen on all interfaces (0.0.0.0) — doing so triggers the Windows Firewall prompt.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Auftakt server listening on http://localhost:${PORT}`);
});
