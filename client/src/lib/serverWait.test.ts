import { describe, expect, it } from 'vitest';
import { APP_LOG_FIELD_CAPS, appLogLine } from '../../../electron/appLog';
import {
  ANNOUNCE_AFTER_MS,
  KEEP_WAITING,
  PATIENCE_MS,
  POLL_FIRST_MS,
  POLL_MAX_MS,
  POLL_SLOW_MAX_MS,
  REINSTALL_AFTER_ROUNDS,
  STATUS_BACKGROUND,
  STATUS_URL_PREFIX,
  nextPollDelay,
  statusDocument,
  statusUrl,
  waitDialog,
  waitLogEntry,
  waitStep,
} from '../../../electron/serverWait';

/**
 * The module under test lives in `electron/`, not here — same arrangement as `activate`,
 * `appLog`, `backupDir`, `cascade`, `exportName`, `seasonTerms` and `windowBounds`, and for the
 * sharpest reason of the set: this is the launch itself. No `check:*` script boots Electron
 * main at all (`check:browser` drives a page, `check:boot` builds the client and serves it from
 * the real server — neither runs a line of `main.ts`), and the only real reproduction is a
 * machine whose virus scanner is reading a freshly installed binary. Reading the code is the
 * other check there is, which is exactly why the decisions were extracted to be readable here.
 *
 * Why it exists (WP-72): the first launch after updating to 0.11.0 on a customer device died in
 * „Server-Start Zeitüberschreitung" and exited, 24 s before a launch that worked. The app's own
 * update dialog names the cause and promises „eine Minute oder mehr"; `waitForServer()` granted
 * ten seconds and then advised a reinstall — which for a scanner reading a new binary is not
 * merely useless but writes another new binary for it to read.
 */

describe('waitStep', () => {
  it('says nothing at all while an ordinary launch is still plausible', () => {
    // The fast path is the overwhelming majority of launches and must stay pixel-untouched:
    // cream window, no status, no dialog, exactly the #144 choreography.
    expect(waitStep(0, false)).toBe('poll');
    expect(waitStep(ANNOUNCE_AFTER_MS - 1, false)).toBe('poll');
  });

  it('announces at the moment the old code gave up', () => {
    // ANNOUNCE_AFTER_MS *is* the deleted `timeoutMs = 10000`. Ten seconds was already judged
    // long enough to act on; all that changes is that the app now explains instead of exits.
    expect(ANNOUNCE_AFTER_MS).toBe(10_000);
    expect(waitStep(ANNOUNCE_AFTER_MS, false)).toBe('announce');
  });

  it('never asks about a wait it has not announced', () => {
    // The load-bearing ordering. The 3.4 MB server bundle compiles synchronously, so on the very
    // machines this exists for the first call can arrive with minutes on the clock — and a
    // customer must not be asked whether to keep waiting for something nobody told them about.
    // The status page goes up one poll (≤150 ms) before the dialog does.
    expect(waitStep(PATIENCE_MS * 3, false)).toBe('announce');
  });

  it('keeps polling through the announced wait until the patience is up', () => {
    expect(waitStep(ANNOUNCE_AFTER_MS, true)).toBe('poll');
    expect(waitStep(PATIENCE_MS - 1, true)).toBe('poll');
    expect(waitStep(PATIENCE_MS, true)).toBe('ask');
  });

  it('decides on the cycle clock alone, which is what „Weiter warten" resets', () => {
    // A granted round restarts a full cycle rather than extending a total: the caller resets the
    // clock and this function has nothing else to go on, so question N+1 is always PATIENCE_MS
    // after the answer to question N — never a fraction of it because the user thought for a
    // while before answering.
    expect(waitStep(0, true)).toBe('poll');
    expect(waitStep(PATIENCE_MS + 1, true)).toBe('ask');
  });

  it('waits at least as long as the app promises elsewhere', () => {
    // The restart dialog in updater.ts tells the customer the scan „kostet auf manchen Rechnern
    // eine Minute oder mehr". A patience below that would interrupt exactly the wait the app
    // itself asked them to sit through — which is the whole finding, in one number.
    expect(PATIENCE_MS).toBeGreaterThanOrEqual(60_000);
  });
});

