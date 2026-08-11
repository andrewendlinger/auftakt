import { qs } from '../api/client';
import { getWindowSeason } from '../lib/season';

export function ExcelButton({ params }: { params: Record<string, string | number | undefined> }) {
  // A plain <a href> cannot send the X-Auftakt-Season header, so the season rides as
  // ?season= — the query leg of the routing middleware. qs() drops undefined (SHL-30).
  return (
    <a
      href={`/api/export/tasks.xlsx${qs({ ...params, season: getWindowSeason() ?? undefined })}`}
      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100"
    >
      ⬇ Excel
    </a>
  );
}
