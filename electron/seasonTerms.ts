import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The word the customer chose for a season, read straight out of `seasons.json` (WP-68).
 *
 * Three dialogs in the main process name it: the first-start backup prompt and the two backup
 * failures. One of them sends the reader to the Einstellungen tab whose label *is* the word
 * („<Saison> & Daten“), so a hardcoded „Saison“ points a customer who renamed it at a tab that
 * does not exist under that name — in the one dialog he reads because his backups have stopped.
 *
 * `seasonTerms()` in `server/src/db.ts` answers the same question for the backup documents, and
 * this module deliberately does not call it: that file opens SQLite, and `electron/main.ts` is
 * its own esbuild bundle, so the import would drag better-sqlite3 — a native module — into the
 * main bundle. The registry is plain JSON and needs no database to read. The defaults below
 * mirror `seasonTerms()` and `useSeasonTerm()` (`client/src/hooks.ts`); all three have to stay in
 * step, and this is the third copy of them.
 *
 * Imports nothing from `electron` and nothing from `server/`, the same rule backup.ts,
 * bootLog.ts, cascade.ts and windowBounds.ts follow and for the same reason: it lets
 * `client/src/lib/seasonTerms.test.ts` drive this from `check:unit`, the only automated run that
 * reaches main-process code at all. The data directory is passed in — main.ts owns that decision
 * (dev → repo/.data, packaged → userData) and a second copy of it here would go stale.
 */

export interface SeasonTerms {
  singular: string;
  plural: string;
}

/** What an installation that never renamed anything is called — and every failure below. */
const DEFAULTS: SeasonTerms = { singular: 'Saison', plural: 'Saisons' };

/** A term counts only as a non-empty string, trimmed exactly as `seasonTerms()` trims it. */
function term(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/**
 * Never throws, for any input. A `seasons.json` that is missing, unreadable, half-written or
 * hand-edited into nonsense is precisely the situation one of the callers is reporting, and a
 * dialog that crashes while reporting a failed backup is worse than the failed backup. Every
 * one of those cases resolves to „Saison“/„Saisons“, and the two terms fall back independently
 * — the customer may well have renamed only the singular.
 *
 * Read per dialog rather than cached: this is a small file, read at most a few times per launch,
 * and a cache would answer with the old word for the rest of a session in which the customer had
 * just renamed it in Einstellungen — which is the session in which he would notice.
 *
 * NOTE for callers: the returned word has an unknowable grammatical gender, so it may never be
 * preceded by an article or an inflected determiner — „einer einzelnen Festival“ is what that
 * produces. Safe: „je <singular>“, „aller <plural>“, „„<singular> & Daten““. Everything else has
 * to be phrased around the word, as the client's strings and `server/src/lib/backupDocs.ts` are.
 */
export function readSeasonTerms(dataDir: string): SeasonTerms {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(dataDir, 'seasons.json'), 'utf8'));
    const terms = (raw as { terms?: Record<string, unknown> } | null)?.terms;
    return {
      singular: term(terms?.season, DEFAULTS.singular),
      plural: term(terms?.seasonPlural, DEFAULTS.plural),
    };
  } catch {
    return { ...DEFAULTS };
  }
}
