import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { DeletedItem } from '../api/types';
import { SectionTitle, Spinner, EmptyState, ErrorState, Btn, Pill } from '../components/ui';
import { ProjectBadge } from '../components/ProjectBadge';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { TextInput, Modal } from '../components/fields';
import { formatDate, daysUntil, dayCount, dayCountDative } from '../lib/dates';
import { cascadeText, TYPE_LABELS } from '../lib/deletedTypes';
import { Markdown } from '../components/Markdown';
import { useGuardedAction, useInvalidateAll, useRetention } from '../hooks';
import { useToast } from '../components/Toast';

function purgeHint(purgeAt: string | null): string {
  // No date means the automatic purge will skip this row for as long as something still
  // references it — say that instead of counting down to a removal that never comes.
  if (purgeAt === null) return ' · bleibt, bis abhängige Einträge entfernt sind';
  const d = daysUntil(purgeAt);
  if (d == null) return '';
  return ` · wird in ${dayCountDative(Math.max(0, d))} endgültig entfernt`;
}

export function ArchivePage() {
  const {
    data: tasks = [],
    isLoading,
    isError: tasksFailed,
    refetch: refetchTasks,
  } = useQuery({
    queryKey: ['archive'],
    queryFn: () => api.tasks.list({ scope: 'archive', order: 'due' }),
  });
  // Own loading/error state, not the tasks query's. The two lists are independent requests, and
  // borrowing the other one's gate made this one lie in both directions (PGS-11).
  const {
    data: deleted = [],
    isLoading: deletedLoading,
    isError: deletedFailed,
    refetch: refetchDeleted,
  } = useQuery({
    queryKey: ['deleted'],
    queryFn: () => api.deleted.list(),
  });
  const [q, setQ] = useState('');
  const { archiveAfterDays, purgeAfterDays } = useRetention();
  const [confirmPurge, setConfirmPurge] = useState<DeletedItem | null>(null);
  const invalidate = useInvalidateAll();
  const guard = useGuardedAction();
  const toast = useToast();

  const needle = q.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!needle) return tasks;
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(needle) ||
        (t.comment ?? '').toLowerCase().includes(needle) ||
        (t.artist_name ?? '').toLowerCase().includes(needle) ||
        (t.project_code ?? '').toLowerCase().includes(needle),
    );
  }, [tasks, needle]);

  // The box sits above both lists and is labelled for the whole Archiv, so it has to filter the
  // trash too — narrowing only the table above left the user scrolling all 40 deleted rows and
  // concluding the search was broken (PGS-22). Matched against the three things the row actually
  // renders: its type word, its label and its sublabel.
  const filteredDeleted = useMemo(() => {
    if (!needle) return deleted;
    return deleted.filter(
      (item) =>
        item.label.toLowerCase().includes(needle) ||
        (item.sublabel ?? '').toLowerCase().includes(needle) ||
        TYPE_LABELS[item.type].one.toLowerCase().includes(needle),
    );
  }, [deleted, needle]);

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
    const ok = await guard(`„${item.label}“ konnte nicht gelöscht werden.`, () =>
      api.deleted.purge(item.type, item.id),
    );
    await invalidate();
    if (ok) toast.show({ message: `„${item.label}“ endgültig gelöscht` });
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
          Erledigte Aufgaben (älter als {dayCount(archiveAfterDays)})
        </SectionTitle>

        {tasksFailed ? (
          // Same class as the trash list below: a failed request must not read as „noch nichts".
          <ErrorState
            title="Archiv konnte nicht geladen werden."
            onRetry={() => void refetchTasks()}
          />
        ) : filtered.length === 0 ? (
          <EmptyState>
            {tasks.length === 0
              ? `Noch nichts archiviert. Erledigte Aufgaben wandern ${dayCount(archiveAfterDays)} nach Abschluss hierher.`
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
                  // Every row here is erledigt, so the whole row carries the treatment the task
                  // table gives a done row (WP-58) — including „Erledigt am" and the comment,
                  // which used to stay black beside a struck-through title. The Zuordnung cell is
                  // deliberately left alone: an artist link and a project badge are where the row
                  // came from and how to get back to it, the same reason the task table does not
                  // grey out its trash can and colour swatch.
                  <tr key={t.id} className="border-b border-neutral-50 align-top text-neutral-400">
                    <td className="px-3 py-2 font-medium line-through">{t.title}</td>
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
                    <td className="whitespace-nowrap px-3 py-2 line-through">
                      {t.erledigt_am ? formatDate(t.erledigt_am) : ''}
                    </td>
                    {/* The strike propagates into the Markdown's block children (p, li,
                        blockquote) — it is only atomic inline boxes it cannot enter. */}
                    <td className="max-w-md px-3 py-2 line-through"><Markdown>{t.comment}</Markdown></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <SectionTitle>Gelöschte Einträge</SectionTitle>
        {deletedLoading ? (
          <Spinner />
        ) : deletedFailed ? (
          <ErrorState
            title="Papierkorb konnte nicht geladen werden."
            hint="Gelöschte Einträge sind weiterhin da — nur die Liste konnte nicht abgerufen werden."
            onRetry={() => void refetchDeleted()}
          />
        ) : filteredDeleted.length === 0 ? (
          <EmptyState>
            {deleted.length === 0
              ? `Papierkorb ist leer. Gelöschte Einträge erscheinen hier und werden nach ${dayCountDative(purgeAfterDays)} automatisch entfernt.`
              : 'Keine Treffer.'}
          </EmptyState>
        ) : (
          <div className="divide-y divide-neutral-50 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
            {filteredDeleted.map((item) => (
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
