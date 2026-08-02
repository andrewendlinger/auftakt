import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { DeletedItem, DeletedType } from '../api/types';
import { SectionTitle, Spinner, EmptyState, Btn, Pill } from '../components/ui';
import { ProjectBadge } from '../components/ProjectBadge';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { TextInput, Modal } from '../components/fields';
import { formatDate, daysUntil } from '../lib/dates';
import { Markdown } from '../components/Markdown';
import { useGuardedAction, useInvalidateAll } from '../hooks';
import { useToast } from '../components/Toast';

/** Singular/plural per type — drives the badge and the cascade summary. */
const TYPE_LABELS: Record<DeletedType, { one: string; many: string }> = {
  task: { one: 'Aufgabe', many: 'Aufgaben' },
  event: { one: 'Termin', many: 'Termine' },
  artist: { one: 'Künstler', many: 'Künstler' },
  project: { one: 'Projekt', many: 'Projekte' },
  contact: { one: 'Kontakt', many: 'Kontakte' },
  link: { one: 'Dokument', many: 'Dokumente' },
  section: { one: 'Bereich', many: 'Bereiche' },
  column: { one: 'Spalte', many: 'Spalten' },
};

/** "3 Aufgaben, 1 Termin und 2 Dokumente" from the dependents map. */
function cascadeText(dep: DeletedItem['dependents']): string {
  const parts = (Object.entries(dep.byType) as Array<[DeletedType, number]>)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${n} ${n === 1 ? TYPE_LABELS[t].one : TYPE_LABELS[t].many}`);
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}`;
}

function purgeHint(purgeAt: string | null): string {
  // No date means the automatic purge will skip this row for as long as something still
  // references it — say that instead of counting down to a removal that never comes.
  if (purgeAt === null) return ' · bleibt, bis abhängige Einträge entfernt sind';
  const d = daysUntil(purgeAt);
  if (d == null) return '';
  const n = Math.max(0, d);
  return ` · wird in ${n} Tag${n === 1 ? '' : 'en'} endgültig entfernt`;
}

export function ArchivePage() {
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['archive'],
    queryFn: () => api.tasks.list({ scope: 'archive' }),
  });
  const { data: deleted = [] } = useQuery({
    queryKey: ['deleted'],
    queryFn: () => api.deleted.list(),
  });
  const [q, setQ] = useState('');
  const [confirmPurge, setConfirmPurge] = useState<DeletedItem | null>(null);
  const invalidate = useInvalidateAll();
  const guard = useGuardedAction();
  const toast = useToast();

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return tasks;
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(needle) ||
        (t.comment ?? '').toLowerCase().includes(needle) ||
        (t.artist_name ?? '').toLowerCase().includes(needle) ||
        (t.project_code ?? '').toLowerCase().includes(needle),
    );
  }, [tasks, q]);

  // Guarded like `purge()` below: POST /restore 404s when the row is no longer there, which
  // happens whenever the cached list is stale — purgeExpired() hard-deletes 30-day-old rows on
  // server start, so a list rendered before a restart still offers them. The un-caught version
  // threw past invalidate() and the toast, leaving the row in place with no signal at all, so
  // the user just clicked again (PGS-07).
  const restore = async (item: DeletedItem) => {
    const ok = await guard(`„${item.label}“ konnte nicht wiederhergestellt werden.`, () =>
      api.deleted.restore(item.type, item.id),
    );
    await invalidate();
    if (ok) toast.show({ message: `„${item.label}“ wiederhergestellt` });
  };

  const purge = async (item: DeletedItem) => {
    setConfirmPurge(null);
    try {
      await api.deleted.purge(item.type, item.id);
      await invalidate();
      toast.show({ message: `„${item.label}“ endgültig gelöscht` });
    } catch (e) {
      toast.show({ message: e instanceof ApiError ? e.message : 'Löschen fehlgeschlagen.' });
    }
  };

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-8">
      <Breadcrumbs trail={[{ label: 'Übersicht', to: '/dashboard' }, { label: 'Archiv' }]} />

      <div className="space-y-3">
        <SectionTitle
          right={
            <TextInput
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Archiv durchsuchen…"
              className="w-64"
            />
          }
        >
          Erledigte Aufgaben (älter als 30 Tage)
        </SectionTitle>

        {filtered.length === 0 ? (
          <EmptyState>
            {tasks.length === 0
              ? 'Noch nichts archiviert. Erledigte Aufgaben wandern 30 Tage nach Abschluss hierher.'
              : 'Keine Treffer.'}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-400">
                  <th className="px-3 py-2">Aufgabe</th>
                  <th className="px-3 py-2">Zuordnung</th>
                  <th className="px-3 py-2">Erledigt am</th>
                  <th className="px-3 py-2">Kommentar</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id} className="border-b border-neutral-50 align-top text-neutral-500">
                    <td className="px-3 py-2 font-medium text-neutral-700 line-through">{t.title}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        {t.resolved_artist_id && (
                          <Link to={`/artist/${t.resolved_artist_id}`} className="hover:underline">
                            {t.artist_name}
                          </Link>
                        )}
                        {t.project_id && t.project_code && (
                          <ProjectBadge
                            code={t.project_code}
                            projectId={t.project_id}
                            artistColor={t.artist_color}
                            projectColor={t.project_color}
                            to={`/project/${t.project_id}`}
                          />
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{t.erledigt_am ? formatDate(t.erledigt_am) : ''}</td>
                    <td className="max-w-md px-3 py-2"><Markdown>{t.comment}</Markdown></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <SectionTitle>Gelöschte Items</SectionTitle>
        {deleted.length === 0 ? (
          <EmptyState>
            Papierkorb ist leer. Gelöschte Einträge erscheinen hier und werden nach 30 Tagen automatisch
            entfernt.
          </EmptyState>
        ) : (
          <div className="divide-y divide-neutral-50 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
            {deleted.map((item) => (
              <div key={`${item.type}-${item.id}`} className="flex items-center gap-3 px-4 py-3">
                <Pill bg="#f5f5f5" color="#525252">{TYPE_LABELS[item.type].one}</Pill>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-neutral-700">{item.label}</div>
                  <div className="truncate text-xs text-neutral-400">
                    {item.sublabel && <span>{item.sublabel} · </span>}
                    gelöscht am {formatDate(item.deleted_at)}
                    {purgeHint(item.purge_at)}
                  </div>
                </div>
                <Btn onClick={() => void restore(item)}>Wiederherstellen</Btn>
                <Btn variant="danger" onClick={() => setConfirmPurge(item)}>Endgültig löschen</Btn>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmPurge && (
        <Modal
          title="Endgültig löschen"
          onClose={() => setConfirmPurge(null)}
          footer={
            <>
              <Btn onClick={() => setConfirmPurge(null)}>Abbrechen</Btn>
              <Btn variant="danger" onClick={() => void purge(confirmPurge)}>
                Endgültig löschen
              </Btn>
            </>
          }
        >
          <p className="text-sm text-neutral-600">
            „{confirmPurge.label}“ endgültig löschen? Das kann nicht rückgängig gemacht werden.
          </p>
          {confirmPurge.dependents.total > 0 && (
            <p className="mt-2 text-sm text-neutral-600">
              Löscht auch {cascadeText(confirmPurge.dependents)} unwiderruflich mit.
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