describe('nextPollDelay', () => {
  it('doubles from a tight first delay', () => {
    // The listen call is a few ticks behind the import that triggers it, so a flat interval
    // charges its full length to almost every start.
    expect(POLL_FIRST_MS).toBeLessThan(POLL_MAX_MS);
    expect(nextPollDelay(POLL_FIRST_MS, false)).toBe(POLL_FIRST_MS * 2);
  });

  it('caps at the tight ceiling while nothing has been announced', () => {
    expect(nextPollDelay(POLL_MAX_MS, false)).toBe(POLL_MAX_MS);
    expect(nextPollDelay(POLL_MAX_MS * 4, false)).toBe(POLL_MAX_MS);
  });

  it('backs off once the wait is known to be slow', () => {
    // Past the announcement the machine is busy with something else by definition; several
    // hundred more refused connections buy nothing, and half a second of extra latency on a
    // start that has already taken a minute is imperceptible.
    expect(nextPollDelay(POLL_MAX_MS, true)).toBe(POLL_MAX_MS * 2);
    expect(nextPollDelay(POLL_SLOW_MAX_MS, true)).toBe(POLL_SLOW_MAX_MS);
    expect(POLL_SLOW_MAX_MS).toBeGreaterThan(POLL_MAX_MS);
  });
});

