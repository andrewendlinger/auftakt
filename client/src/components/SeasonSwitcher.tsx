import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ID } from '../api/types';
import { switchSeason } from '../lib/season';
import {
  useCurrentSeasonId,
  useSeasons,
  useSeasonTerm,
} from '../hooks';

/**
 * Quick season switch in the header. Window-local: each season is its own SQLite file and
 * each window pins its own (lib/season.ts), so switching repins THIS window and reloads it —
 * other windows keep the season they show. Anlegen/Umbenennen live on the landing page
 * („Alle …" below), Löschen deliberately only in Einstellungen — the reasoning is in
 * `docs/DECISIONS.md`, „Deleting a record lives inside ✎ Bearbeiten".
 */
export function SeasonSwitcher() {
  const { data } = useSeasons();
  const currentId = useCurrentSeasonId();
  const navigate = useNavigate();
  const term = useSeasonTerm();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  const active = data?.seasons.find((s) => s.id === currentId);

  // The dropdown stays open across the await and the reload takes it away. switchSeason
  // cannot leave the app silently on the old season (the pin IS the switch — SHL-13's
  // failure mode is gone); the finally is defence in depth so a throw could never leave
  // the whole header dead (the PGS-03 class).
  const switchTo = async (id: ID) => {
    if (!data || id === currentId) {
      setOpen(false);
      return;
    }
    if (switching) return;
    setSwitching(true);
    try {
      await switchSeason(id);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-0.5 text-sm text-white/80 transition hover:bg-white/20"
        title={`${term.singular} wechseln`}
      >
        {active?.label ?? term.singular}
        <span className="text-[9px] opacity-70">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-40 mt-2 w-64 rounded-xl bg-white p-1 text-neutral-800 shadow-xl ring-1 ring-black/10">
            <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
              {term.singular}
            </div>
            {data?.seasons.map((s) => (
              <button
                key={s.id}
                disabled={switching}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-neutral-100 disabled:opacity-50"
                onClick={() => switchTo(s.id)}
              >
                <span className="w-4 text-neutral-500">{s.id === currentId ? '✓' : ''}</span>
                <span className={s.id === currentId ? 'font-semibold' : ''}>{s.label}</span>
              </button>
            ))}
            <div className="my-1 border-t border-neutral-100" />
            <button
              className="w-full rounded-lg px-3 py-1.5 text-left text-sm text-neutral-600 hover:bg-neutral-100"
              onClick={() => {
                setOpen(false);
                navigate('/');
              }}
            >
              {`Alle ${term.plural}…`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
