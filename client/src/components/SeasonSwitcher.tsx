import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { ID } from '../api/types';
import { reloadToDashboard } from '../lib/season';
import {
  useErrorToast,
  useSeasons,
  useSeasonTerm,
} from '../hooks';

/**
 * Quick season switch in the header. Each season is its own SQLite file; switching
 * re-opens that file server-side (no restart) and drops the client cache so the
 * whole app refetches against the newly active season. Anlegen/Umbenennen live on
 * the landing page („Alle …" below), Löschen deliberately only in Einstellungen — the reasoning
 * is in `docs/DECISIONS.md`, „Deleting a record lives inside ✎ Bearbeiten".
 */
export function SeasonSwitcher() {
  const { data } = useSeasons();
  const navigate = useNavigate();
  const term = useSeasonTerm();
  const report = useErrorToast();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  const active = data?.seasons.find((s) => s.id === data.activeId);

  // The dropdown stays open across the await: closing it first meant a rejected activation
  // (server restarting, an unknown id after a restart, a dropped fetch) left the menu gone,
  // the app still on the old season and nothing said — the rejection surfaced only in a
  // console the packaged app has no way to show, and the user carried on entering data into
  // the wrong season (SHL-13). On success the reload takes the menu with it.
  const switchTo = async (id: ID) => {
    if (!data || id === data.activeId) {
      setOpen(false);
      return;
    }
    if (switching) return;
    setSwitching(true);
    try {
      await api.activateSeason(id);
      reloadToDashboard();
    } catch (err) {
      report(err, `${term.singular} konnte nicht gewechselt werden.`);
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
                <span className="w-4 text-neutral-500">{s.id === data.activeId ? '✓' : ''}</span>
                <span className={s.id === data.activeId ? 'font-semibold' : ''}>{s.label}</span>
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
