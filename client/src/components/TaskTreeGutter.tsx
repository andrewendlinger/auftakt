import type { Row } from '@tanstack/react-table';
import { withAlpha } from '../lib/colors';
import { ChevronRightIcon } from './icons';
import { IconButton } from './ui';

/**
 * Geometry of the task table's hierarchy gutter, in px.
 *
 * The gutter is a fixed leading column rendered *outside* TanStack's column model, so nesting
 * always reads at the start of the row. That matters because task columns are user-orderable:
 * an indent applied to the Titel cell lands mid-table whenever Titel isn't first, which looks
 * like a rendering bug rather than hierarchy.
 */
export const TREE = {
  /** Gutter column width. Must stay ≥ the 28px chevron button. */
  width: 40,
  /** X of the vertical rail = horizontal centre of the gutter. */
  spineX: 20,
  /** Y of a connector = centre of the first text line of a `py-2` row. */
  lineY: 18,
  /** Elbow arm length — this is the subtask indent, absorbed entirely by the gutter so that
   *  data columns stay aligned between a parent and its children. */
  stub: 12,
  /** Where a parent's rail starts: below the chevron (pt-1 = 4px + h-7 = 28px). */
  spineTop: 32,
} as const;

/** Tailwind `neutral-300`, as a paintable value for the inline-styled connector lines. */
const DEFAULT_SPINE = 'rgb(212 212 212)';

/**
 * Nesting band for subtask rows, applied as a background *image* rather than a colour so it
 * composites with a task's colour tint and the done background-colour instead of losing to
 * them — the old single-tint fallback chain dropped the nesting cue on any coloured subtask.
 */
export const CHILD_BAND = 'linear-gradient(rgba(0,0,0,0.028), rgba(0,0,0,0.028))';

/** Rail colour for a group, tinted by the parent task's own colour when it has one. */
export function spineColorFor(parentColor: string | null | undefined): string {
  return parentColor ? withAlpha(parentColor, 0.5) : DEFAULT_SPINE;
}

/**
 * Chunk the flat expanded row model into one array per top-level task, so a task and its
 * subtasks can be rendered as a single `<tbody>` and framed as a group. A depth-0 row opens a
 * group; deeper rows join the current one. Order is preserved exactly as TanStack emitted it,
 * so sorting and expansion state are untouched.
 */
export function groupRows<T>(rows: Row<T>[]): Row<T>[][] {
  const groups: Row<T>[][] = [];
  for (const row of rows) {
    if (row.depth === 0 || groups.length === 0) groups.push([row]);
    else groups[groups.length - 1]!.push(row);
  }
  return groups;
}

type TreeKind =
  /** Top-level task that has subtasks: disclosure chevron + rail. */
  | 'parent'
  /** Top-level task without subtasks: no chrome. */
  | 'leaf'
  /** Subtask: ├ or └ connector. */
  | 'child'
  /** The inline "new subtask" composer, which sits inside the group's rail. */
  | 'composer';

/**
 * The leading hierarchy cell. Connectors are 1px CSS boxes rather than Unicode glyphs so they
 * align to the pixel grid and scale with the row instead of with the font.
 *
 * `accentColor` paints the task's own colour bar here (it used to live on the `<tr>`); at x=0
 * it sits clear of the rail at x=20, so a coloured subtask keeps both cues.
 */
export function TreeGutterCell({
  kind,
  expanded = false,
  continues = false,
  spineColor,
  accentColor,
  onToggle,
}: {
  kind: TreeKind;
  expanded?: boolean;
  /** A sibling (or the composer) follows, so the rail runs through this row. */
  continues?: boolean;
  spineColor: string;
  accentColor?: string | null;
  onToggle?: () => void;
}) {
  // `-bottom-px` bridges the 1px collapsed row border; without it the rail looks dashed.
  const line = { background: spineColor, left: TREE.spineX };
  return (
    <td
      className="relative p-0 align-top"
      style={{
        width: TREE.width,
        minWidth: TREE.width,
        ...(accentColor ? { boxShadow: `inset 3px 0 0 0 ${accentColor}` } : null),
      }}
    >
      {kind === 'parent' && (
        <>
          <div className="flex justify-center pt-1">
            <IconButton
              size="sm"
              aria-expanded={expanded}
              title={expanded ? 'Einklappen' : 'Ausklappen'}
              onClick={onToggle}
            >
              <ChevronRightIcon
                className={`h-4 w-4 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
              />
            </IconButton>
          </div>
          {expanded ? (
            <span className="absolute -bottom-px w-px" style={{ ...line, top: TREE.spineTop }} />
          ) : (
            // Collapsed: a clipped stub hinting that something is folded away below.
            <span className="absolute -bottom-px h-1.5 w-px opacity-60" style={line} />
          )}
        </>
      )}

      {(kind === 'child' || kind === 'composer') && (
        <>
          <span
            className={`absolute w-px ${continues ? '-bottom-px' : ''}`}
            style={{ ...line, top: 0, ...(continues ? null : { height: TREE.lineY }) }}
          />
          <span className="absolute h-px" style={{ ...line, top: TREE.lineY, width: TREE.stub }} />
        </>
      )}
    </td>
  );
}
