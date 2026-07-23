import { Router } from 'express';
import {
  activateSeason,
  copySeasonData,
  createSeason,
  deleteSeason,
  listSeasons,
  reorderSeasons,
  seasonStats,
  setSeasonTerms,
  updateSeason,
  type SeasonPatch,
} from '../db';

export const seasonsRouter = Router();

seasonsRouter.get('/', (_req, res) => {
  res.json(listSeasons());
});

// Separate from GET / on purpose: the header switcher polls the season list on every
// page, and Kennzahlen mean opening every season's DB file — landing-page-only cost.
seasonsRouter.get('/stats', (_req, res) => {
  res.json(seasonStats());
});

seasonsRouter.post('/', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const label = String(body.label ?? '').trim();
  if (!label) return res.status(400).json({ error: 'label required' });
  const season = createSeason(label);
  const copyFrom = Number(body.copyFrom);
  if (copyFrom && !Number.isNaN(copyFrom)) {
    try {
      copySeasonData(season.id, copyFrom, {
        artists: !!body.includeArtists,
        contacts: !!body.includeContacts,
        events: !!body.includeEvents,
        projects: !!body.includeProjects,
        tasks: !!body.includeTasks,
        columns: !!body.includeColumns,
        settings: !!body.includeSettings,
      });
    } catch (err) {
      // The season exists and may be half-populated; deleting it now would be the
      // worse outcome, so hand the failure back and let the user see it.
      console.error('Saison-Kopie fehlgeschlagen:', err);
      return res.status(201).json({ ...season, copyError: (err as Error).message });
    }
  }
  res.status(201).json(season);
});

seasonsRouter.post('/:id/activate', (req, res) => {
  try {
    activateSeason(Number(req.params.id));
    res.json(listSeasons());
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Literal routes before the /:id matchers — PATCH /terms would otherwise be swallowed
// by PATCH /:id (Number('terms') → NaN → a misleading "unknown season" 400).
seasonsRouter.post('/reorder', (req, res) => {
  const ids = (req.body as { ids?: unknown })?.ids;
  if (!Array.isArray(ids) || !ids.every((n) => typeof n === 'number')) {
    return res.status(400).json({ error: 'ids must be a number array' });
  }
  try {
    reorderSeasons(ids);
    res.json(listSeasons());
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

seasonsRouter.patch('/terms', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Parameters<typeof setSeasonTerms>[0] = {};
  if ('season' in body) patch.season = body.season == null ? null : String(body.season).trim() || null;
  if ('seasonPlural' in body) {
    patch.seasonPlural = body.seasonPlural == null ? null : String(body.seasonPlural).trim() || null;
  }
  setSeasonTerms(patch);
  res.json(listSeasons());
});

// Key-presence semantics: a key absent from the body stays untouched. An empty
// subtitle/period clears the override (auto text returns); an empty label is refused.
seasonsRouter.patch('/:id', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: SeasonPatch = {};
  if ('label' in body) {
    const label = String(body.label ?? '').trim();
    if (!label) return res.status(400).json({ error: 'label required' });
    patch.label = label;
  }
  if ('subtitle' in body) patch.subtitle = body.subtitle == null ? null : String(body.subtitle).trim() || null;
  if ('period' in body) patch.period = body.period == null ? null : String(body.period).trim() || null;
  try {
    updateSeason(Number(req.params.id), patch);
    res.json(listSeasons());
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

seasonsRouter.delete('/:id', (req, res) => {
  try {
    deleteSeason(Number(req.params.id));
    res.json(listSeasons());
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
