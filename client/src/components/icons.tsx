/**
 * Flat, single-stroke line icons (Feather-style), colored via `currentColor`.
 *
 * **This is where an app symbol belongs, not in a string literal** (WP-38). A glyph typed into
 * JSX — `✎`, `✕`, `▲` — is drawn by whatever font the operating system picks for it, so the same
 * toolbar came out different on Windows and on macOS, and monochrome line characters ended up
 * beside full-colour emoji in one row. An icon here renders identically everywhere and inherits
 * its colour and size from the button around it. Emoji remain for what the *user* chooses: the
 * column symbol and anything typed into a note.
 */

type IconProps = { className?: string };

const common = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function HomeIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg className={className} {...common}>
      <path d="M3 9.5 12 3l9 6.5" />
      <path d="M5 9v10a1 1 0 0 0 1 1h3v-6h6v6h3a1 1 0 0 0 1-1V9" />
    </svg>
  );
}

export function TrashIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg className={className} {...common}>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

/** Corner-up-right arrow: „hierhin verschieben". */
export function MoveIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg className={className} {...common}>
      <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
      <path d="M15 4l5 5-5 5" />
    </svg>
  );
}

export function ListIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg className={className} {...common}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </svg>
  );
}

/**
 * Disclosure chevron. Rotate the icon (not its button) with `rotate-90` to point it down.
 *
 * It is also the app's up and down arrow — `-rotate-90` and `rotate-90` cover what `▲ ▼ ▾` used
 * to draw (WP-38). One shape for „open this", „move up" and „a menu hangs here" is deliberate:
 * they are the same gesture pointed in different directions.
 */
export function ChevronRightIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg className={className} {...common}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function DropletIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg className={className} {...common}>
      <path d="M12 3s5.5 5.4 5.5 9.5a5.5 5.5 0 0 1-11 0C6.5 8.4 12 3 12 3z" />
    </svg>
  );
}

export function LinkIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg className={className} {...common}>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12 19" />
    </svg>
  );
}

/** „Bild einfügen" — a framed picture: the mountain-and-sun every photo app draws (WP-37). */
export function ImageIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg className={className} {...common}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 16l-5-5-5.5 5.5" />
      <path d="M3 18l4-4 3 3" />
    </svg>
  );
}

/** „Bearbeiten" / „Umbenennen" — the pencil that used to be `✎`. */
export function PencilIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg className={className} {...common}>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5z" />
      <path d="M14.5 5.5l3 3" />
    </svg>
  );
}

/** „Schließen" / „Entfernen" — the cross that used to be `✕`. Not the trash can: this removes a
 * row from a list being edited, it does not delete a record. */
export function XIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg className={className} {...common}>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

/** „Duplizieren" — two stacked sheets, formerly `⧉`. */
export function CopyIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg className={className} {...common}>
      <path d="M10 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" />
      <path d="M6 15H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1" />
    </svg>
  );
}

/** „Hinzufügen" — formerly the fullwidth `＋`, chosen back then to look less like typed text. */
export function PlusIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg className={className} {...common}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** The emoji picker's own button, formerly `🙂` — the one place a face was the label. */
export function SmileIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg className={className} {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14a4.5 4.5 0 0 0 7 0" />
      <path d="M9 9.5h.01M15 9.5h.01" />
    </svg>
  );
}

/** „Zitat" — the pair of marks that used to be a single `❝`. */
export function QuoteIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg className={className} {...common}>
      <path d="M10 11H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6a4 4 0 0 1-4 4" />
      <path d="M20 11h-4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6a4 4 0 0 1-4 4" />
    </svg>
  );
}

/** „Tabelle einfügen", formerly `▦`. */
export function TableIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg className={className} {...common}>
      <path d="M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
      <path d="M3 9.5h18M9.5 9.5V20" />
    </svg>
  );
}

/** „Einrücken", formerly `⇥`: the arrow points into the text it moves. */
export function IndentIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg className={className} {...common}>
      <path d="M10 6h11M10 12h11M10 18h11" />
      <path d="M3 9l3 3-3 3" />
    </svg>
  );
}

/** „Ausrücken", formerly `⇤`. */
export function OutdentIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg className={className} {...common}>
      <path d="M10 6h11M10 12h11M10 18h11" />
      <path d="M6 9l-3 3 3 3" />
    </svg>
  );
}

/** „Zurück", formerly `←`. */
export function ArrowLeftIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg className={className} {...common}>
      <path d="M19 12H5" />
      <path d="M11 18l-6-6 6-6" />
    </svg>
  );
}

/** „Vorwärts", formerly `→`. */
export function ArrowRightIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg className={className} {...common}>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}
