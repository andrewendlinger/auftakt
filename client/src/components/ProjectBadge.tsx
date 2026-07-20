import { Link } from 'react-router-dom';
import { contrastText, projectShade } from '../lib/colors';

/** The short project code rendered as a coloured badge — used everywhere a project appears. */
export function ProjectBadge({
  code,
  projectId,
  artistColor,
  projectColor,
  to,
  title,
}: {
  code: string;
  projectId: number;
  artistColor: string | null | undefined;
  projectColor: string | null | undefined;
  to?: string;
  title?: string;
}) {
  const shade = projectShade(artistColor ?? '#888888', projectColor, projectId);
  const badge = (
    <span
      className="inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-bold leading-none"
      style={{ background: shade, color: contrastText(shade) }}
      title={title}
    >
      {code}
    </span>
  );
  return to ? (
    <Link to={to} className="hover:opacity-85">
      {badge}
    </Link>
  ) : (
    badge
  );
}
