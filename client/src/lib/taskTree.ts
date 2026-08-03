import type { ID, Task } from '../api/types';

/**
 * Every descendant of `rootId`, breadth-first — the client-side mirror of the server's
 * `liveSubtreeIds` (server/src/routes/entities.ts), which is what the subtree endpoints act on.
 *
 * Feed it a `scope: 'all'` list. The page tables are `scope: 'live'`, which hides done tasks past
 * `ARCHIVE_AFTER_DAYS`, and the table's own `childrenByParent` map is one level deep — so both
 * miss exactly the rows a subtree operation must not leave behind. Deriving the delete's child
 * list from the rendered table is how „+ N Unteraufgaben löschen" undercounted and stranded an
 * archived child under a soft-deleted parent: a row that stayed in „Archiv" for ever, that no
 * delete affordance could reach, and that `purgeExpired()` never touched because it was never
 * soft-deleted (TTU-05).
 *
 * The `seen` set bounds the walk, so a cycle in imported data cannot hang the render.
 */
export function descendantsOf(tasks: Task[], rootId: ID): Task[] {
  const byParent = new Map<ID, Task[]>();
  for (const t of tasks) {
    if (t.parent_id == null) continue;
    const arr = byParent.get(t.parent_id);
    if (arr) arr.push(t);
    else byParent.set(t.parent_id, [t]);
  }
  const out: Task[] = [];
  const seen = new Set([rootId]);
  const queue: ID[] = [rootId];
  for (let i = 0; i < queue.length; i++) {
    for (const kid of byParent.get(queue[i]!) ?? []) {
      if (seen.has(kid.id)) continue;
      seen.add(kid.id);
      out.push(kid);
      queue.push(kid.id);
    }
  }
  return out;
}
