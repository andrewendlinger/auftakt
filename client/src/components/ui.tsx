import type { ButtonHTMLAttributes, ComponentPropsWithRef, HTMLAttributes, ReactNode } from 'react';
import { withAlpha } from '../lib/colors';
import { isNotFound } from '../lib/errors';
import { openExternal } from '../lib/external';
import { normalizeUrl } from '../lib/url';

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

export function SectionTitle({
  children,
  right,
  hint,
}: {
  children: ReactNode;
  right?: ReactNode;
  hint?: ReactNode;
}) {
  // `section-title` is a hook for SectionArranger: while a section is being arranged,
  // its strip already names it, so the in-card heading hides to avoid the double title.
  // The hint hides with it — it explains content, which is irrelevant while arranging.
  const heading = (
    <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">{children}</h2>
  );
  return (
    <div className="section-title mb-3 flex items-center justify-between gap-3">
      {hint == null ? (
        heading
      ) : (
        // The hint is a sibling of the h2, outside any EditableLabel in `children` — a
        // computed section's "what fills me" line is not renameable, only its heading is.
        <div>
          {heading}
          <div className="mt-0.5 text-xs text-neutral-400">{hint}</div>
        </div>
      )}
      {right}
    </div>
  );
}

// `ComponentPropsWithRef`, not `ButtonHTMLAttributes`: on React 19 a function component takes
// `ref` as an ordinary prop, so this is all it takes to let a caller anchor a popover to a Btn
// (`useAnchoredPopover` focuses `anchorRef` on close, which only works on a real button).
type BtnProps = ComponentPropsWithRef<'button'> & {
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
 *
 * **Faintly visible at rest, full on hover of the enclosing `group`.** It used to be `opacity-0`
 * until hovered, and that is what the customer reported as „kann ich nicht mehr verschieben" about
 * a link list that had been reorderable for two releases (WP-35): an affordance nobody can see is
 * an affordance nobody has. One resting state for every drag surface — a handle that is visible in
 * one list and hidden in the next teaches that some lists cannot be reordered. Pass
 * `className="opacity-100"` to pin it fully visible where the surface is already a drag mode.
 *
 * `disabled` is for a list that is temporarily not reorderable (the task table under a
 * header-click sort): the handle stays where the user expects it, dimmed and inert, so the row
 * can say *why* it won't move. Pass the reason as `title`. It stays *below* the live handle's
 * resting opacity and gains almost nothing on hover, so „inert" reads at a glance and not just
 * from the cursor.
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
          ? 'cursor-not-allowed opacity-20 group-hover:opacity-30'
          : 'cursor-grab opacity-40 group-hover:opacity-100 active:cursor-grabbing'
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

/**
 * One selectable row of a picker list — the „Bereich hinzufügen" modals' option buttons. Both
 * pickers had a character-identical `row`/`rowCls` helper of their own (SHL-29).
 */
export function PickerRow({
  selected = false,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
        selected ? 'border-neutral-500 bg-neutral-50' : 'border-neutral-200 hover:bg-neutral-50'
      }`}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * One row of a document/link list: the 🔗 glyph, the label as an external-link button (or a
 * plain label saying no URL is stored), and the row's actions revealed on hover.
 *
 * Shared because `LinkList` and the landing's `DocList` rendered the same markup down to the
 * Tailwind classes and the German fallback text, differing only in the colour treatment — so
 * every change to link-row presentation had to be made twice and the two drifted (SHL-28).
 * `color` is the links half: it tints the row and paints the left border.
 *
 * `handle`, `notes` and the drag styling are the links half too — the landing's `DocList` stores
 * its documents inside a setting rather than as rows, so it has neither a reorder endpoint nor a
 * column to put a note in. Both are omitted there and the row renders exactly as before.
 */
export function DocumentRow({
  label,
  url,
  color,
  actions,
  handle,
  notes,
  dragging = false,
  dropTarget = false,
  ...rest
}: {
  label: string;
  url: string | null;
  /** Row accent. Landing documents have none, so they keep the plain white card. */
  color?: string | null;
  /** The ✎/🗑 pair (and, for links, the colour swatch) — hidden until the row is hovered. */
  actions?: ReactNode;
  /** The ⠿ grab handle, rendered before the 🔗 glyph. */
  handle?: ReactNode;
  /** Second line under the label — the inline-edited short description. */
  notes?: ReactNode;
  dragging?: boolean;
  dropTarget?: boolean;
  // `color` is omitted from the passthrough: HTMLAttributes has the legacy presentational
  // attribute of that name, and intersecting it narrows our own `string | null` to `string`.
} & Omit<HTMLAttributes<HTMLLIElement>, 'color'>) {
  return (
    <li
      {...rest}
      // items-start, not items-center: with a notes line the glyph and the actions belong on the
      // label's line, not floating to the middle of a two-line row.
      className={`group flex items-start gap-3 rounded-xl px-3 py-2 shadow-sm ring-1 ring-black/5 transition ${
        color ? 'border-l-4' : 'bg-white'
      } ${dropTarget ? 'ring-2 ring-neutral-500' : ''} ${dragging ? 'opacity-40' : ''}`}
      style={color ? { background: withAlpha(color, 0.16), borderLeftColor: color } : undefined}
    >
      {handle}
      <span className="text-neutral-400">🔗</span>
      <div className="min-w-0 flex-1">
        {url ? (
          <button
            className="text-left font-medium text-sky-700 hover:underline"
            // Normalised on the way out, not just on the way in: the field stores what the user
            // typed, and „drive.google.com/…" without a scheme is unparseable, so openExternal
            // refused it and the link could never be opened (CCL-09). Rows written before the
            // save-time normalisation — or by an importer — only have this arm.
            onClick={() => openExternal(normalizeUrl(url))}
          >
            {label}
          </button>
        ) : (
          <span className="font-medium text-neutral-700">
            {label} <span className="text-xs font-normal text-neutral-400">(kein Link hinterlegt)</span>
          </span>
        )}
        {notes}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
        {actions}
      </div>
    </li>
  );
}

/**
 * The link palette. Split out because one of the three sites is *not* an anchor: a Markdown
 * preview rendered inside a clickable card styles its links as plain text so anchors do not nest
 * (`MdLinkText`). `ExternalLink` adds the hover rule on top.
 */
export const EXTERNAL_LINK_CLASS =
  'text-sky-700 underline decoration-sky-300 underline-offset-2 break-words';

/**
 * An anchor that opens in the OS browser or mail client rather than inside the app window — the
 * one implementation of that, for `linkify` and Markdown's `a` alike. Both used to carry a
 * character-for-character copy of the class string and the `preventDefault → openExternal`
 * handler, with no shared component and no import between them, so a change to the link colour
 * reached one surface and not the other (CCL-27).
 */
export function ExternalLink({
  href,
  title,
  children,
}: {
  href: string;
  /** Hover text. Markdown passes the destination; `linkify`'s e-mails don't, since the address
   *  is already the visible text and a `mailto:` tooltip would only repeat it. */
  title?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      title={title}
      onClick={(e) => {
        e.preventDefault();
        openExternal(href);
      }}
      className={`${EXTERNAL_LINK_CLASS} hover:decoration-sky-600`}
    >
      {children}
    </a>
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
