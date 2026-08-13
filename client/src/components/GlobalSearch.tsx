import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { SearchResults } from '../api/types';
import { formatDate } from '../lib/dates';
import { findOption } from '../lib/selectOptions';
import { useEventTypeOptions } from '../hooks';
import { anyModalOpen } from './fields';

interface Hit {
  key: string;
  group: string;
  label: string;
  sub?: string;
  to: string;
}

function buildHits(r: SearchResults, typeLabel: (value: string) => string): Hit[] {
  const hits: Hit[] = [];
  // A season-wide row has neither parent — the tasks CHECK allows it (migrateTasksAllowGeneral),
  // and the dashboard's „Festival" table is where it lives. Interpolating the null instead produced
  // the route `/artist/null`, which Number()s to NaN, 404s and spun on a blank page (SHL-07).
  const parentTo = (projectId: number | null, artistId: number | null): string => {
    if (projectId) return `/project/${projectId}`;
    return artistId ? `/artist/${artistId}` : '/dashboard';
  };

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
      sub: `${typeLabel(e.type)} · ${e.start_at ? formatDate(e.start_at) : 'Datum offen'}`,
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
  /** Which hit ↑/↓ have walked to. Index into the flat `hits`, which *is* the render order. */
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 200);
    return () => clearTimeout(t);
  }, [q]);

  // A new query is a new list: Enter must open its first hit, not the third one because the
  // previous search had three.
  useEffect(() => setActive(0), [debounced]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  /**
   * ⌘F and ⌘K put the caret in the field, from anywhere.
   *
   * Two keys because they answer two habits: ⌘F is what a hand reaches for („Finden"), and it is
   * free in the packaged app — Electron has no find-in-page, and the app defines no accelerator
   * besides ⌘N (`electron/menu.ts`). ⌘K is what every other tool with a search field uses. On the
   * dev server ⌘F also swallows Chromium's own find bar, which is the price of the mnemonic.
   *
   * A `window` listener rather than a hotkey registry, like `UndoProvider`'s ⌘Z: this component
   * is mounted exactly once, in the app header. Unlike ⌘Z it fires inside text fields — moving
   * to search is precisely what a user in the middle of typing means by it — but never over an
   * open dialog, whose focus it would strand behind the backdrop.
   */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if ((k !== 'f' && k !== 'k') || anyModalOpen()) return;
      e.preventDefault();
      setOpen(true);
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // keepPreviousData because the key changes on every debounced keystroke, and v5 hands back
  // `undefined` for a key it has not seen — so the panel blanked to „Keine Treffer." between
  // „Quar" and „Quart" and the app repeatedly claimed a name the user knows exists does not
  // exist (SHL-21). isFetching covers the one case it cannot: the very first query has no previous
  // data to keep, so the panel stays closed until it answers rather than opening onto „Keine
  // Treffer.".
  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.search(debounced),
    enabled: debounced.trim().length >= 2,
    placeholderData: keepPreviousData,
  });

  const eventTypes = useEventTypeOptions();
  const hits = data ? buildHits(data, (v) => findOption(eventTypes, v)?.label ?? v) : [];
  const groups = [...new Set(hits.map((h) => h.group))];
  const flatIndex = new Map(hits.map((h, i) => [h.key, i]));
  const shown = open && debounced.trim().length >= 2 && (hits.length > 0 || !isFetching);
  // The list shrinks between renders (a narrower query, a slower group arriving), so the stored
  // index is clamped at every read rather than rewritten on every result.
  const at = hits.length ? Math.min(active, hits.length - 1) : -1;
  const activeId = at >= 0 && shown ? `gs-hit-${hits[at]!.key}` : undefined;

  const go = (to: string) => {
    navigate(to);
    setOpen(false);
    setQ('');
  };

  // Keep the walked-to row on screen; the panel scrolls at `max-h-96`.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [at]);

  /**
   * The combobox contract: focus never leaves the field, ↑/↓ move `aria-activedescendant`, Enter
   * opens what they landed on.
   *
   * Moving real focus into the list is the other way to do this and the wrong one here — the
   * field is a *filter*, and every keystroke after ↓ would have to be routed back. That is also
   * why the hits are `tabIndex={-1}`: they used to be the only way in, twenty tab stops behind
   * the field, and now they are neither reachable that way nor in anyone's way.
   */
  const move = (delta: number) => {
    if (!hits.length) return;
    setOpen(true);
    setActive((i) => (Math.min(i, hits.length - 1) + delta + hits.length) % hits.length);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // While an input method is composing, these keys belong to the candidate list.
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(e.key === 'ArrowDown' ? 1 : -1);
    } else if ((e.key === 'Home' || e.key === 'End') && shown && hits.length) {
      e.preventDefault();
      setActive(e.key === 'Home' ? 0 : hits.length - 1);
    } else if (e.key === 'Enter') {
      const hit = shown ? hits[at] : undefined;
      if (!hit) return;
      e.preventDefault();
      go(hit.to);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // First Escape puts the panel away, second clears the query — so the key always does
      // something, and never both at once.
      if (shown) setOpen(false);
      else setQ('');
    }
  };

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <input
        ref={inputRef}
        value={q}
        role="combobox"
        aria-expanded={shown}
        aria-controls="gs-hits"
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Suchen … (Künstler, Projekte, Aufgaben, Termine, Kontakte)"
        className="w-full rounded-xl border border-white/20 bg-white/15 px-4 py-2 text-sm text-white placeholder:text-white/60 outline-none focus:bg-white/25"
      />
      {shown && (
        <div
          ref={listRef}
          id="gs-hits"
          role="listbox"
          className="absolute z-30 mt-1 max-h-96 w-full overflow-y-auto rounded-xl bg-white py-2 text-neutral-800 shadow-xl ring-1 ring-black/10"
        >
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
                  .map((h) => {
                    const i = flatIndex.get(h.key)!;
                    return (
                      <button
                        key={h.key}
                        id={`gs-hit-${h.key}`}
                        role="option"
                        aria-selected={i === at}
                        data-active={i === at}
                        tabIndex={-1}
                        // The mouse moves the same marker the arrows do, so the panel never
                        // shows two highlighted rows and Enter always means what is highlighted.
                        onMouseEnter={() => setActive(i)}
                        onClick={() => go(h.to)}
                        className={`flex w-full items-center justify-between gap-3 px-4 py-1.5 text-left text-sm ${
                          i === at ? 'bg-neutral-100' : ''
                        }`}
                      >
                        <span className="truncate">{h.label}</span>
                        {h.sub && <span className="shrink-0 text-xs text-neutral-400">{h.sub}</span>}
                      </button>
                    );
                  })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
