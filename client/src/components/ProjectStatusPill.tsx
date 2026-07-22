import { contrastText } from '../lib/colors';
import { findOption } from '../lib/selectOptions';
import { useProjectStatusOptions } from '../hooks';

/**
 * The coloured pill for a project's status (WP-I). Colour + label come from the
 * `project_statuses` setting, looked up by the stored value; an unknown value falls back to a
 * neutral grey pill so a legacy status never disappears.
 */
export function ProjectStatusPill({ status, className = '' }: { status: string; className?: string }) {
  const options = useProjectStatusOptions();
  const opt = findOption(options, status);
  const base = 'rounded-full px-2 py-0.5 text-xs font-medium';
  if (opt?.color) {
    return (
      <span className={`${base} ${className}`} style={{ background: opt.color, color: contrastText(opt.color) }}>
        {opt.label}
      </span>
    );
  }
  return <span className={`${base} bg-neutral-100 text-neutral-600 ${className}`}>{opt?.label ?? status}</span>;
}
