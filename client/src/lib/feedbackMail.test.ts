import { describe, expect, it } from 'vitest';
import {
  FEEDBACK_FIELD_MAX,
  FEEDBACK_TO,
  MAILTO_MAX_CHARS,
  feedbackBody,
  feedbackMailto,
  feedbackSubject,
} from './feedbackMail';

/**
 * This composes the one artefact that leaves the app carrying diagnostics, into a URL
 * scheme with a hard length limit and an encoding that is easy to get subtly wrong. Both
 * failures are silent in exactly the situation the feature exists for: a mail client
 * truncates an over-long `mailto:` without saying so, and a mis-encoded `+` or umlaut
 * reaches the maintainer as a mangled report from someone who cannot try again.
 */

const DRAFT = {
  area: 'Künstler',
  did: 'Auf „Künstler & Projekte" geklickt.',
  happened: 'Nichts — die Seite blieb leer.',
  expected: 'Die Liste hätte erscheinen sollen.',
};

const CTX = {
  version: '0.9.0',
  platform: 'darwin',
  diagnostics:
    'Startdiagnose — 2 Einträge (Zeit in UTC):\n' +
    '2026-08-11 12:00 · v0.9.0 · play/done · bereit 420 · Ende 2100 ms\n' +
    '2026-08-11 12:03 · v0.9.0 · skip/warm · bereit 120 · Ende 300 ms',
};

const summaryOf = (n: number) =>
  ['Startdiagnose — Einträge:', ...Array.from({ length: n }, (_, i) => `Zeile ${i} `.repeat(8))].join(
    '\n',
  );

describe('feedbackSubject', () => {
  it('carries the area and the version', () => {
    expect(feedbackSubject(DRAFT, CTX)).toBe('Auftakt-Feedback: Künstler (v0.9.0)');
    expect(feedbackSubject(DRAFT, { ...CTX, version: '' })).toBe('Auftakt-Feedback: Künstler');
  });
});

describe('feedbackBody', () => {
  it('puts the person first and the machine after the rule', () => {
    const body = feedbackBody(DRAFT, CTX);
    expect(body.indexOf('Nichts — die Seite blieb leer.')).toBeLessThan(body.indexOf('----------'));
    expect(body).toContain('Bereich: Künstler');
    expect(body).toContain('Auftakt 0.9.0 · macOS');
    expect(body).toContain('Startdiagnose — 2 Einträge');
  });

  it('omits a heading whose field is empty rather than mailing a blank one', () => {
    const body = feedbackBody({ ...DRAFT, did: '', expected: '   ' }, CTX);
    expect(body).not.toContain('Was ich gemacht habe');
    expect(body).not.toContain('Was ich erwartet hätte');
    expect(body).toContain('Was passiert ist');
  });

  it('drops the technical lines it has no values for', () => {
    // The browser-dev shape: no bridge, so no version, no platform, no diagnostics.
    const bare = feedbackBody(DRAFT, { version: '', platform: '', diagnostics: '' });
    expect(bare).toContain('Technische Angaben');
    expect(bare).not.toContain('Auftakt ');
    expect(bare).not.toContain('Startdiagnose');
  });
});

describe('feedbackMailto', () => {
  it('survives the round trip through a URL reader', () => {
    // `+` is in the fixture on purpose: searchParams decodes `+` as a space, so this passes
    // only because encodeURIComponent writes it as %2B. `&`, `#` and the newlines are the
    // other three ways a hand-rolled query string quietly loses half the report.
    const tricky = { ...DRAFT, happened: 'a & b\nc # d\n1 + 1\n"Zitat" mit Ümläuten' };
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

  it('trades the block for a pointer at the file rather than for silence', () => {
    const ctx = { ...CTX, diagnostics: 'Startdiagnose:\n' + 'ü'.repeat(4000) };
    const body = new URL(feedbackMailto(DRAFT, ctx)).searchParams.get('body') ?? '';
    expect(body).toContain('Diagnoseordner öffnen');
    expect(body).toContain('boot-log.jsonl');
    // The person's own words are never the first thing cut.
    expect(body).toContain('Nichts — die Seite blieb leer.');
  });

  it('marks the cut when even the text has to go', () => {
    const fat = { ...DRAFT, happened: 'ä'.repeat(FEEDBACK_FIELD_MAX * 4) };
    const body = new URL(feedbackMailto(fat, CTX)).searchParams.get('body') ?? '';
    expect(body).toContain('[…]');
  });

  it('never exceeds the budget, whatever it is handed', () => {
    const cases = [
      [DRAFT, CTX],
      [DRAFT, { ...CTX, diagnostics: summaryOf(100) }],
      [{ ...DRAFT, happened: 'ö'.repeat(5000) }, { ...CTX, diagnostics: summaryOf(100) }],
      [{ area: 'Allgemein', did: '', happened: '', expected: '' }, CTX],
    ] as const;
    for (const [draft, ctx] of cases) {
      expect(feedbackMailto(draft, ctx).length).toBeLessThanOrEqual(MAILTO_MAX_CHARS);
    }
  });

  it('lets three full fields of ordinary German through beside a full summary', () => {
    // The claim the dialog's maxLength rests on. Prose, not 'ä'.repeat(): the cap is sized
    // for what people write, and an all-umlaut field encodes to six times its length — that
    // case is the ladder's job, asserted above, not the cap's.
    const prose = 'Die Übersicht zeigte nichts an, obwohl Termine angelegt waren. '.repeat(20);
    const maxed = {
      area: 'Allgemein',
      did: prose.slice(0, FEEDBACK_FIELD_MAX),
      happened: prose.slice(0, FEEDBACK_FIELD_MAX),
      expected: prose.slice(0, FEEDBACK_FIELD_MAX),
    };
    const full = { ...CTX, diagnostics: summaryOf(5) };
    const body = new URL(feedbackMailto(maxed, full)).searchParams.get('body') ?? '';
    expect(body).not.toContain('[…]');
    expect(body).toContain(prose.slice(0, FEEDBACK_FIELD_MAX).trimEnd());
    expect(body).toContain('Zeile 4');
  });
});
