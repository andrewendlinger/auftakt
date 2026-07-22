import { useMemo } from 'react';
import type { Task } from '../api/types';
import { computeStats, type TaskMetric, type TaskStats } from '../lib/taskStats';
import { useTaskStatsConfig } from '../hooks';

/**
 * Renders the configured task metrics for a set of tasks. `variant="chips"` is the compact,
 * inline form for card footers; `variant="tiles"` is the larger KPI row on the dashboard. Which
 * metrics appear comes from `useTaskStatsConfig()` unless overridden via `metrics`. Nothing is
 * rendered when the user has turned every metric off.
 */
export function TaskStatChips({
  tasks,
  doneValue,
  variant = 'chips',
  metrics: metricsProp,
}: {
  tasks: Task[];
  doneValue: string;
  variant?: 'chips' | 'tiles';
  metrics?: TaskMetric[];
}) {
  const cfg = useTaskStatsConfig();
  const metrics = metricsProp ?? cfg.metrics;
  const stats = useMemo(
    () => computeStats(tasks, doneValue, cfg.windowDays),
    [tasks, doneValue, cfg.windowDays],
  );
  if (metrics.length === 0) return null;

  if (variant === 'tiles') {
    return (
      <div className="flex flex-wrap gap-3">
        {metrics.map((m) => (
          <StatTile key={m} metric={m} stats={stats} />
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
      {metrics.map((m) => (
        <StatChip key={m} metric={m} stats={stats} />
      ))}
    </div>
  );
}

/** Compact inline metric for card footers. */
function StatChip({ metric, stats }: { metric: TaskMetric; stats: TaskStats }) {
  if (metric === 'fortschritt') {
    return (
      <span className="inline-flex items-center gap-1.5">
        <ProgressBar pct={stats.pct} className="w-16" />
        <span className="tabular-nums text-neutral-500">
          {stats.done}/{stats.total} erledigt
        </span>
      </span>
    );
  }
  if (metric === 'offen') {
    return <Pill tone="neutral">{stats.offen} offen</Pill>;
  }
  if (metric === 'ueberfaellig') {
    return stats.ueberfaellig > 0 ? (
      <Pill tone="amber">⚠ {stats.ueberfaellig} überfällig</Pill>
    ) : (
      <Pill tone="muted">0 überfällig</Pill>
    );
  }
  // baldfaellig
  return (
    <Pill tone={stats.baldfaellig > 0 ? 'neutral' : 'muted'}>{stats.baldfaellig} bald fällig</Pill>
  );
}

/** Larger KPI box for the dashboard. */
function StatTile({ metric, stats }: { metric: TaskMetric; stats: TaskStats }) {
  const box = 'flex min-w-28 flex-col gap-1 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-black/5';
  const labelCls = 'text-xs font-medium uppercase tracking-wide text-neutral-400';
  if (metric === 'fortschritt') {
    return (
      <div className={box}>
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-bold tabular-nums text-neutral-800">{stats.pct}%</span>
          <span className="text-xs text-neutral-400 tabular-nums">
            {stats.done}/{stats.total}
          </span>
        </div>
        <ProgressBar pct={stats.pct} className="w-full" />
        <span className={labelCls}>Fortschritt</span>
      </div>
    );
  }
  const map: Record<Exclude<TaskMetric, 'fortschritt'>, { value: number; label: string }> = {
    offen: { value: stats.offen, label: 'Offen' },
    ueberfaellig: { value: stats.ueberfaellig, label: 'Überfällig' },
    baldfaellig: { value: stats.baldfaellig, label: 'Bald fällig' },
  };
  const { value, label } = map[metric];
  const alarm = metric === 'ueberfaellig' && value > 0;
  return (
    <div className={box}>
      <span className={`text-2xl font-bold tabular-nums ${alarm ? 'text-amber-600' : 'text-neutral-800'}`}>
        {alarm ? '⚠ ' : ''}
        {value}
      </span>
      <span className={labelCls}>{label}</span>
    </div>
  );
}

function Pill({ tone, children }: { tone: 'neutral' | 'amber' | 'muted'; children: React.ReactNode }) {
  const cls = {
    neutral: 'bg-neutral-100 text-neutral-600',
    amber: 'bg-amber-100 text-amber-700',
    muted: 'bg-neutral-100 text-neutral-400',
  }[tone];
  return <span className={`rounded-full px-2 py-0.5 font-medium ${cls}`}>{children}</span>;
}

function ProgressBar({ pct, className = '' }: { pct: number; className?: string }) {
  return (
    <span className={`inline-block h-1.5 overflow-hidden rounded-full bg-neutral-200 ${className}`}>
      <span className="block h-full rounded-full bg-neutral-500" style={{ width: `${pct}%` }} />
    </span>
  );
}
