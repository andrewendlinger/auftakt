import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { SearchResults } from '../api/types';
import { formatDate } from '../lib/dates';
import { findOption } from '../lib/selectOptions';
import { useEventTypeOptions } from '../hooks';

interface Hit {
  key: string;
  group: string;
  label: string;
  sub?: string;
  to: string;
}

function buildHits(r: SearchResults, typeLabel: (value: string) => string): Hit[] {
  const hits: Hit[] = [];
  const parentTo = (projectId: number | null, artistId: number | null): string =>
    projectId ? `/project/${projectId}` : `/artist/${artistId}`;

  for (const a of r.artists) hits.push({ key: `a${a.id}`, group: 'Künstler', label: a.name, to: `/artist/${a.id}` });
  for (const p of r.projects)
    hits.push({
      key: `p${p.id}`,
      group: 'Projekte',
      label: p.code ? `${p.code} · ${p.name}` : p.name,
      to: `/project/${p.id}`,
    });
  for (const t of r.tasks)
    hits.push({
      key: `t${t.id}`,
      group: 'Aufgaben',
      label: t.title,
      sub: t.project_code ?? undefined,
      to: parentTo(t.project_id, t.resolved_artist_id),
    });
  for (const e of r.events)
    hits.push({
      key: `e${e.id}`,
      group: 'Termine',
      label: e.title,
      sub: `${typeLabel(e.type)} · ${formatDate(e.start_at)}`,
      to: parentTo(e.project_id, e.resolved_artist_id),
    });
  for (const c of r.contacts)
    hits.push({
      key: `c${c.id}`,
      group: 'Kontakte',
      label: c.name,
      sub: c.role ?? undefined,
      to: parentTo(c.project_id, c.resolved_artist_id),
    });
  return hits;
}

export function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState('');
  const navigate = useNavigate();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const { data } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.search(debounced),
    enabled: debounced.trim().length >= 2,
  });

  const eventTypes = useEventTypeOptions();
  const hits = data ? buildHits(data, (v) => findOption(eventTypes, v)?.label ?? v) : [];
  const groups = [...new Set(hits.map((h) => h.group))];

  const go = (to: string) => {
    navigate(to);
    setOpen(false);
    setQ('');
  };

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Suchen … (Künstler, Projekte, Aufgaben, Termine, Kontakte)"
        className="w-full rounded-xl border border-white/20 bg-white/15 px-4 py-2 text-sm text-white placeholder:text-white/60 outline-none focus:bg-white/25"
      />
      {open && debounced.trim().length >= 2 && (
        <div className="absolute z-30 mt-1 max-h-96 w-full overflow-y-auto rounded-xl bg-white py-2 text-neutral-800 shadow-xl ring-1 ring-black/10">
          {hits.length === 0 ? (
            <div className="px-4 py-3 text-sm text-neutral-400">Keine Treffer.</div>
          ) : (
            groups.map((g) => (
              <div key={g}>
                <div className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                  {g}
                </div>
                {hits
                  .filter((h) => h.group === g)
                  .map((h) => (
                    <button
                      key={h.key}
                      onClick={() => go(h.to)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-1.5 text-left text-sm hover:bg-neutral-100"
                    >
                      <span className="truncate">{h.label}</span>
                      {h.sub && <span className="shrink-0 text-xs text-neutral-400">{h.sub}</span>}
                    </button>
                  ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
