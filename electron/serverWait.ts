/**
 * The decidable half of „the bundled server is taking too long" (WP-72): the thresholds, the
 * one status page the cream window can show before a renderer exists, the two dialogs, and the
 * four log lines the wait leaves behind.
 *
 * Imports nothing from `electron`, deliberately — the same rule as `appLog.ts`, `backup.ts`,
 * `cascade.ts`, `activate.ts` and `exportName.ts`, and for the same reason: it is what lets
 * `client/src/lib/serverWait.test.ts` exercise this from `check:unit`, the only automated run
 * that reaches main-process code at all. Nothing here polls, draws, waits or exits; `main.ts`
 * owns the loop and the window, this file owns every number and every sentence in it.
 *
 * **Why it exists.** A customer's first launch after updating to 0.11.0 died in a dialog reading
 * „Auftakt konnte nicht gestartet werden. / Server-Start Zeitüberschreitung" and exited; the
 * launch 24 s later was fine. The cause was already written down in the app's own update dialog
 * — „Virenscanner prüfen die neue Programmdatei zuerst, das kostet auf manchen Rechnern eine
 * Minute oder mehr" (`updater.ts`) — while `waitForServer()` granted the server **ten seconds**
 * and then advised a reinstall. The app warned about a minute and allowed itself ten seconds,
 * and it answered a scan with the one counsel that cannot help a scan.
 *
 * Since PR #144 the cream window is already on screen for the whole of that wait, so the fix is
 * not more silence with a bigger number on it: the wait gets a voice at the moment it used to
 * give up, and a question — never a verdict — at the end of its patience.
 */

/* ---- the numbers ---------------------------------------------------------------------- */

/**
 * When the wait stops being invisible. Exactly the old timeout, which is the whole argument for
 * the value: ten seconds of a launch is already the longest silence this app can produce, it was
 * long enough to be worth ending before, and the only thing that changes is what happens at it.
 */
export const ANNOUNCE_AFTER_MS = 10_000;

/**
 * How long one cycle waits before it asks. Comfortably past the „eine Minute oder mehr" the
 * update dialog promises — a start that is still the promised scan must never be interrupted by
 * a dialog — and short enough that somebody watching a screen is not left to guess for minutes
 * whether anything is still happening. „Weiter warten" starts a fresh cycle, so this is the
 * spacing between questions and never a total.
 */
export const PATIENCE_MS = 90_000;

/**
 * How many granted „Weiter warten" rounds must have failed before a dialog says the word
 * „Neuinstallation". Two, i.e. the third question, ~4½ minutes in: by then the scanner
 * explanation has been offered twice and outlived twice, which is the earliest point at which
 * „your installation is broken" is an honest thing to say rather than the reflex it used to be.
 */
export const REINSTALL_AFTER_ROUNDS = 2;

/** The health poll's first delay, and its ceiling before and after the wait has been announced. */
export const POLL_FIRST_MS = 15;
export const POLL_MAX_MS = 150;
export const POLL_SLOW_MAX_MS = 500;

/**
 * Per-poll ceiling on `/api/health`. Loopback either answers or is refused at once, so this is
 * not a latency budget: it is the guarantee that one wedged connection cannot swallow the whole
 * patience above and leave the window silent forever — the failure the elapsed check below can
 * never see, because it only runs between polls.
 */
export const HEALTH_TIMEOUT_MS = 5_000;

/**
 * Doubling, capped — tight while an ordinary launch is still plausible (the listen call is a few
 * ticks behind the import that triggers it, so a flat interval charges the full interval to
 * almost every start), gentler once the user has been told this one is slow. Past the
 * announcement the machine is busy with something else by definition, several hundred more
 * refused connections buy nothing, and half a second of extra delay on a start that has already
 * taken a minute is not a cost anyone can perceive.
 */
export function nextPollDelay(delay: number, announced: boolean): number {
  return Math.min(delay * 2, announced ? POLL_SLOW_MAX_MS : POLL_MAX_MS);
}

/* ---- the state machine ---------------------------------------------------------------- */

/** What the loop does next, given how long the current cycle has run. */
export type WaitStep =
  /** Keep polling; nothing to say yet. */
  | 'poll'
  /** Put the status page in the window — once per launch. */
  | 'announce'
  /** Patience is up: ask „Weiter warten" or „Beenden". */
  | 'ask';

/**
 * `cycleMs` is the time since *this* cycle began — the launch for the first one, the last
 * „Weiter warten" for every one after it, which is what „restarts a full wait cycle" means. The
 * total elapsed time is a separate clock and belongs to the log, not to this decision.
 *
 * The two branches are ordered rather than combined, and that order is the invariant worth
 * having: **while nothing has been announced, the only thing that can happen is the
 * announcement.** A blocked event loop can hand this function a `cycleMs` of two minutes on its
 * very first call — the 3.4 MB server import compiles synchronously, and on the machines this
 * exists for it is being read through the scanner — and a customer must never be asked whether
 * to keep waiting for something nobody has told them about. The status page then goes up one
 * poll (≤150 ms) before the dialog, which is exactly the intended order at a barely perceptible
 * cost.
 */
