import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Project, Task, TaskPlacement } from '../api/types';
import { descendantsOf } from '../lib/taskTree';
import { Label, Modal, Select } from './fields';
import { Btn } from './ui';
import { useUndo } from './UndoProvider';
import { useAllTasks, useGuardedAction, useInvalidateAll, useSaison } from '../hooks';

/** Select value encoding a move target: the overview, an artist's „Allgemein", or a project. */
function parseTarget(value: string): { artist_id: number | null; project_id: number | null } {
  if (value.startsWith('a')) return { artist_id: Number(value.slice(1)), project_id: null };
  if (value.startsWith('p')) return { artist_id: null, project_id: Number(value.slice(1)) };
  return { artist_id: null, project_id: null };
}

function projectLabel(p: Project): string {
  return p.code ? `${p.code} · ${p.name}` : p.name;
}

/**
 * Move a task — and its whole subtask tree — to any other scope: the overview (no parent),
 * an artist's „Allgemein" list, or a project.
 *
 * The write is one request to `POST /tasks/:id/move`, which resolves the subtree and rewrites it
 * in a single transaction. The scope keys travel together because the tasks CHECK allows at most
 * one of `artist_id`/`project_id`, so splitting them across requests would trip it — and the
 * whole tree travels in one request because splitting *that* is what let a move half-fail with
 * no error and no way back (TTU-03).
 */
