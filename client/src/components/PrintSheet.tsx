import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Shared chrome for the print sheets (`#/print/artist/:id`, `#/print/project/:id`).
 * These routes live outside `Layout`, so everything the sheet shows is in here.
 */

export function PrintPage({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl bg-white p-10 print-page">
      <div className="no-print mb-6 flex justify-end">
        <button
          onClick={() => window.print()}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          Als PDF speichern / Drucken
        </button>
      </div>
      {children}
    </div>
  );
}

/**
 * Wrapper for a sheet that could not be built. These routes sit outside `Layout`, so unlike
 * every other page there is no header to navigate away from — an error state on its own really
 * would strand the user. The „Drucken" button is deliberately absent: there is nothing to print.
 */
export function PrintFallback({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl p-10">
      {children}
      <p className="mt-4 text-center">
        <Link
          to="/"
          className="inline-flex items-center rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-200"
        >
          Zur Startseite
        </Link>
      </p>
    </div>
  );
}

export function PrintHeader({
  accent,
  kicker,
  title,
  image,
  badges,
  children,
}: {
  accent: string;
  kicker: string;
  title: string;
  image?: string | null;
  /** Pills shown above the title — the project sheet's code and status. */
  badges?: ReactNode;
  /** Markdown subtitle: artist notes or project description. */
  children?: ReactNode;
}) {
  return (
    <header className="mb-6 flex items-start gap-4 border-b-4 pb-3" style={{ borderColor: accent }}>
      {image && <img src={image} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover" />}
      <div>
        <div className="text-xs uppercase tracking-widest text-neutral-400">{kicker}</div>
        {badges && <div className="mt-1 flex items-center gap-2">{badges}</div>}
        <h1 className="text-3xl font-bold text-neutral-900">{title}</h1>
        {children}
      </div>
    </header>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-neutral-700">{title}</h2>
      {children}
    </section>
  );
}

export function Empty() {
  return <p className="text-sm text-neutral-400">—</p>;
}