export function waitStep(cycleMs: number, announced: boolean): WaitStep {
  if (!announced) return cycleMs >= ANNOUNCE_AFTER_MS ? 'announce' : 'poll';
  return cycleMs >= PATIENCE_MS ? 'ask' : 'poll';
}

/* ---- the status page ------------------------------------------------------------------ */

/**
 * Phase A's own colour, and the window's `backgroundColor`. The status page has to be the cream
 * rectangle with a sentence on it — anything else would make the slow path flash at the one
 * moment it is being watched most closely („cream is the honest first frame", DECISIONS.md).
 */
export const STATUS_BACKGROUND = '#f6f6f4';
/** The wordmark's ink, and a muted grey that still clears AA on the cream. */
export const STATUS_INK = '#1c1c1e';
export const STATUS_MUTED = '#55555a';

export const STATUS_HEADLINE = 'Auftakt startet…';
/**
 * Deliberately the update dialog's own sentence, near enough verbatim: the customer who reads
 * this has just been shown „Virenscanner prüfen die neue Programmdatei zuerst, das kostet auf
 * manchen Rechnern eine Minute oder mehr" by the restart dialog, and recognising it here is the
 * difference between an explanation and a new worry.
 *
 * „nicht mehrfach klicken" is not filler. A second double-click during the wait starts a second
 * process that takes the single-instance lock and exits without a word — the customer sees
 * nothing happen at all, which on a machine that already feels stuck reads as „kaputt". (It does
 * *not* open an extra window afterwards: the PR144-02 drain only answers a queued request when no
 * window is left, and the cream window is alive through the whole wait.)
 */
export const STATUS_LINES: readonly string[] = [
  'Das dauert diesmal länger als sonst: Nach einem Update prüfen Virenscanner die neue ' +
    'Programmdatei zuerst, das kostet auf manchen Rechnern eine Minute oder mehr.',
  'Bitte einfach warten und nicht mehrfach klicken — Auftakt öffnet sich von selbst.',
];

/**
 * The whole page, as a string. No script, no image, no font file, no stylesheet: the one thing
 * this page can be certain of is that **nothing can be fetched** — the server it would fetch
 * from is precisely what is missing — and the one thing it must not do is cost the busy machine
 * a render it cannot afford. The font stack is the boot overlay's, so the two agree wherever
 * Inter is installed and fall back together where it is not.
 *
 * Nothing from the machine reaches this text — no error message, no path, no version. That is
 * the same rule the diagnostics bundle follows and it is load-bearing for the same reason: a
 * path carries an account name, and this one would be printed at 17 px across a customer's
 * screen.
 *
 * The `<title>` is not decoration either: a document without one leaves Chromium naming the
 * window after its URL, and this URL is the whole page.
 */
export function statusDocument(): string {
  const paragraphs = STATUS_LINES.map((line) => `<p>${line}</p>`).join('');
  return [
    '<!doctype html>',
    '<html lang="de">',
    '<head>',
    '<meta charset="utf-8">',
    '<title>Auftakt</title>',
    '<style>',
    'html,body{margin:0;height:100%}',
    `body{background:${STATUS_BACKGROUND};color:${STATUS_INK};display:flex;align-items:center;`,
    "justify-content:center;font:400 15px/1.6 'Inter',ui-sans-serif,system-ui,-apple-system,",
    "'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased}",
    'main{max-width:32em;padding:0 32px;text-align:center}',
    'h1{margin:0 0 14px;font-size:17px;font-weight:600;letter-spacing:0.2px}',
    `p{margin:0 0 10px;color:${STATUS_MUTED}}`,
    'p:last-child{margin:0}',
    '</style>',
    '</head>',
    `<body><main><h1>${STATUS_HEADLINE}</h1>${paragraphs}</main></body>`,
    '</html>',
  ].join('');
}

/**
 * Longest the loop holds still for the status page to finish loading before it goes back to
 * polling. Not a rendering budget — a few hundred bytes with nothing to fetch take a frame — but
 * the bound on the one thing that must not happen: `main.ts` waits for this navigation to settle
 * so it cannot still be in flight when the app's own load supersedes it, and Electron rejects a
 * superseded load's *successor* with ERR_ABORTED (electron#17526). Unbounded, a wedged renderer
 * would swallow the patience below and leave the launch with no dialog at all; three seconds is
 * far past any real load here and a rounding error against `PATIENCE_MS`.
 */
