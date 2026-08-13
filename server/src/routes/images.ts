import { createHash } from 'node:crypto';
import { Router } from 'express';
import { getDb } from '../db';

/**
 * Images pasted into flowing text (WP-37): store the bytes, serve the bytes.
 *
 * Deliberately **not** `crudRouter`, for four reasons rather than taste. Its `defaultList` is
 * `SELECT *`, which here would stream every blob in the season as one JSON array. Its `writable`
 * allowlist cannot express „every column is server-computed". Its generated DELETE would be exactly
 * the foot-gun `db.ts` keeps this table out of `DELETE_ORDER` to avoid. And it has no binary
 * response path.
 *
 * There is no list endpoint at all: the only way to reach an image is to already hold its token.
 * That is what makes the missing authentication fine — see the GET handler.
 */
export const imagesRouter = Router();

/** sha256 truncated to 32 hex chars — 128 bits, and the exact shape `imageRef.ts` validates. */
const TOKEN_RE = /^[0-9a-f]{32}$/;

/**
 * Response `Content-Type` comes from this map, never from the stored string.
 *
 * The upload re-encodes through a canvas, so today the value can only ever be `image/jpeg`. The map
 * is here for the path that does not exist yet: the moment an importer writes rows this route did
 * not create, „a stored value becomes a response header" is a live class of bug, and a lookup
 * closes it before there is anything to close.
 */
const SERVEABLE: Record<string, string> = { 'image/jpeg': 'image/jpeg' };

/**
 * One decoded image, 1.5 MB. The client resizes to 1200 px at q0.82 first, which lands at
 * 150–350 KB, so this is a guard at roughly 4× the intended size rather than a working limit —
 * and it keeps a whole request comfortably inside the 4 MB `express.json` cap even after base64's
 * +33 %. Raising that cap instead is the one change that would make it stop meaning anything.
 */
const MAX_IMAGE_BYTES = 1_500_000;

/** JPEG's SOI + marker. The bytes must be what the mime claims before either is stored. */
function isJpeg(buf: Buffer): boolean {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

interface ImageRow {
  token: string;
  mime: string;
  bytes: Buffer;
  byte_size: number;
  width: number | null;
  height: number | null;
}

/**
 * GET /api/images/:token — the bytes.
 *
 * **No authentication, on purpose.** The server binds 127.0.0.1 and the origin guard in `index.ts`
 * rejects any non-loopback `Host` and any off-allowlist `Origin`. An `<img>` load sends no `Origin`
 * at all, so it lands in the same trusted-local arm every other same-origin GET already uses, whose
 * standing justification is that such a caller can read the `.db` off disk anyway.
 *
 * The residual: a hostile page in the user's browser *can* point an `<img>` here, because `<img>`
 * carries no `Origin`. It cannot read the pixels (cross-origin canvas taint), and with a 128-bit
 * content token and no list endpoint it has nothing to enumerate. With a sequential id it would
 * have had a working existence-and-dimensions oracle via `naturalWidth`; that is the third argument
 * for content addressing, and it is why `:token` is validated rather than merely looked up.
 *
 * A missing image is a 404, not a 400, even for a malformed token: a stale reference inside prose
 * is not a client error worth distinguishing, and a 400 reads like an app bug when the honest
 * answer is „that picture is not in this season".
 */
imagesRouter.get('/:token', (req, res) => {
  const token = req.params.token;
  if (!TOKEN_RE.test(token)) return res.status(404).json({ error: 'not found' });

  const row = getDb()
    .prepare('SELECT token, mime, bytes, byte_size, width, height FROM images WHERE token = ?')
    .get(token) as ImageRow | undefined;
  if (!row) return res.status(404).json({ error: 'not found' });

  const contentType = SERVEABLE[row.mime];
  if (!contentType) return res.status(404).json({ error: 'not found' });

  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Belt and braces for the same reason SERVEABLE exists: bytes this route did not create must not
  // be able to become same-origin HTML in a future import path.
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  // `immutable` is honest only because the token is derived from the bytes: the same URL can never
  // mean a different picture, not even after restoring an older backup. Setting ETag ourselves also
  // gets conditional requests — Express computes its own only when none is set, and `req.fresh`
  // reads the one we set.
  res.setHeader('ETag', `"${row.token}"`);
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  if (req.fresh) return res.status(304).end();
  return res.send(row.bytes);
});

/**
 * POST /api/images — store bytes, return the reference the client writes into the Markdown.
 *
 * The **server** returns the URL and the client never builds one for storage, the same ownership
 * the `.xlsx` export has over its `Content-Disposition`. That keeps the stored form — root-relative
 * and season-free — decided in exactly one place.
 */
imagesRouter.post('/', (req, res) => {
  const raw = typeof req.body?.data === 'string' ? req.body.data : '';
  if (!raw) return res.status(400).json({ error: 'Kein Bild empfangen.' });

  // Accept a data URL or bare base64; the client sends what its canvas produced.
  const base64 = raw.startsWith('data:') ? (raw.split(',')[1] ?? '') : raw;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, 'base64');
  } catch {
    return res.status(400).json({ error: 'Bild konnte nicht gelesen werden.' });
  }
  if (!bytes.length) return res.status(400).json({ error: 'Bild konnte nicht gelesen werden.' });
  if (bytes.length > MAX_IMAGE_BYTES) {
    return res.status(400).json({ error: 'Das Bild ist zu groß (max. 1,5 MB).' });
  }
  if (!isJpeg(bytes)) {
    return res.status(400).json({ error: 'Nur JPEG-Bilder werden gespeichert.' });
  }

  const token = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  const width = Number.isInteger(req.body?.width) ? (req.body.width as number) : null;
  const height = Number.isInteger(req.body?.height) ? (req.body.height as number) : null;
  const name = typeof req.body?.name === 'string' ? req.body.name.slice(0, 200) : null;

  // Same bytes twice is one row — one hall plan pasted into five projects is stored once, and a
  // re-upload after an undo finds its own row waiting. Stamps are written explicitly rather than
  // left to the column DEFAULT, per the house rule for a new insert path.
  getDb()
    .prepare(
      `INSERT INTO images (token, mime, bytes, byte_size, width, height, name, created_at, updated_at)
       VALUES (?, 'image/jpeg', ?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
       ON CONFLICT(token) DO NOTHING`,
    )
    .run(token, bytes, bytes.length, width, height, name);

  return res.status(201).json({
    token,
    url: `/api/images/${token}`,
    width,
    height,
    bytes: bytes.length,
  });
});
