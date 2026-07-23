import { Router } from 'express';
import { getLanding, patchLanding } from '../db';

/**
 * Cross-season landing-page content (Notizen + Dokumente), stored in seasons.json.
 * Deliberately its own mount and not under /api/seasons, where 'landing' would be
 * swallowed by the /:id matchers.
 */
export const landingRouter = Router();

landingRouter.get('/', (_req, res) => {
  res.json(getLanding());
});

landingRouter.patch('/', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Parameters<typeof patchLanding>[0] = {};
  if ('notes' in body) {
    if (body.notes !== null && typeof body.notes !== 'string') {
      return res.status(400).json({ error: 'notes must be string or null' });
    }
    patch.notes = (body.notes as string | null) || null; // '' normalises to null, like InlineNotes
  }
  if ('documents' in body) {
    if (!Array.isArray(body.documents)) {
      return res.status(400).json({ error: 'documents must be an array' });
    }
    const docs: NonNullable<(typeof patch)['documents']> = [];
    for (const raw of body.documents as Array<Record<string, unknown>>) {
      const label = String(raw?.label ?? '').trim();
      if (!label) return res.status(400).json({ error: 'document label required' });
      const url = raw?.url == null ? null : String(raw.url).trim() || null;
      docs.push({ id: typeof raw?.id === 'number' ? raw.id : undefined, label, url });
    }
    patch.documents = docs;
  }
  if ('layout' in body) {
    if (!Array.isArray(body.layout)) {
      return res.status(400).json({ error: 'layout must be an array' });
    }
    const layout: NonNullable<(typeof patch)['layout']> = [];
    for (const raw of body.layout as Array<Record<string, unknown>>) {
      const key = String(raw?.key ?? '').trim();
      if (!key) return res.status(400).json({ error: 'layout key required' });
      layout.push({
        key,
        width: raw?.width === 'half' ? 'half' : 'full',
        ...(raw?.hidden === true ? { hidden: true } : {}),
      });
    }
    patch.layout = layout;
  }
  if ('sections' in body) {
    if (!Array.isArray(body.sections)) {
      return res.status(400).json({ error: 'sections must be an array' });
    }
    const sections: NonNullable<(typeof patch)['sections']> = [];
    for (const raw of body.sections as Array<Record<string, unknown>>) {
      const name = String(raw?.name ?? '').trim();
      if (!name) return res.status(400).json({ error: 'section name required' });
      const value = raw?.value == null ? null : String(raw.value);
      let documents: Array<{ id?: number; label: string; url: string | null }> | undefined;
      if (raw?.documents !== undefined) {
        if (!Array.isArray(raw.documents)) {
          return res.status(400).json({ error: 'section documents must be an array' });
        }
        documents = [];
        for (const doc of raw.documents as Array<Record<string, unknown>>) {
          const label = String(doc?.label ?? '').trim();
          if (!label) return res.status(400).json({ error: 'document label required' });
          const url = doc?.url == null ? null : String(doc.url).trim() || null;
          documents.push({ id: typeof doc?.id === 'number' ? doc.id : undefined, label, url });
        }
      }
      sections.push({
        id: typeof raw?.id === 'number' ? raw.id : undefined,
        name,
        type: raw?.type === 'links' ? 'links' : 'text',
        value,
        ...(documents !== undefined ? { documents } : {}),
      });
    }
    patch.sections = sections;
  }
  res.json(patchLanding(patch));
});
