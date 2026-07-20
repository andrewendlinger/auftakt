import { Router } from 'express';
import { activateSeason, copySeasonData, createSeason, deleteSeason, listSeasons, renameSeason } from '../db';

export const seasonsRouter = Router();

seasonsRouter.get('/', (_req, res) => {
  res.json(listSeasons());
});

seasonsRouter.post('/', (req, res) => {
  const body = (req.body ?? {}) as {
    label?: unknown;
    copyFrom?: unknown;
    includeProjects?: unknown;
    includeTasks?: unknown;
  };
  const label = String(body.label ?? '').trim();
  if (!label) return res.status(400).json({ error: 'label required' });
  const season = createSeason(label);
  const copyFrom = Number(body.copyFrom);
  if (copyFrom && !Number.isNaN(copyFrom)) {
    try {
      copySeasonData(season.id, copyFrom, {
        projects: !!body.includeProjects,
        tasks: !!body.includeTasks,
      });
    } catch (err) {
      console.error('Saison-Kopie fehlgeschlagen:', err);
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