export const STATUS_LOAD_CAP_MS = 3_000;

export const STATUS_URL_PREFIX = 'data:text/html;charset=utf-8,';

/**
 * The page as something `loadURL` takes. Percent-encoded rather than inlined raw, and that is
 * not tidiness: the document contains `#f6f6f4` twice, and a raw `#` in a URL starts the
 * fragment — the unencoded form would load a stylesheet cut off mid-colour. The umlauts need the
 * same treatment, which the `charset=utf-8` above then decodes.
 */
export function statusUrl(): string {
  return STATUS_URL_PREFIX + encodeURIComponent(statusDocument());
}

/* ---- the question --------------------------------------------------------------------- */

/** The index of „Weiter warten" in `waitDialog().buttons`; every other answer ends the launch. */
export const KEEP_WAITING = 0;

/** A `MessageBoxOptions` in everything but the import — `main.ts` hands it straight to `dialog`. */
export interface WaitDialog {
  type: 'info' | 'warning';
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
}

/**
 * What the app asks when a cycle's patience is up, given how many rounds the user has already
 * granted.
 *
 * **No reinstall advice while a scan is still the likely answer.** The dialog this replaces said
 * „Bitte die App erneut öffnen. Bleibt der Fehler bestehen, hilft eine Neuinstallation." after
 * ten seconds — for a virus scanner reading a freshly written binary that is not merely useless
 * advice, it is advice that makes the situation worse: a reinstall writes another new binary for
 * the same scanner to check. So the first two questions offer only what actually helps, waiting,
 * and say that nothing is lost by quitting either.
 *
 * `cancelId` is „Weiter warten", not „Beenden", and it is the same index as `defaultId` on
 * purpose: Esc and Return both continue, so no keystroke can end a launch by accident. Quitting
 * takes the button that says so.
 */
export function waitDialog(rounds: number): WaitDialog {
  const persistent = rounds >= REINSTALL_AFTER_ROUNDS;
  return {
    type: persistent ? 'warning' : 'info',
    message: 'Auftakt startet immer noch.',
    detail: persistent
      ? 'So lange dauert auch eine Virenprüfung selten. Hilft weiteres Warten nicht: Auftakt ' +
        'beenden, den Rechner neu starten und Auftakt noch einmal öffnen. Bleibt es dabei, hilft ' +
        'eine Neuinstallation — deine Daten bleiben dabei erhalten.'
      : 'Nach einem Update prüfen Virenscanner die neue Programmdatei zuerst, das kostet auf ' +
        'manchen Rechnern eine Minute oder mehr. Sehr wahrscheinlich ist genau das gerade los.\n\n' +
        'Beim Beenden geht nichts verloren — Auftakt lässt sich jederzeit wieder öffnen.',
    buttons: ['Weiter warten', 'Beenden'],
    defaultId: KEEP_WAITING,
    cancelId: KEEP_WAITING,
  };
}

/* ---- what the log gets ---------------------------------------------------------------- */

/** The four moments of a slow start that are worth a line in `app-log.jsonl`. */
export type WaitEvent =
  /** The wait crossed `ANNOUNCE_AFTER_MS` and the status page went up. */
  | 'slow'
  /** It came up after all — the outcome line that closes the story. */
  | 'ready'
  /** The user answered „Weiter warten". */
  | 'again'
  /** The user answered „Beenden"; this launch is over. */
  | 'quit';

const WAIT_LEVELS: Readonly<Record<WaitEvent, string>> = {
  slow: 'warn',
  ready: 'info',
  again: 'warn',
  quit: 'error',
};

const WAIT_EVENTS: Readonly<Record<WaitEvent, string>> = {
  slow: 'server-slow',
  ready: 'server-slow-ready',
  again: 'server-slow-again',
  quit: 'server-slow-quit',
};

/**
 * One runtime line for `logMain`. `ms` is the **total** elapsed time of the wait, not the
 * cycle's: a triager reading a bundle wants „the server needed 74 s" and „they gave up after
 * 4½ minutes", and no reader should have to reconstruct that from the constants above.
 *
 * A launch that is not slow writes **nothing** — the log's whole value is that it is short
 * enough to read, and a line per start would be the routine notice WP-69 deliberately kept
 * `console.log` out of. Every line here therefore describes something the customer saw.
 *
 * `rounds` rides along only once there is one, so the ordinary slow start stays at `level`,
 * `event` and `ms`.
 * The event tokens share the `server-slow` prefix so one grep finds the whole story.
 */
export function waitLogEntry(
  what: WaitEvent,
  elapsedMs: number,
  rounds = 0,
): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    level: WAIT_LEVELS[what],
    event: WAIT_EVENTS[what],
    ms: Math.round(elapsedMs),
  };
  if (rounds > 0) entry.rounds = rounds;
  return entry;
}
