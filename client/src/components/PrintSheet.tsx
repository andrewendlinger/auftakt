import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Contact, EventItem } from '../api/types';
import { formatEventWhen, weekdayShort } from '../lib/dates';
import { ArrowLeftIcon } from './icons';

/**
 * Shared chrome for the print sheets (`#/print/artist/:id`, `#/print/project/:id`).
 * These routes live outside `Layout`, so everything the sheet shows is in here — including,
 * since WP-71, the way back off it.
 *
 * **The sheet used to be a dead end.** Its only control was the print button; the routes sit
 * outside `Layout`, so there is no header, no Breadcrumbs and no season switcher, and the
 * packaged app has neither browser chrome nor a „Zurück" in its menu. A customer who opened an
 * Ein-Pager could reach the app again only by quitting it — which is what they reported, and what
 * `PrintFallback` below had already reasoned out for the *error* case while the working sheet
 * kept the defect.
 *
 * `back` is the page the sheet was built from and `title` its subject. Both are passed in rather
 * than derived from the URL: `PrintArtist` and `PrintProject` already resolve their own `:id` and
 * validate it with `isValidId`, and a second parser here would be a place for the two to
 * disagree — a back link pointing at `#/project/NaN` is exactly the dead end this removes.
 */
export function PrintPage({
  back,
  title,
  children,
}: {
  /** Where the sheet came from — `/artist/:id` or `/project/:id`, never the start page. */
  back: string;
  /** The sheet's subject: names the target in the tooltip, and the file in the save dialog. */
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl bg-white p-10 print-page">
      <div className="no-print mb-6 flex items-center justify-between gap-3">
        {/* A `Link`, so the way back is one route change inside the same document: the season
            pin lives in this window's sessionStorage and a full load would also throw away the
            cache the page behind it is still warm with. Named in the tooltip rather than in the
            label — „Zurück" is the app's word for it (Breadcrumbs, every dialog footer), and a
            long project name has nowhere to go in a row this button shares. */}
        <Link
          to={back}
          title={`Zurück zu „${title}“`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-200"
        >
          <ArrowLeftIcon />
          Zurück
        </Link>
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
      {/* `min-w-0` because a flex item's `min-width` is `auto`, i.e. it refuses to shrink below its
          min-content width. The subtitle is Markdown, and since WP-37 that can hold an image — a
          wide one would push this column past the sheet and off the paper, with `max-width: 100%`
          resolving against a box that had already grown. */}
      <div className="min-w-0">
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

/** The contacts table of both sheets — name, role, e-mail, phone, no header row. */
export function PrintContacts({ contacts }: { contacts: Contact[] }) {
  if (contacts.length === 0) return <Empty />;
  return (
    <table className="w-full text-sm">
      <tbody>
        {contacts.map((c) => (
          <tr key={c.id} className="border-b border-neutral-100">
            <td className="py-1 pr-4 font-medium">{c.name}</td>
            <td className="py-1 pr-4 text-neutral-500">{c.role}</td>
            <td className="py-1 pr-4">{c.email}</td>
            <td className="py-1">{c.phone}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The events list of both sheets. `showProjectCode` is the only difference between them: the
 * artist sheet spans every project and needs the `[NQ1]` tag to say which, the project sheet
 * would print its own code on every row.
 */
export function PrintEvents({
  events,
  showProjectCode = false,
}: {
  events: EventItem[];
  showProjectCode?: boolean;
}) {
  if (events.length === 0) return <Empty />;
  return (
    <ul className="space-y-1 text-sm">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3">
          <span className="w-40 shrink-0 text-neutral-500">
            {e.start_at ? `${weekdayShort(e.start_at)} ${formatEventWhen(e)}` : 'Datum offen'}
          </span>
          <span>
            <span className="font-medium">{e.title}</span>
            {showProjectCode && e.project_code ? (
              <span className="ml-1 text-neutral-400">[{e.project_code}]</span>
            ) : (
              ''
            )}
            {/* 📍 replaces the old „ · " — it is the separator now, so two would stack up. */}
            {e.location ? <span className="italic text-neutral-500"> 📍 {e.location}</span> : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}
