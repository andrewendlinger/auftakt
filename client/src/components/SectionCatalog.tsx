import type { Task } from '../api/types';
import type { LabelKey } from '../lib/labels';
import { SectionTitle } from './ui';
import { EditableLabel } from './EditableLabel';
import { TaskStatChips } from './TaskStatChips';
import { AttentionList } from './AttentionList';
import { useTaskStatsConfig } from '../hooks';

/**
 * The section catalog's import surface for pages: the spec type and derivation live in
 * `lib/sectionSpecs.ts` so `check:unit` reaches them without React (the `layoutEntries.ts`
 * precedent); this file re-exports them and holds the shared section bodies.
 */
export { arrangerConfig, pickerBuiltins } from '../lib/sectionSpecs';
export type { SectionSpec, ArrangerConfig, HiddenBuiltin } from '../lib/sectionSpecs';

/**
 * The computed sections carry a muted line under their renameable heading saying they fill
 * themselves — a removed „Braucht Aufmerksamkeit" used to be indistinguishable from a list the
 * user forgot to fill (issue #57's report arrived as a missing feature). The line becomes
 * load-bearing in WP-D, when the read-only roll-up sits next to an editable twin.
 */
const HINT_STATS = 'Wird automatisch aus den Aufgaben berechnet.';
const HINT_ATTENTION = 'Wird automatisch befüllt: Überfälliges und bald Fälliges.';

/** „Aufgaben-Statistiken" — the KPI tiles, identical on all three arranger pages until now. */
export function StatsSection({ labelKey, tasks }: { labelKey: LabelKey; tasks: Task[] }) {
  return (
    <section>
      <SectionTitle hint={HINT_STATS}>
        <EditableLabel k={labelKey} />
      </SectionTitle>
      <TaskStatChips tasks={tasks} variant="tiles" />
    </section>
  );
}

/**
 * „Braucht Aufmerksamkeit" — overdue plus everything due within the configured window.
 * Absorbs the `windowDays` lookup: every page called `useTaskStatsConfig()` solely to feed
 * `AttentionList` this one number.
 */
export function AttentionSection({ labelKey, tasks }: { labelKey: LabelKey; tasks: Task[] }) {
  const { windowDays } = useTaskStatsConfig();
  return (
    <section>
      <SectionTitle hint={HINT_ATTENTION}>
        <EditableLabel k={labelKey} />
      </SectionTitle>
      <AttentionList tasks={tasks} windowDays={windowDays} />
    </section>
  );
}
