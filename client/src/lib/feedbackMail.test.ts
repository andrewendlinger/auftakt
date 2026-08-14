import { describe, expect, it } from 'vitest';
import {
  FEEDBACK_FIELD_MAX,
  FEEDBACK_KINDS,
  FEEDBACK_TO,
  MAILTO_MAX_CHARS,
  feedbackBody,
  feedbackMailto,
  feedbackRef,
  feedbackSubject,
  requiredField,
  type FeedbackContext,
  type FeedbackDraft,
} from './feedbackMail';

/**
 * This composes the one artefact that leaves the app carrying diagnostics, into a URL
 * scheme with a hard length limit and an encoding that is easy to get subtly wrong. Both
 * failures are silent in exactly the situation the feature exists for: a mail client
 * truncates an over-long `mailto:` without saying so, and a mis-encoded `+` or umlaut
 * reaches the maintainer as a mangled report from someone who cannot try again.
 */

const DRAFT: FeedbackDraft = {
  kind: 'bug',
  area: 'Künstler',
  answers: {
    happened: 'Nichts — die Seite blieb leer.',
    did: 'Auf „Künstler & Projekte" geklickt.',
    expected: 'Die Liste hätte erscheinen sollen.',
  },
};

const WISH: FeedbackDraft = {
  kind: 'wish',
  area: 'Termine',
  answers: { want: 'Die Liste nach Land sortieren.', today: 'Ich sortiere in Excel.' },
};

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

const summaryOf = (n: number) =>
  ['Startdiagnose — Einträge:', ...Array.from({ length: n }, (_, i) => `Zeile ${i} `.repeat(8))].join(
    '\n',
  );

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

describe('FEEDBACK_KINDS', () => {
  it('gives every kind exactly one required field', () => {
    for (const kind of ['bug', 'wish'] as const) {
      const required = FEEDBACK_KINDS[kind].fields.filter((f) => f.required);
      expect(required).toHaveLength(1);
      expect(requiredField(kind).key).toBe(required[0]?.key);
    }
  });

  it('carries a wish without startup timings', () => {
    // Not cosmetic: it is what frees the budget the three fields then get to use.
    expect(FEEDBACK_KINDS.bug.diagnostics).toBe(true);
    expect(FEEDBACK_KINDS.wish.diagnostics).toBe(false);
  });
});

describe('feedbackSubject', () => {
  it('carries the reference, the kind, the area and the version', () => {
    expect(feedbackSubject(DRAFT, CTX)).toBe(
      '[AF-2608141542] Auftakt-Fehler: Künstler (v0.9.0)',
    );
    expect(feedbackSubject(WISH, CTX)).toBe('[AF-2608141542] Auftakt-Wunsch: Termine (v0.9.0)');
  });

  it('drops what it has no value for rather than printing an empty bracket', () => {
    expect(feedbackSubject(DRAFT, { ...CTX, version: '', ref: '' })).toBe(
      'Auftakt-Fehler: Künstler',
    );
  });
});

