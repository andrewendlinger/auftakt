import { Router } from 'express';
import { activateSeason, copySeasonData, createSeason, deleteSeason, listSeasons, renameSeason } from '../db';

export const seasonsRouter = Router();

seasonsRouter.get('/', (_req, res) => {
  res.json(listSeasons());
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

seasonsRouter.patch('/:id', (req, res) => {
  const label = String((req.body as { label?: unknown })?.label ?? '').trim();
  if (!label) return res.status(400).json({ error: 'label required' });
  try {
    renameSeason(Number(req.params.id), label);
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
