import { useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { LayoutEntry } from '../api/types';
import { arrayMove, arrayMoveTo } from '../lib/arrays';
import { useDragReorder } from '../lib/dragReorder';
import { Btn } from './ui';
import type { LabelKey } from '../lib/labels';
import { useInvalidateAll, useLabel, useSettings } from '../hooks';

type LayoutKey = 'artist_layout' | 'project_layout';

/**
 * Renders a page's sections in a user-defined layout (order + per-section width),
 * persisted in a settings array of {key,width}. A "Bereiche anordnen" toggle reveals
 * a drag handle (native HTML5 drag-and-drop reorder), ▲/▼ move buttons as a keyboard
 * fallback, and a full/half width toggle. Half-width sections flow into a 2-column grid,
 * so two adjacent halves sit side by side. Unknown/new section keys are appended as full;
 * legacy string[] layouts are read as all-full. Shared by the artist and project pages.
 */
export function SectionArranger({
  layoutKey,
  sections,
  labelKeys,
  fullWidthKeys = [],
}: {
  layoutKey: LayoutKey;
  sections: Record<string, ReactNode>;
  /**
   * Section key → the heading id it is named by, so the strip below shows whatever the user
   * renamed that section's heading to. Stated explicitly rather than derived from
   * `layoutKey`: the project page's `kontakte` section holds two headings, and this picks
   * which of them names the section.
   */
  labelKeys: Record<string, LabelKey>;
  /** Sections that can't be set to half width (always full, no width toggle) — e.g. the task table. */
  fullWidthKeys?: string[];
}) {
  const { data: settings } = useSettings();
  const label = useLabel();
  const invalidate = useInvalidateAll();
  const [arranging, setArranging] = useState(false);

  // `sections` (fresh ReactNodes) and an inline `fullWidthKeys` literal change identity
  // every render, but `order` only depends on their string content — key the memo on
  // stable signatures so it recomputes only when the keys/widths actually change.
  const sectionSig = Object.keys(sections).join('\u0000');
  const fullWidthSig = fullWidthKeys.join('\u0000');

  const order = useMemo<LayoutEntry[]>(() => {
    const known = Object.keys(sections);
    const raw = settings?.[layoutKey];
    const stored: LayoutEntry[] = Array.isArray(raw)
      ? (raw as unknown[]).map((item) =>
          typeof item === 'string'
            ? { key: item, width: 'full' }
            : {
                key: String((item as LayoutEntry).key),
                width: (item as LayoutEntry).width === 'half' ? 'half' : 'full',
              },
        )
      : [];
    const seen = new Set<string>();
    const result: LayoutEntry[] = [];
    for (const e of stored) {
      if (known.includes(e.key) && !seen.has(e.key)) {
        seen.add(e.key);
        result.push(fullWidthKeys.includes(e.key) ? { key: e.key, width: 'full' } : e);
      }
    }
    for (const k of known) {
      if (!seen.has(k)) result.push({ key: k, width: 'full' });
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sectionSig/fullWidthSig capture the only content used
  }, [sectionSig, settings, layoutKey, fullWidthSig]);

  const persist = async (next: LayoutEntry[]) => {
    await api.patchSettings({ [layoutKey]: next });
    await invalidate();
  };

  const move = (key: string, dir: -1 | 1) => {
    const next = arrayMove(order, order.findIndex((e) => e.key === key), dir);
    if (next !== order) void persist(next);
  };

  const toggleWidth = (key: string) => {
    if (fullWidthKeys.includes(key)) return;
    const next = order.map((e) =>
      e.key === key ? { ...e, width: e.width === 'half' ? ('full' as const) : ('half' as const) } : e,
    );
    void persist(next);
  };

  const drag = useDragReorder<string>({
    enabled: arranging,
    onReorder: (fromKey, toKey) => {
      const next = arrayMoveTo(
        order,
        order.findIndex((e) => e.key === fromKey),
        order.findIndex((e) => e.key === toKey),
      );
      if (next !== order) void persist(next);
    },
  });

  return (
    <>
      <div className="flex justify-end">
        <Btn variant="subtle" onClick={() => setArranging((a) => !a)}>
          {arranging ? '✓ Fertig' : '⇅ Bereiche anordnen'}
        </Btn>
      </div>
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
        {order.map((entry, i) => {
          const key = entry.key;
          const canHalf = !fullWidthKeys.includes(key);
          const arrangeCls = arranging
            ? `select-none rounded-2xl p-3 ring-2 ring-dashed ${
                drag.isDropTarget(key) ? 'ring-neutral-600' : 'ring-neutral-300'
              } ${drag.isDragging(key) ? 'opacity-40' : ''}`
            : '';
          return (
            <div
              key={key}
              data-section={key}
              data-width={entry.width}
              className={`${entry.width === 'full' ? 'sm:col-span-2' : ''} ${arrangeCls}`}
              {...drag.itemProps(key)}
            >
              {arranging && (
                <div className="mb-3 flex items-center justify-between rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  <span className="flex items-center gap-2">
                    <span className="cursor-grab text-base leading-none text-neutral-400" title="Zum Verschieben ziehen">
                      ⠿
                    </span>
                    {labelKeys[key] ? label(labelKeys[key]) : key}
                  </span>
                  <span className="flex items-center gap-1">
                    {canHalf && (
                      <button
                        className="rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 hover:bg-neutral-200"
                        title="Breite umschalten"
                        onClick={() => toggleWidth(key)}
                      >
                        {entry.width === 'half' ? '▭ Volle Breite' : '◧ Halbe Breite'}
                      </button>
                    )}
                    <button
                      className="rounded px-2 py-0.5 text-lg leading-none text-neutral-500 hover:bg-neutral-200 disabled:opacity-30"
                      disabled={i === 0}
                      aria-label="nach oben"
                      onClick={() => move(key, -1)}
                    >
                      ▲
                    </button>
                    <button
                      className="rounded px-2 py-0.5 text-lg leading-none text-neutral-500 hover:bg-neutral-200 disabled:opacity-30"
                      disabled={i === order.length - 1}
                      aria-label="nach unten"
                      onClick={() => move(key, 1)}
                    >
                      ▼
                    </button>
                  </span>
                </div>
              )}
              {sections[key]}
            </div>
          );
        })}
      </div>
    </>
  );
}
