import { qs } from '../api/client';

export function ExcelButton({ params }: { params: Record<string, string | number | undefined> }) {
  return (
    <a
      href={`/api/export/tasks.xlsx${qs(params)}`}
      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100"
    >
      ⬇ Excel
    </a>
  );
}
