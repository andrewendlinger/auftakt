import { Link, NavLink, Outlet } from 'react-router-dom';
import { GlobalSearch } from './GlobalSearch';
import { SeasonSwitcher } from './SeasonSwitcher';

function navClass({ isActive }: { isActive: boolean }): string {
  return `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
    isActive ? 'bg-white/20 text-white' : 'text-white/75 hover:bg-white/10 hover:text-white'
  }`;
}

export function Layout() {
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 bg-neutral-900 text-white shadow-md no-print">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
          <div className="flex items-center gap-3">
            {/* The brand is the way to the Saison-Übersicht (landing). */}
            <Link to="/" className="text-lg font-bold tracking-tight transition hover:text-white/80">
              Auftakt
            </Link>
            <SeasonSwitcher />
          </div>
          {/* Fixed page names, deliberately not `EditableLabel`: renaming the app's own
              navigation only obscures where a link leads. */}
          <nav className="flex items-center gap-1">
            <NavLink to="/dashboard" className={navClass}>
              Übersicht
            </NavLink>
            <NavLink to="/archiv" className={navClass}>
              Archiv
            </NavLink>
            <NavLink to="/einstellungen" className={navClass}>
              Einstellungen
            </NavLink>
          </nav>
          {/* `min-w-56` is what makes the header *wrap* instead of crushing this (WP-55). The
              floor used to start at `md:`, and below it the input's own min-content is about
              37 px — a percentage width contributes nothing to intrinsic sizing — so between the
              point where the nav stops fitting and the point where it wraps, the search collapsed
              to a stub instead of moving to its own line. */}
          <div className="ml-auto min-w-56 flex-1 md:min-w-72 md:max-w-md">
            <GlobalSearch />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