describe('feedbackBody', () => {
  it('puts the person first and the machine after the rule', () => {
    const body = feedbackBody(DRAFT, CTX);
    expect(body.indexOf('Nichts — die Seite blieb leer.')).toBeLessThan(body.indexOf('----------'));
    expect(body).toContain('Art: Fehler · Bereich: Künstler');
    expect(body).toContain('Kennung: AF-2608141542');
    expect(body).toContain('Startdiagnose — 2 Einträge');
  });

  it('heads each answer with the kind it was asked under', () => {
    expect(feedbackBody(DRAFT, CTX)).toContain('Was passiert ist:');
    // The same three text boxes, a different report — the wish must not inherit bug wording.
    const wish = feedbackBody(WISH, CTX);
    expect(wish).toContain('Was ich tun können möchte:');
    expect(wish).not.toContain('Was passiert ist:');
  });

  it('lets the machine line stand in for the platform rather than repeat it', () => {
    // „Auftakt 0.9.0 · Windows · Windows 11" is what naming both would produce.
    expect(feedbackBody(DRAFT, CTX)).toContain('Auftakt 0.9.0 · macOS 15.6 · 1728×1117 @2×');
    expect(feedbackBody(DRAFT, { ...CTX, system: '' })).toContain('Auftakt 0.9.0 · macOS');
  });

  it('omits a heading whose field is empty rather than mailing a blank one', () => {
    const body = feedbackBody({ ...DRAFT, answers: { happened: 'Leer.', did: '', expected: '  ' } }, CTX);
    expect(body).not.toContain('Was ich davor gemacht habe');
    expect(body).not.toContain('Was ich erwartet hätte');
    expect(body).toContain('Was passiert ist');
  });

  it('tells the reader to attach the file, above what they wrote', () => {
    // The instruction is for the customer, not the maintainer, so it has to be where a mail
    // client opens — the top — not under a „Technische Angaben" rule they will never scroll to.
    const withFile = feedbackBody(DRAFT, { ...CTX, attachment: 'Auftakt-Diagnose-AF-2608141542.txt' });
    expect(withFile).toContain('Bitte noch anhängen: Auftakt-Diagnose-AF-2608141542.txt');
    expect(withFile).toContain('liegt auf deinem Schreibtisch');
    expect(withFile.indexOf('Bitte noch anhängen')).toBeLessThan(
      withFile.indexOf('Nichts — die Seite blieb leer.'),
    );
    // Promising an attachment the browser build never wrote is worse than offering none.
    expect(feedbackBody(DRAFT, CTX)).not.toContain('anhängen');
  });

  it('sends the summary or the file, never both', () => {
    // The file holds the whole log; the summary is five folded lines of the same thing, and
    // the budget it costs is the person's to spend on words.
    const withFile = feedbackBody(DRAFT, { ...CTX, attachment: 'Auftakt-Diagnose-AF-2608141542.txt' });
    expect(withFile).not.toContain('Startdiagnose');
    expect(feedbackBody(DRAFT, CTX)).toContain('Startdiagnose — 2 Einträge');
  });

  it('drops the technical lines it has no values for', () => {
    // The browser-dev shape: no bridge, so no version, no platform, no diagnostics.
    const bare = feedbackBody(DRAFT, {
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
    const tricky = {
      ...DRAFT,
      answers: { ...DRAFT.answers, happened: 'a & b\nc # d\n1 + 1\n"Zitat" mit Ümläuten' },
    };
    const u = new URL(feedbackMailto(tricky, CTX));
    expect(u.protocol).toBe('mailto:');
    expect(u.pathname).toBe(FEEDBACK_TO);
    expect(u.searchParams.get('subject')).toBe(feedbackSubject(tricky, CTX));
    expect(u.searchParams.get('body')).toBe(feedbackBody(tricky, CTX));
  });

  it('leaves a mail that already fits completely alone', () => {
    expect(feedbackMailto(DRAFT, CTX)).toBe(
      `mailto:${FEEDBACK_TO}?subject=${encodeURIComponent(feedbackSubject(DRAFT, CTX))}` +
        `&body=${encodeURIComponent(feedbackBody(DRAFT, CTX))}`,
    );
  });

  it('drops diagnostic entries oldest first, keeping the newest boot', () => {
    const ctx = { ...CTX, diagnostics: summaryOf(20) };
    const body = new URL(feedbackMailto(DRAFT, ctx)).searchParams.get('body') ?? '';
    expect(body).toContain('Startdiagnose — Einträge:');
    // The last boot is the one that prompted the report, so it must outlive the rest.
    expect(body).toContain('Zeile 19');
    expect(body).not.toContain('Zeile 0 ');
  });

  it('spends the whole block rather than the words, when nothing was attached', () => {
    // There is nowhere to redirect the reader to — the file that would have carried it is the
    // one that could not be written — so it goes, and what they typed stays.
    const ctx = { ...CTX, diagnostics: 'Startdiagnose:\n' + 'ü'.repeat(4000) };
    const body = new URL(feedbackMailto(DRAFT, ctx)).searchParams.get('body') ?? '';
    expect(body).not.toContain('Startdiagnose');
    expect(body).toContain('Kennung: AF-2608141542');
    expect(body).toContain('Nichts — die Seite blieb leer.');
  });

  it('never spends the attachment line, which is the one that matters', () => {
    // The line naming the file survives every rung: without it the person is holding a file
    // nothing asked them for, and no other line in the mail can replace it.
    const ctx = {
      ...CTX,
      diagnostics: summaryOf(100),
      attachment: 'Auftakt-Diagnose-AF-2608141542.txt',
    };
    const fat = { ...DRAFT, answers: { happened: 'ö'.repeat(5000), did: 'ä'.repeat(5000) } };
    const body = new URL(feedbackMailto(fat, ctx)).searchParams.get('body') ?? '';
    expect(body).toContain('Bitte noch anhängen: Auftakt-Diagnose-AF-2608141542.txt');
  });

  it('marks the cut when even the text has to go', () => {
    const fat = { ...DRAFT, answers: { ...DRAFT.answers, happened: 'ä'.repeat(FEEDBACK_FIELD_MAX * 4) } };
    const body = new URL(feedbackMailto(fat, CTX)).searchParams.get('body') ?? '';
    expect(body).toContain('[…]');
  });

  it('never exceeds the budget, whatever it is handed', () => {
    const attached = 'Auftakt-Diagnose-AF-2608141542.txt';
    const cases: [FeedbackDraft, FeedbackContext][] = [
      [DRAFT, CTX],
      [WISH, CTX],
      [DRAFT, { ...CTX, diagnostics: summaryOf(100) }],
      [DRAFT, { ...CTX, diagnostics: summaryOf(100), attachment: attached }],
      [
        { ...DRAFT, answers: { happened: 'ö'.repeat(5000) } },
        { ...CTX, diagnostics: summaryOf(100), attachment: attached },
      ],
      [{ kind: 'bug', area: 'Allgemein', answers: {} }, CTX],
    ];
    for (const [draft, ctx] of cases) {
      expect(feedbackMailto(draft, ctx).length).toBeLessThanOrEqual(MAILTO_MAX_CHARS);
    }
  });

  // Prose, not 'ä'.repeat(): the cap is sized for what people write, and an all-umlaut field
  // encodes to six times its length — that case is the ladder's job, asserted above.
  const prose = 'Die Übersicht zeigte nichts an, obwohl Termine angelegt waren. '.repeat(20);
  const one = prose.slice(0, FEEDBACK_FIELD_MAX);
  const maxed: FeedbackDraft = {
    kind: 'bug',
    area: 'Allgemein',
    answers: { happened: one, did: one, expected: one },
  };

  it('lets three full fields of ordinary German through beside a full summary', () => {
    // The claim the dialog's maxLength rests on, in the shape where the mail is the only
    // thing carrying diagnostics: no file was written, so the newest boot has to survive.
    const body = new URL(feedbackMailto(maxed, { ...CTX, diagnostics: summaryOf(5) })).searchParams.get(
      'body',
    );
    expect(body).not.toContain('[…]');
    expect(body).toContain(one.trimEnd());
    expect(body).toContain('Zeile 4');
  });

  it('fits three full fields beside the attachment instructions', () => {
    // The tightest shape the feature can produce: a reference, a machine clause and the
    // two-line attach instruction, with no diagnostic block left to spend — the file has it,
    // so the person's own text is the only thing the ladder could still take. It must not.
    const full = {
      ...CTX,
      diagnostics: summaryOf(5),
      attachment: 'Auftakt-Diagnose-AF-2608141542.txt',
    };
    const body = new URL(feedbackMailto(maxed, full)).searchParams.get('body') ?? '';
    expect(body).not.toContain('[…]');
    expect(body).toContain(one.trimEnd());
    expect(body).toContain('Bitte noch anhängen: Auftakt-Diagnose-AF-2608141542.txt');
  });
});
