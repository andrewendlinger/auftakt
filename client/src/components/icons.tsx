/** Flat, single-stroke line icons (Feather-style), colored via `currentColor`. */

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

export function ListIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg className={className} {...common}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </svg>
  );
}

/** Disclosure chevron. Rotate the icon (not its button) with `rotate-90` to point it down. */
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