export function MoveTaskDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const saison = useSaison();
  const invalidate = useInvalidateAll();
  const guard = useGuardedAction();
  const { pushWithToast } = useUndo();
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: artists = [] } = useQuery({ queryKey: ['artists'], queryFn: () => api.artists.list() });
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: () => api.projects.list() });
  // Live + archived: the page lists are scope 'live', so a done child past ARCHIVE_AFTER_DAYS is
  // missing from the table's rows — collecting descendants there would strand it in the old scope.
  // Soft-deleted rows stay behind by design: they are invisible everywhere but the trash, and a
  // later restore behaves like any other restore-after-edit.
  const { tasks: allTasks, loaded: treeLoaded } = useAllTasks();

  // The whole subtree travels with the task; the server resolves it again for the write, so this
  // is only what the count below promises the user.
  const descendants = useMemo(() => descendantsOf(allTasks, task.id), [allTasks, task.id]);

  const artistName = useMemo(() => new Map(artists.map((a) => [a.id, a.name])), [artists]);

  // The current location is excluded from the picker — moving „nach hier" is meaningless.
  const current =
    task.project_id != null ? `p${task.project_id}` : task.artist_id != null ? `a${task.artist_id}` : 'overview';
  const artistOptions = artists.filter((a) => `a${a.id}` !== current);
  const projectOptions = useMemo(
    () =>
      projects
        .filter((p) => `p${p.id}` !== current)
        .sort(
          (x, y) =>
            (artistName.get(x.artist_id) ?? '').localeCompare(artistName.get(y.artist_id) ?? '') ||
            projectLabel(x).localeCompare(projectLabel(y)),
        ),
    [projects, current, artistName],
  );

  const overviewLabel = `Übersicht — ${saison}`;
  const currentLabel =
    task.project_id != null
      ? (task.project_code ? `${task.project_code} · ` : '') + (task.project_name ?? '')
      : task.artist_id != null
        ? `${task.artist_name ?? artistName.get(task.artist_id) ?? ''} · Allgemein`
        : overviewLabel;
  const targetLabel = (value: string): string => {
    if (value.startsWith('a')) return `${artistName.get(Number(value.slice(1))) ?? ''} · Allgemein`;
    if (value.startsWith('p')) {
      const p = projects.find((x) => x.id === Number(value.slice(1)));
      return p ? projectLabel(p) : '';
    }
    return overviewLabel;
  };

  const n = descendants.length;

  /**
   * One request, one transaction, one failure arm.
   *
   * This used to be `Promise.all` of independent PATCHes with no `catch`, and the caller
   * discards the promise (`void submit()`): a single failed request left part of the tree in
   * the new project and the rest in the old one, showed no error, and never reached the
   * `pushWithToast` below — so there was no „Rückgängig" and no undo entry either, and nothing
   * in the app could put the tree back together (TTU-03).
   */
  const submit = async () => {
    // `parent_id: null` — a move makes the task top-level wherever it lands.
    //
    // The Verschieben button is gated on `row.depth === 0`, and `topLevel` promotes orphans (a
    // subtask whose parent is soft-deleted or archived) to depth 0, so orphans are *exactly* the
    // subtasks a user can move. Leaving `parent_id` pointing at the old parent meant that
    // restoring that parent re-nested the child under it — and a subtask is rendered without its
    // own project badge, on the assumption that it shares its parent's project, so the project
    // the user had just moved it to became invisible in the UI (TTU-30). The revert restores the
    // captured value, so undo still puts an orphan back where it was.
    const to = { ...parseTarget(target), parent_id: null };
    setBusy(true);
    let before: TaskPlacement[] = [];
    const moved = await guard('Die Aufgabe konnte nicht verschoben werden.', async () => {
      before = (await api.tasks.move(task.id, to)).before;
      await invalidate();
    });
    setBusy(false);
    if (!moved) return;

    // The root's prior placement is the whole revert: descendants follow the root's scope, so
    // moving it back takes them with it.
    const prior = before.find((r) => r.id === task.id);
    // One stack entry for the whole tree — per-row useUndoablePatch would fragment Cmd+Z
    // into one child at a time. Stack and toast share the one registration: wiring the
    // toast's Rückgängig to `revert` directly left the entry on the stack afterwards, so the
    // next Cmd+Z re-wrote the already-restored values and swallowed the step the user
    // actually meant to undo (TTU-13).
    if (prior) {
      pushWithToast(
        {
          label: 'Verschieben',
          apply: async () => {
            await api.tasks.move(task.id, to);
            await invalidate();
          },
          revert: async () => {
            await api.tasks.move(task.id, {
              artist_id: prior.artist_id,
              project_id: prior.project_id,
              parent_id: prior.parent_id,
            });
            await invalidate();
          },
        },
        `„${task.title}“ verschoben nach ${targetLabel(target)}`,
      );
    }
    onClose();
  };

  return (
    <Modal
      title="Aufgabe verschieben"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Abbrechen</Btn>
          {/* Disabled until the scope-all list is in — the server resolves the subtree itself, so
              this is about the count below being honest before the user commits. */}
          <Btn variant="primary" disabled={!target || !treeLoaded || busy} onClick={() => void submit()}>
            Verschieben
          </Btn>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-neutral-600">
          „{task.title}“ — aktueller Ort: {currentLabel}.
          {n > 0 &&
            ` ${n} Unteraufgabe${n === 1 ? '' : 'n'} ${n === 1 ? 'wird' : 'werden'} mitverschoben.`}
        </p>
        <div>
          <Label>Verschieben nach</Label>
          <Select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Ziel wählen …</option>
            {current !== 'overview' && <option value="overview">{overviewLabel}</option>}
            {artistOptions.length > 0 && (
              <optgroup label="Künstler (Allgemein)">
                {artistOptions.map((a) => (
                  <option key={a.id} value={`a${a.id}`}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            )}
            {projectOptions.length > 0 && (
              <optgroup label="Projekte">
                {projectOptions.map((p) => (
                  <option key={p.id} value={`p${p.id}`}>
                    {projectLabel(p)}
                    {artistName.has(p.artist_id) ? ` (${artistName.get(p.artist_id)})` : ''}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </div>
        {task.parent_id != null && (
          <p className="text-sm text-amber-700">
            Diese Aufgabe war eine Unteraufgabe. Sie wird beim Verschieben zu einer eigenständigen
            Aufgabe.
          </p>
        )}
        {task.project_id != null && (
          <p className="text-sm text-amber-700">
            Die Zuordnung zum Projekt „{currentLabel}“ geht dabei verloren.{' '}
            <span className="text-neutral-500">
              Werte projektspezifischer Spalten bleiben gespeichert, sind am neuen Ort aber nicht
              sichtbar.
            </span>
          </p>
        )}
      </div>
    </Modal>
  );
}
