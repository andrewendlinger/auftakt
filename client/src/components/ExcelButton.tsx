import { useState } from 'react';
import { api } from '../api/client';
import { useGuardedAction } from '../hooks';

export function ExcelButton({ params }: { params: Record<string, string | number | undefined> }) {
  const guard = useGuardedAction();
  const [busy, setBusy] = useState(false);

  // Fetched through api/client rather than opened as an <a href>. Only that layer sends
  // X-Auftakt-Season and only it recovers from the 410 that answers a deleted season — as a
  // navigation, that 410 rendered as raw JSON and stranded the window (PR50-04).
  //
  // Disabled while the request is out because the server builds the workbook synchronously and
  // that freezes every window (DECISIONS.md, „Per-window seasons"): a second click would queue a
  // second freeze with nothing on screen to suggest the first one is still running.
  const run = async () => {
    setBusy(true);
    try {
      await guard('Der Export konnte nicht erstellt werden.', () => api.exportTasks(params));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-default disabled:opacity-60 disabled:hover:bg-emerald-50"
    >
      ⬇ Excel
    </button>
  );
}
