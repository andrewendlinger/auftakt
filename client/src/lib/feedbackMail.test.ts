import { describe, expect, it } from 'vitest';
import {
  FEEDBACK_NOTE_MAX,
  FEEDBACK_NO_NOTE,
  FEEDBACK_TO,
  MAILTO_MAX_CHARS,
  feedbackBody,
  feedbackMailto,
  feedbackRef,
  feedbackReport,
  feedbackSubject,
  type FeedbackContext,
} from './feedbackMail';

/**
 * Two texts leave the app when somebody reports something: the „Meldung" of the file on the
 * desktop, and the optional `mailto:`. The second one is a URL scheme with a hard length limit
 * and an encoding that is easy to get subtly wrong, and both failures are silent in exactly the
 * situation the feature exists for — a client truncates an over-long `mailto:` without saying
 * so, and a mis-encoded `+` or umlaut reaches the maintainer as a mangled report from someone
 * who cannot try again.
 */

const NOTE = 'Nichts — die Seite blieb leer.';

const CTX: FeedbackContext = {
  ref: 'AF-2608141542',
  version: '0.9.0',
  platform: 'darwin',
  system: 'macOS 15.6 · 1728×1117 @2×',
  diagnostics:
    'Startdiagnose — 2 Einträge (Zeit in UTC):\n' +
    '2026-08-11 12:00 · v0.9.0 · play/done · bereit 420 · Ende 2100 ms\n' +
    '2026-08-11 12:03 · v0.9.0 · skip/warm · bereit 120 · Ende 300 ms',
  attachment: '',
};

const FILE = 'Auftakt-Diagnose-AF-2608141542.txt';
const ATTACHED: FeedbackContext = { ...CTX, attachment: FILE };

const summaryOf = (n: number) =>
  ['Startdiagnose — Einträge:', ...Array.from({ length: n }, (_, i) => `Zeile ${i} `.repeat(8))].join(
    '\n',
  );

/** Six umlauts per 71 characters — a sentence out of a real report, not a stress fixture. */
const german = 'Die Übersicht für Künstler öffnete sich nicht, obwohl Termine da wären. '.repeat(40);

const bodyOf = (note: string, ctx: FeedbackContext) =>
  new URL(feedbackMailto(note, ctx)).searchParams.get('body') ?? '';

describe('feedbackRef', () => {
  it('stamps minute resolution in local time', () => {
    // Local getters, not toISOString: 23:30 on the 14th in a +02:00 zone is still the 14th.
    expect(feedbackRef(new Date(2026, 7, 14, 15, 42, 9))).toBe('AF-2608141542');
    expect(feedbackRef(new Date(2026, 0, 3, 4, 5))).toBe('AF-2601030405');
  });

  it('separates two reports a minute apart, which is the whole point', () => {
    const a = feedbackRef(new Date(2026, 7, 14, 15, 42));
    const b = feedbackRef(new Date(2026, 7, 14, 15, 43));
    expect(a).not.toBe(b);
  });

  it('produces the shape main will accept as a filename', () => {
    // The counterpart assertion lives in diagnostics.test.ts, on main's own validator.
    expect(feedbackRef(new Date(2026, 7, 14, 15, 42))).toMatch(/^AF-\d{10}$/);
  });
});

describe('feedbackReport', () => {
  it('is the note and nothing else — the bundle writes everything around it', () => {
    // No reference, no machine line, no attach instruction: `buildDiagnosticsBundle` already
    // heads the file with all three, and a file telling its reader to attach that same file is
    // nonsense. Trimmed, so a stray newline does not decide whether a report counts as empty.
    expect(feedbackReport(`  ${NOTE}\n`)).toBe(NOTE);
  });

  it('says so when nobody wrote anything, rather than leaving „Meldung" empty', () => {
    // The default case since WP-75: one click, no typing. An empty section where the person's
    // own words go reads as a file that lost them.
    expect(feedbackReport('')).toBe(FEEDBACK_NO_NOTE);
    expect(feedbackReport('   \n  ')).toBe(FEEDBACK_NO_NOTE);
    expect(FEEDBACK_NO_NOTE).toContain('Ohne eigenen Text gespeichert');
  });

  it('depends on the note alone, because the dialog remembers bundles under it', () => {
    // The map from report text → the name main wrote is what stops „Text ergänzen" and an
    // unchanged text from writing a second file. A stamp or a clock in here would make every
    // lookup a miss.
    expect(feedbackReport(NOTE)).toBe(feedbackReport(NOTE));
    expect(feedbackReport('')).toBe(feedbackReport(' '));
  });
});

describe('feedbackSubject', () => {
  it('carries the reference and the version', () => {
    expect(feedbackSubject(CTX)).toBe('[AF-2608141542] Auftakt-Feedback (v0.9.0)');
  });

  it('drops what it has no value for rather than printing an empty bracket', () => {
    expect(feedbackSubject({ ...CTX, version: '', ref: '' })).toBe('Auftakt-Feedback');
  });
});

