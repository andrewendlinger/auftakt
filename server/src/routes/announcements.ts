import { Router } from 'express';
import { localDay } from '../../../shared/time';
import {
  getAnnouncementState,
  setAnnouncementSeen,
  setAnnouncementVersionSeen,
  storedAnnouncements,
} from '../db';
import { dueAnnouncements, parseAnnouncements } from '../lib/announcements';

/**
 * The announcement feed (WP-63) — a thin read/write pair over `seasons.json`, in the shape of
 * `routes/landing.ts`, which is the other route that owns registry rather than season data.
 *
 * **There is no create.** Dated announcements are hand-installed into the registry's
 * `announcements` key and nothing writes them; the only write here is „this has been seen". That
 * is the whole reason the mechanism is safe to ship inert: an installation without the key gets
 * an empty `dated` list and the client renders nothing at all.
 *
 * The *other* half of the feature — „Was ist neu" after an update — is not carried here. Its
 * text is `CHANGELOG.md`, which is bundled into the client at build time next to the version it
 * belongs to; the server contributes only the marker (`version`), because that is the part that
 * has to survive a season switch and a restore. So this route answers „what has this
 * installation already seen, and what is due today", and the client answers „what does that
 * mean on screen".
 *
 * Mounted under `/api`, so it passes through the season middleware like everything else — the
 * data it reads is season-independent, but the 410 recovery and the season echo are not
 * optional for any client call.
 */
export const announcementsRouter = Router();

export interface AnnouncementFeed {
  /** Last app version whose „Was ist neu" was confirmed; `null` on a first start ever. */
  version: string | null;
  /** Dated announcements due today, already matched server-side. */
  dated: ReturnType<typeof dueAnnouncements>;
}

announcementsRouter.get('/', (_req, res) => {
  const state = getAnnouncementState();
  const feed: AnnouncementFeed = {
    version: state.version,
    // `localDay()` and nowhere else: the client never computes a day, so „today" cannot mean two
    // things (docs/ARCHITECTURE.md, naive local time).
    dated: dueAnnouncements(storedAnnouncements(), state.seen, localDay()),
  };
  res.json(feed);
});

/**
 * „I have seen this."
 *
 * A POST rather than a PATCH on the collection, because it records an event and not a value the
 * caller chose: the *day* is stamped here from `localDay()`, exactly as `tasks.erledigt_am` is
 * stamped server-side rather than trusted from the client (docs/ARCHITECTURE.md, the CRUD
 * factory's `transform`). A client that could name the day could also name yesterday and make a
 * yearly announcement repeat every start.
 *
 * `version` and `id` are independent and either may be sent alone: the changelog card confirms a
 * version, a dated one confirms an id. A body with neither is a no-op rather than an error —
 * this is a marker, and refusing to record nothing helps nobody.
 *
 * **The id is matched against what is stored, and the stored spelling is what gets written.** The
 * marker is a map keyed by id, so an id taken straight from the body would be a property name
 * chosen by the caller; looking it up first means the key is a value this installation's own
 * `seasons.json` carries. It is also the honest semantics — recording „seen" for an announcement
 * nobody made says nothing — and it is what lets a 404 mean something rather than storing junk
 * under a 200.
 */
announcementsRouter.post('/seen', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if ('version' in body) {
    if (typeof body.version !== 'string' || !body.version.trim()) {
      return res.status(400).json({ error: 'version must be a non-empty string' });
    }
    setAnnouncementVersionSeen(body.version.trim());
  }
  if ('id' in body) {
    if (typeof body.id !== 'string' || !body.id.trim()) {
      return res.status(400).json({ error: 'id must be a non-empty string' });
    }
    const wanted = body.id.trim();
    const known = parseAnnouncements(storedAnnouncements()).find((a) => a.id === wanted);
    if (!known) return res.status(404).json({ error: 'no such announcement' });
    setAnnouncementSeen(known.id, localDay());
  }
  const state = getAnnouncementState();
  const feed: AnnouncementFeed = {
    version: state.version,
    dated: dueAnnouncements(storedAnnouncements(), state.seen, localDay()),
  };
  res.json(feed);
});