describe('the status page', () => {
  const doc = statusDocument();

  it('is the cream rectangle with a sentence on it', () => {
    // Phase A's own #f6f6f4, which is also the window's backgroundColor — so the page that
    // appears mid-wait is the frame that was already there plus text, and nothing flashes at the
    // one moment a slow launch is being watched most closely.
    expect(STATUS_BACKGROUND).toBe('#f6f6f4');
    expect(doc).toContain(`background:${STATUS_BACKGROUND}`);
  });

  it('names the likely cause in the words the update dialog already used', () => {
    expect(doc).toContain('Virenscanner');
    expect(doc).toContain('eine Minute oder mehr');
    // Not „irgendwas ploppt auf": it says the window will open by itself, and asks for the one
    // thing that makes a second launch (and a second window) impossible.
    expect(doc).toContain('von selbst');
    expect(doc).toContain('nicht mehrfach klicken');
  });

  it('needs nothing that a missing server could have served', () => {
    // The server is what is missing; a page that referenced a script, a font file, an image or
    // a stylesheet would be a blank window on exactly the launch it exists to explain. It also
    // must not cost a busy machine a render it cannot afford.
    expect(doc).not.toContain('<script');
    expect(doc).not.toContain('src=');
    expect(doc).not.toContain('url(');
    expect(doc).not.toMatch(/https?:/);
  });

  it('carries a title, or the window would wear the URL', () => {
    // Chromium names a window after its document title and falls back to the URL when there is
    // none — and here the URL *is* the whole page. Without this line the taskbar button of a
    // slow launch reads „data:text/html;charset=utf-8,%3C!doctype…".
    expect(doc).toContain('<title>Auftakt</title>');
  });

  it('says nothing about the machine it is running on', () => {
    // Same rule as the diagnostics bundle, for a surface that is even more public: no error
    // text, no path, no version — a path carries an account name and this one would be printed
    // at 17 px across a customer's screen.
    expect(doc).not.toMatch(/[A-Za-z]:\\|\/Users\/|\/home\//);
  });
});

describe('statusUrl', () => {
  it('round-trips the document through the data URL', () => {
    const url = statusUrl();
    expect(url.startsWith(STATUS_URL_PREFIX)).toBe(true);
    expect(decodeURIComponent(url.slice(STATUS_URL_PREFIX.length))).toBe(statusDocument());
  });

  it('leaves no character in the URL that would truncate it', () => {
    // The trap this encoding exists for: the document contains `#f6f6f4` twice, and a raw `#` in
    // a URL starts the fragment — the unencoded form loads a stylesheet cut off mid-colour and
    // shows a white page with no text on it. Whitespace is the same class of problem.
    const encoded = statusUrl().slice(STATUS_URL_PREFIX.length);
    expect(encoded).not.toMatch(/[#\s]/);
  });
});

describe('waitDialog', () => {
  it('asks rather than announces a verdict', () => {
    const dialog = waitDialog(0);
    expect(dialog.buttons).toEqual(['Weiter warten', 'Beenden']);
    expect(dialog.buttons[KEEP_WAITING]).toBe('Weiter warten');
  });

  it('cannot be answered „Beenden" by a keystroke', () => {
    // Esc and Return both continue the wait, so a stray press during a launch that is merely
    // slow cannot end it. Quitting takes the button that says so.
    const dialog = waitDialog(0);
    expect(dialog.defaultId).toBe(KEEP_WAITING);
    expect(dialog.cancelId).toBe(KEEP_WAITING);
  });

  it('offers no reinstall while a scan is still the likely answer', () => {
    // The counsel this replaces („Bleibt der Fehler bestehen, hilft eine Neuinstallation") fired
    // after ten seconds and made the situation worse: a reinstall writes another fresh binary
    // for the same scanner to check.
    for (let rounds = 0; rounds < REINSTALL_AFTER_ROUNDS; rounds++) {
      expect(waitDialog(rounds).detail).not.toContain('Neuinstallation');
      expect(waitDialog(rounds).detail).toContain('Virenscanner');
      expect(waitDialog(rounds).type).toBe('info');
    }
    expect(REINSTALL_AFTER_ROUNDS).toBeGreaterThanOrEqual(1);
  });

  it('says the word once two granted rounds have failed', () => {
    // ~4½ minutes in, with the scanner explanation offered twice and outlived twice: the
    // earliest point at which „your installation is broken" is honest rather than reflexive.
    const persistent = waitDialog(REINSTALL_AFTER_ROUNDS);
    expect(persistent.detail).toContain('Neuinstallation');
    expect(persistent.detail).toContain('deine Daten bleiben dabei erhalten');
    expect(persistent.type).toBe('warning');
    // And it stays said, however many more rounds the user grants.
    expect(waitDialog(REINSTALL_AFTER_ROUNDS + 5).detail).toContain('Neuinstallation');
  });

  it('keeps the same buttons in both shapes, so the choice never moves', () => {
    expect(waitDialog(REINSTALL_AFTER_ROUNDS).buttons).toEqual(waitDialog(0).buttons);
    expect(waitDialog(REINSTALL_AFTER_ROUNDS).defaultId).toBe(KEEP_WAITING);
  });
});

describe('waitLogEntry', () => {
  it('records the announcement as the warning it is', () => {
    expect(waitLogEntry('slow', 10_004)).toEqual({
      level: 'warn',
      event: 'server-slow',
      ms: 10_004,
    });
  });

  it('closes the story with the outcome', () => {
    // „server came up after N ms" and „user quit" are the two halves a bundle has to be able to
    // tell apart — a `server-slow` with nothing after it would leave a triager guessing.
    expect(waitLogEntry('ready', 74_233)).toEqual({
      level: 'info',
      event: 'server-slow-ready',
      ms: 74_233,
    });
    expect(waitLogEntry('quit', 92_000).level).toBe('error');
  });

  it('counts the granted rounds, and only once there are any', () => {
    expect(waitLogEntry('again', 91_500, 1)).toEqual({
      level: 'warn',
      event: 'server-slow-again',
      ms: 91_500,
      rounds: 1,
    });
    // The ordinary slow start stays three fields wide.
    expect(waitLogEntry('ready', 20_000, 0)).not.toHaveProperty('rounds');
  });

  it('rounds the elapsed time, because the clock is fractional', () => {
    // main.ts measures with performance.now() — monotonic, so a clock correction during a boot
    // cannot make the wait jump — and that returns fractions of a millisecond.
    expect(waitLogEntry('ready', 12_345.678).ms).toBe(12_346);
  });

  it('groups under one prefix, inside the field caps the log enforces', () => {
    const events = (['slow', 'ready', 'again', 'quit'] as const).map(
      (what) => waitLogEntry(what, 1).event as string,
    );
    // One grep — `server-slow` — finds the whole story of a launch in a customer's bundle.
    for (const event of events) {
      expect(event.startsWith('server-slow')).toBe(true);
      expect(event.length).toBeLessThanOrEqual(APP_LOG_FIELD_CAPS.event ?? 0);
    }
    // And the four are distinguishable, which is the point of having four.
    expect(new Set(events).size).toBe(4);
  });

  it('survives the writer it is written by', () => {
    // The real appLogLine, not a stand-in: `ms` and `rounds` are numbers, and every field this
    // codebase names is capped as a string by that function. A shape that silently lost them
    // would leave the bundle with a line that says only „slow".
    const line = appLogLine(waitLogEntry('quit', 275_000, 2), {
      at: '2026-08-26 17:39:51',
      app: '0.11.0',
      src: 'main',
    });
    expect(line).not.toBeNull();
    expect(JSON.parse(line ?? '{}')).toEqual({
      v: 1,
      level: 'error',
      event: 'server-slow-quit',
      ms: 275_000,
      rounds: 2,
      at: '2026-08-26 17:39:51',
      app: '0.11.0',
      src: 'main',
    });
  });
});