describe('feedbackBody', () => {
  it('puts the person first and the machine under its own heading', () => {
    const body = feedbackBody(NOTE, CTX);
    expect(body.indexOf(NOTE)).toBeLessThan(body.indexOf('--- Technische Angaben'));
    expect(body).toContain('--- Meldung');
    expect(body).toContain('Kennung: AF-2608141542');
    expect(body).toContain('Startdiagnose — 2 Einträge');
  });

  it('omits the heading rather than mailing an empty one', () => {
    // The one-click case: nothing typed, so the mail is the attach line and the machine. The
    // file's own „Meldung" says why it is empty; the mail has no room to say it twice.
    const body = feedbackBody('   ', ATTACHED);
    expect(body).not.toContain('--- Meldung');
    expect(body.startsWith('!! BITTE NOCH ANHÄNGEN')).toBe(true);
  });

  it('lets the machine line stand in for the platform rather than repeat it', () => {
    // „Auftakt 0.9.0 · Windows · Windows 11" is what naming both would produce.
    expect(feedbackBody(NOTE, CTX)).toContain('Auftakt 0.9.0 · macOS 15.6 · 1728×1117 @2×');
    expect(feedbackBody(NOTE, { ...CTX, system: '' })).toContain('Auftakt 0.9.0 · macOS');
  });

  it('tells the reader to attach the file, above what they wrote', () => {
    // The instruction is for the customer, not the maintainer, so it has to be where a mail
    // client opens — the top — not under a „Technische Angaben" rule they will never scroll to.
    const withFile = feedbackBody(NOTE, ATTACHED);
    expect(withFile.startsWith(`!! BITTE NOCH ANHÄNGEN: ${FILE}`)).toBe(true);
    expect(withFile).toContain('liegt auf deinem Schreibtisch');
    // Promising an attachment the browser build never wrote is worse than offering none.
    expect(feedbackBody(NOTE, CTX)).not.toMatch(/anhängen/i);
  });

  it('sends the summary or the file, never both', () => {
    // The file holds the whole log; the summary is five folded lines of the same thing, and
    // the budget it costs is the person's to spend on words.
    expect(feedbackBody(NOTE, ATTACHED)).not.toContain('Startdiagnose');
    expect(feedbackBody(NOTE, CTX)).toContain('Startdiagnose — 2 Einträge');
  });

  it('drops the technical lines it has no values for', () => {
    // The browser-dev shape: no bridge, so no version, no platform, no diagnostics.
    const bare = feedbackBody(NOTE, {
      ref: '',
      version: '',
      platform: '',
      system: '',
      diagnostics: '',
      attachment: '',
    });
    expect(bare).toContain('Technische Angaben');
    expect(bare).not.toContain('Auftakt ');
    expect(bare).not.toContain('Kennung');
    expect(bare).not.toContain('Startdiagnose');
  });
});

describe('feedbackMailto', () => {
  it('survives the round trip through a URL reader', () => {
    // `+` is in the fixture on purpose: searchParams decodes `+` as a space, so this passes
    // only because encodeURIComponent writes it as %2B. `&`, `#` and the newlines are the
    // other three ways a hand-rolled query string quietly loses half the report.
    const tricky = 'a & b\nc # d\n1 + 1\n"Zitat" mit Ümläuten';
    const u = new URL(feedbackMailto(tricky, CTX));
    expect(u.protocol).toBe('mailto:');
    expect(u.pathname).toBe(FEEDBACK_TO);
    expect(u.searchParams.get('subject')).toBe(feedbackSubject(CTX));
    expect(u.searchParams.get('body')).toBe(feedbackBody(tricky, CTX));
  });

  it('leaves a mail that already fits completely alone', () => {
    expect(feedbackMailto(NOTE, CTX)).toBe(
      `mailto:${FEEDBACK_TO}?subject=${encodeURIComponent(feedbackSubject(CTX))}` +
        `&body=${encodeURIComponent(feedbackBody(NOTE, CTX))}`,
    );
  });

  it('spends the machine before a word the person wrote', () => {
    // There is nowhere to redirect the reader to — the file that would have carried the log is
    // the one that could not be written — so the digest goes, and what they typed stays.
    const body = bodyOf(NOTE, { ...CTX, diagnostics: summaryOf(100) });
    expect(body).not.toContain('Startdiagnose');
    expect(body).toContain('Kennung: AF-2608141542');
    expect(body).toContain(NOTE);
  });

  it('never spends the attachment line, which is the one that matters', () => {
    // The line naming the file survives every rung: without it the person is holding a file
    // nothing asked them for, and no other line in the mail can replace it.
    const body = bodyOf(german, { ...ATTACHED, diagnostics: summaryOf(100) });
    expect(body.startsWith(`!! BITTE NOCH ANHÄNGEN: ${FILE}`)).toBe(true);
  });

  it('marks the cut when even the note has to go', () => {
    // A note the size of the box is longer than a `mailto:` can carry, deliberately: the cap
    // is sized against the file. What the customer then sees in their compose window is a
    // marked cut, not a sentence that stops — and the file has the whole of it.
    const body = bodyOf(german.slice(0, FEEDBACK_NOTE_MAX), ATTACHED);
    expect(body).toContain('[…]');
    expect(body).toContain('--- Meldung');
  });

  it('lets a report-sized note through beside the attachment instructions', () => {
    // The shape the feature is actually used in: a couple of sentences, a file, and the two
    // lines telling the reader to attach it. Nothing here may be cut.
    const said = german.slice(0, 300);
    const body = bodyOf(said, ATTACHED);
    expect(body).not.toContain('[…]');
    expect(body).toContain(said.trimEnd());
  });

  it('never exceeds the budget, whatever it is handed', () => {
    const cases: [string, FeedbackContext][] = [
      ['', CTX],
      [NOTE, CTX],
      [NOTE, ATTACHED],
      [german, CTX],
      [german, ATTACHED],
      [german, { ...ATTACHED, diagnostics: summaryOf(100) }],
      [german.repeat(10), { ...CTX, diagnostics: summaryOf(100) }],
      ['ö'.repeat(5000), CTX],
      ['', { ref: '', version: '', platform: '', system: '', diagnostics: '', attachment: '' }],
    ];
    for (const [note, ctx] of cases) {
      expect(feedbackMailto(note, ctx).length).toBeLessThanOrEqual(MAILTO_MAX_CHARS);
    }
  });
});
