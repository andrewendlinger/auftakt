export function ExcelButton({
  params,
  label = '⬇ Excel',
}: {
  params: Record<string, string | number | undefined>;
  label?: string;
}) {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  const href = `/api/export/tasks.xlsx${qs ? `?${qs}` : ''}`;
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100"
    >
      {label}
    </a>
  );
}
