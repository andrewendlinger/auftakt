import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, ArrowRightIcon, HomeIcon } from './icons';

export interface Crumb {
  label: string;
  to?: string;
}

/**
 * Location bar for inner pages: back/forward arrows, then the trail. The first crumb
 * (always "Übersicht") carries the home icon so home + label read as one link, and the
 * last crumb is the current page (never a link).
 */
export function Breadcrumbs({ trail }: { trail: Crumb[] }) {
  const navigate = useNavigate();
  const iconBtn =
    'rounded-lg px-1.5 py-1 text-neutral-400 transition hover:bg-neutral-200/60 hover:text-neutral-700';
  return (
    <nav className="flex flex-wrap items-center gap-2 text-sm text-neutral-500">
      <span className="flex items-center gap-0.5">
        <button onClick={() => navigate(-1)} title="Zurück" aria-label="Zurück" className={iconBtn}>
          <ArrowLeftIcon />
        </button>
        <button onClick={() => navigate(1)} title="Vorwärts" aria-label="Vorwärts" className={iconBtn}>
          <ArrowRightIcon />
        </button>
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        {trail.map((c, i) => {
          const last = i === trail.length - 1;
          const label =
            i === 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <HomeIcon className="h-4 w-4" />
                {c.label}
              </span>
            ) : (
              c.label
            );
          return (
            <span key={i} className="flex items-center gap-1.5">
              {c.to && !last ? (
                <Link to={c.to} className="rounded hover:text-neutral-800 hover:underline">
                  {label}
                </Link>
              ) : (
                <span className={last ? 'font-medium text-neutral-700' : undefined}>{label}</span>
              )}
              {!last && <span className="text-neutral-300">/</span>}
            </span>
          );
        })}
      </span>
    </nav>
  );
}
