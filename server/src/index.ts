import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adoptLegacyBackupConfig, getDb, purgeExpired } from './db';
import { HttpError } from './lib/query';
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
import { usageRouter } from './routes/usage';

const PORT = Number(process.env.AUFTAKT_PORT ?? 4317);

const db = getDb();
// Hard-delete rows soft-deleted more than 30 days ago. Never fatal: a purge blocked by a
// lingering FK reference must not keep the whole app from starting.
try {
  purgeExpired(db);
} catch (err) {
  console.error('purgeExpired failed (continuing without purge):', err);
}
// Lift the backup folder out of the season DBs into the registry (WP-39). Here rather than in
// initDb because it reads *every* season file, and never fatal: without it the app still runs,
// it just has no backup folder — which is the state this repairs, so do not make it fatal.
try {
  adoptLegacyBackupConfig();
} catch (err) {
  console.error('adoptLegacyBackupConfig failed (continuing):', err);
}

const app = express();

// --- X-01: same-origin + loopback guard (replaces app.use(cors())) ---
// Single-user loopback app. The browser is ALWAYS same-origin (dev: Vite proxies
// :5317 -> :4317 server-side; packaged: the renderer IS :4317), so no browser ever
// needs cross-origin access. We therefore REJECT (403) — not merely hide the
// response as the `cors` pkg does — any off-allowlist Origin, and any request whose
// Host is not a loopback name (the DNS-rebinding defense: a rebound page looks
// same-origin to the browser, so only the Host header exposes it).
//
// Threat model: hostile web pages in the user's browser. Local non-browser callers
// (no Origin: Electron main, check-backup, same-origin GET) are trusted — they can
// read the .db off disk regardless. This is not a general auth layer.
const isPackaged = !!process.env.AUFTAKT_CLIENT_DIST;
const CLIENT_DEV_PORT = 5317; // Vite dev server (client/vite.config.ts)

const ALLOWED_ORIGINS = new Set<string>([
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
]);
if (!isPackaged) {
  ALLOWED_ORIGINS.add(`http://localhost:${CLIENT_DEV_PORT}`);
  ALLOWED_ORIGINS.add(`http://127.0.0.1:${CLIENT_DEV_PORT}`);
}
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** Hostname without port; handles bare host, host:port, and [ipv6]:port. */
function hostnameOf(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  if (hostHeader.startsWith('[')) {
    const end = hostHeader.indexOf(']');
    return end === -1 ? null : hostHeader.slice(1, end).toLowerCase();
  }
  const colon = hostHeader.indexOf(':');
  return (colon === -1 ? hostHeader : hostHeader.slice(0, colon)).toLowerCase();
}

app.use((req: Request, res: Response, next: NextFunction) => {
  // 1) DNS-rebinding guard: Host must resolve to a loopback name.
  const host = hostnameOf(req.headers.host);
  if (!host || !LOOPBACK_HOSTS.has(host)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  // 2) Origin allowlist. Absent Origin = trusted local/non-browser caller.
  //    "null" is present -> rejected.
  const origin = req.headers.origin;
  if (origin !== undefined) {
    if (!ALLOWED_ORIGINS.has(origin)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.vary('Origin');
  }
  // 3) Defensive-only: legit clients never preflight (all traffic is same-origin).
  //    Checks run first, so a hostile preflight gets 403, not 204.
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  next();
});

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
app.use('/api/usage', usageRouter);
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
  // Deliberate client errors thrown by handlers (e.g. numParam validation) carry their status.
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
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
