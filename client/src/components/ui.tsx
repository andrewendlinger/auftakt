import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { isNotFound } from '../lib/errors';

export function Card({
  children,
  className = '',
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`rounded-2xl bg-white shadow-sm ring-1 ring-black/5 ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    // `section-title` is a hook for SectionArranger: while a section is being arranged,
    // its strip already names it, so the in-card heading hides to avoid the double title.
    <div className="section-title mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">{children}</h2>
      {right}
    </div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'subtle' | 'danger';
};

export function Btn({ variant = 'subtle', className = '', ...rest }: BtnProps) {
  const styles: Record<string, string> = {
    primary: 'bg-neutral-900 text-white hover:bg-neutral-700',
    ghost: 'text-neutral-600 hover:bg-neutral-100',
    subtle: 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200',
    danger: 'text-red-600 hover:bg-red-50',
  };
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-40 ${styles[variant]} ${className}`}
      {...rest}
    />
  );
}

type IconBtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'danger';
  /** Hit-area size. Default `md` (~32px); `sm` (~28px) for dense rows. */
  size?: 'sm' | 'md';
};

const ICON_BTN_VARIANT: Record<string, string> = {
  default: 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700',
  danger: 'text-neutral-400 hover:bg-red-50 hover:text-red-600',
};

/**
 * Icon-only clickable with a comfortable hit area (the app's icons/glyphs are otherwise
 * tiny and fiddly to click). Children are the glyph or an SVG icon; the wrapper owns the
 * padding, hover background and focus ring.
 */
export function IconButton({
  variant = 'default',
  size = 'md',
  className = '',
  ...rest
}: IconBtnProps) {
  const box = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8';
  return (
    <button
      type="button"
      className={`inline-flex ${box} shrink-0 items-center justify-center rounded-lg leading-none transition disabled:opacity-40 disabled:hover:bg-transparent ${ICON_BTN_VARIANT[variant]} ${className}`}
      {...rest}
    />
  );
}

/** Stacked ▲▼ move-up/down control shared by the column/option/sort reorder lists. */
export function ReorderArrows({
  onUp,
  onDown,
  first,
  last,
}: {
  onUp: () => void;
  onDown: () => void;
  first?: boolean;
  last?: boolean;
}) {
  const cls =
    'rounded px-1 text-xs leading-none text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30 disabled:hover:bg-transparent';
  return (
    <div className="flex flex-col">
      {/* data-arrow lets a caller move focus onto the row's new position after a reorder. */}
      <button type="button" data-arrow="up" className={cls} disabled={first} onClick={onUp} title="Nach oben">
        ▲
      </button>
      <button type="button" data-arrow="down" className={cls} disabled={last} onClick={onDown} title="Nach unten">
        ▼
      </button>
    </div>
  );
}

/**
 * The ⠿ grab handle that arms a drag. Spread `useDragReorder().handleProps(key)` onto it.
 * Hidden until the enclosing `group` is hovered, so it never competes with the row's own
 * content — pass `className="opacity-100"` to pin it visible.
 *
 * `disabled` is for a list that is temporarily not reorderable (the task table under a
 * header-click sort): the handle stays where the user expects it, dimmed and inert, so the row
 * can say *why* it won't move. Pass the reason as `title`.
 */
export function DragHandle({
  className = '',
  disabled = false,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { disabled?: boolean }) {
  return (
    <span
      aria-hidden
      title="Zum Verschieben ziehen"
      className={`select-none leading-none text-neutral-400 transition-opacity ${
        disabled
          ? 'cursor-not-allowed opacity-0 group-hover:opacity-30'
          : 'cursor-grab opacity-0 group-hover:opacity-100 active:cursor-grabbing'
      } ${className}`}
      // A handle is only ever grabbed, never clicked. Swallowing the click keeps a press that
      // didn't turn into a drag from activating whatever encloses it — on a project card that
      // would otherwise navigate into the project.
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      {...rest}
    >
      ⠿
    </span>
  );
}

export function Pill({
  children,
  color,
  bg,
}: {
  children: ReactNode;
  color?: string;
  bg?: string;
}) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ color, background: bg }}
    >
      {children}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-xl bg-neutral-50 px-4 py-6 text-sm text-neutral-400">{children}</div>;
}

/**
 * The counterpart to `EmptyState`: something went wrong, as opposed to there being nothing.
 * Keeping the two visually distinct is the whole point — a failed fetch rendered as an empty
 * list tells the user their data is gone, which is the opposite of the truth.
 */
export function ErrorState({
  title,
  hint,
  onRetry,
}: {
  title: string;
  hint?: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-xl bg-neutral-50 px-4 py-8 text-center">
      <p className="text-sm font-medium text-neutral-700">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-md text-sm text-neutral-400">{hint}</p>}
      {onRetry && (
        <div className="mt-3">
          <Btn onClick={onRetry}>Erneut versuchen</Btn>
        </div>
      )}
    </div>
  );
}

/**
 * The three-way gate every detail page needs once it stops conflating "loading" with "failed":
 * a 404 means the row is gone (retrying will not help), anything else is a request that failed
 * and is worth another go. One line per page instead of the same six copied eight times.
 */
export function LoadError({
  error,
  notFound,
  failed,
  onRetry,
}: {
  error: unknown;
  /** „Künstler nicht gefunden" — the row does not exist (any more). */
  notFound: string;
  /** „Künstler konnte nicht geladen werden." — the request failed. */
  failed: string;
  onRetry?: () => void;
}) {
  return isNotFound(error) ? (
    <ErrorState
      title={notFound}
      hint="Der Eintrag wurde vielleicht gelöscht oder gehört zu einer anderen Saison."
    />
  ) : (
    <ErrorState title={failed} onRetry={onRetry} />
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-16 text-neutral-400">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600" />
    </div>
  );
}
