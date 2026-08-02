import { Link } from 'react-router-dom';

/**
 * The catch-all route. Without it an unmatched hash rendered an empty content area with no
 * message at all, so a bookmark or desktop shortcut to a retired path — or a typo — was
 * indistinguishable from "the app is broken" or "my data is gone" (CCL-08). It sits inside
 * the Layout route, so the header and its navigation stay on screen.
 */
export function NotFound() {
  return (
    <div className="py-20 text-center">
      <p className="text-lg font-semibold text-neutral-800">Seite nicht gefunden</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-neutral-500">
        Diese Adresse gibt es nicht (mehr). Vielleicht stammt der Link aus einer älteren Version
        von Auftakt.
      </p>
      <Link
        to="/"
        className="mt-4 inline-flex items-center rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-200"
      >
        Zur Startseite
      </Link>
    </div>
  );
}
