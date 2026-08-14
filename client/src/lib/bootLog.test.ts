import { describe, expect, it } from 'vitest';
import {
  BOOT_LOG_KEEP_LINES,
  BOOT_REPORT_MAX_CHARS,
  BOOT_SUMMARY_MAX_CHARS,
  bootLogLine,
  summarizeBootLog,
  trimBootLog,
} from '../../../electron/bootLog';

/**
 * Same arrangement as backupDir.test.ts: the module lives in `electron/`, imports nothing
 * from `electron`, and this suite is the only automated run that reaches it. What is worth
 * pinning is the trust boundary — the report crosses IPC from the renderer, so the line
 * builder is the one place deciding what an untrusted payload may put on disk — and the
 * rotation arithmetic, which silently eats the log's history if it is off by one.
 *
 * `summarizeBootLog` (WP-54) joins them for a third reason: its output is the text a
 * customer's support mail carries, so the format is a contract, and it re-reads the same
 * untrusted strings on the way *out* — into a mail body and a URL, where a newline forges
 * a line and a long field costs the whole mailto.
 */

const META = { at: '2026-08-11T12:00:00.000Z', app: '0.5.0' };

describe('bootLogLine', () => {
  it('wraps a report into one parseable line with the wrapper fields winning', () => {
    // A payload carrying its own `at`/`app` must not spoof the wrapper's — the log's
    // timestamps come from the main process, never from the renderer.
    const line = bootLogLine({ outcome: 'play', why: 'done', at: 'spoofed', app: 'spoofed' }, META);
    expect(line).not.toBeNull();
    expect(line).not.toContain('\n');
    const parsed = JSON.parse(line as string);
    expect(parsed.outcome).toBe('play');
    expect(parsed.at).toBe(META.at);
    expect(parsed.app).toBe(META.app);
  });

  it('drops what is not a plain object', () => {
    expect(bootLogLine('play', META)).toBeNull();
    expect(bootLogLine(42, META)).toBeNull();
    expect(bootLogLine(null, META)).toBeNull();
    expect(bootLogLine(undefined, META)).toBeNull();
    expect(bootLogLine([{ outcome: 'play' }], META)).toBeNull();
  });

  it('drops an oversized payload instead of writing it', () => {
    const fat = { pad: 'x'.repeat(BOOT_REPORT_MAX_CHARS) };
    expect(bootLogLine(fat, META)).toBeNull();
  });

  it('drops a payload JSON cannot serialise', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(bootLogLine(cyclic, META)).toBeNull();
    expect(
      bootLogLine(
        {
          toJSON() {
            throw new Error('nope');
          },
        },
        META,
      ),
    ).toBeNull();
  });
});

describe('trimBootLog', () => {
  const lines = (n: number, from = 0) =>
    Array.from({ length: n }, (_, i) => `{"i":${from + i}}`).join('\n') + '\n';

  it('keeps exactly the last N lines', () => {
    const trimmed = trimBootLog(lines(250));
    const kept = trimmed.split('\n').filter((l) => l.length > 0);
    expect(kept).toHaveLength(BOOT_LOG_KEEP_LINES);
    expect(kept[0]).toBe(`{"i":${250 - BOOT_LOG_KEEP_LINES}}`);
    expect(kept[kept.length - 1]).toBe('{"i":249}');
    expect(trimmed.endsWith('\n')).toBe(true);
  });

  it('returns short content unchanged apart from the trailing newline', () => {
    expect(trimBootLog(lines(3))).toBe(lines(3));
    // A file whose last write was torn mid-line still trims without losing whole lines.
    expect(trimBootLog('{"i":0}\n{"i":1}')).toBe('{"i":0}\n{"i":1}\n');
  });
});

describe('summarizeBootLog', () => {
  const rec = (r: Record<string, unknown>) =>
    JSON.stringify({ at: META.at, app: META.app, ...r });
  const log = (...rs: Record<string, unknown>[]) => rs.map(rec).join('\n') + '\n';

  const PLAY = {
    v: 1,
    outcome: 'play',
    why: 'done',
    readyMs: 420.3,
    startMs: 480,
    endMs: 2100.4,
    frames: { n: 58, med: 17, p95: 24, worst: 33, lead: 12, warm: 40, quick: 16, drops: 2 },
    tail: { n: 9, med: 17, p95: 20, worst: 21, verdict: 'ok' },
    dpr: 2,
    vp: [1440, 900],
  };

  const body = (content: string) => summarizeBootLog(content).split('\n').slice(1);

  it('says so when there is nothing to say', () => {
    const empty = 'Startdiagnose — keine Einträge (die App hat noch keinen Start protokolliert).';
    expect(summarizeBootLog('')).toBe(empty);
    expect(summarizeBootLog('\n\n')).toBe(empty);
  });

  it('renders a full report as one line, every clause in order', () => {
    // Pinned with toBe rather than toContain: this string is the format contract, and it is
    // read by a person triaging a mail, not by a parser that could tolerate a reshuffle.
    expect(body(log(PLAY))).toEqual([
      '2026-08-11 12:00 · v0.5.0 · play/done · bereit 420 · Start 480 · Ende 2100 ms · ' +
        '58 Bilder, Median 17 / p95 24 / max 33 ms, 2 Aussetzer',
    ]);
  });

  it('keeps outcome/why when there is nothing else — the markers main writes itself', () => {
    expect(body(log({ outcome: 'no-report', why: 'quit' }))).toEqual([
      '2026-08-11 12:00 · v0.5.0 · no-report/quit',
    ]);
    // `invalid-report` carries no `why`, so no trailing separator may appear.
    expect(body(log({ outcome: 'invalid-report' }))).toEqual([
      '2026-08-11 12:00 · v0.5.0 · invalid-report',
    ]);
  });

  it('drops a clause rather than printing undefined', () => {
    // The `reduced-motion` shape: nothing was measured, so nothing but the verdict survives.
    expect(body(log({ outcome: 'skip', why: 'reduced-motion', frames: null, tail: null }))).toEqual([
      '2026-08-11 12:00 · v0.5.0 · skip/reduced-motion',
    ]);
    // A run that saw no frame at all: `packed()` returns n:0 with the stats null, and
    // `drops` is absent entirely rather than 0.
    expect(
      body(log({ outcome: 'play', why: 'done', frames: { n: 0, med: null, p95: null, worst: null } })),
    ).toEqual(['2026-08-11 12:00 · v0.5.0 · play/done · 0 Bilder']);
  });

  it('mentions the reveal fade only when it misbehaved', () => {
    expect(body(log({ ...PLAY, tail: { ...PLAY.tail, verdict: 'ok' } }))[0]).not.toContain(
      'Nachlauf',
    );
    expect(body(log({ ...PLAY, tail: { ...PLAY.tail, verdict: 'hitch' } }))[0]).toContain(
      'Nachlauf hitch',
    );
  });

  it('skips what it cannot parse and counts only what it could', () => {
    const torn = rec(PLAY) + '\n{"outcome":"pl\n' + rec({ outcome: 'skip', why: 'warm' }) + '\n';
    const out = summarizeBootLog(torn);
    expect(out.split('\n')).toHaveLength(3);
    expect(out).toContain('2 Einträge');
    // Same rule bootLogLine applies on the way in: a bare scalar and an array are not records.
    expect(summarizeBootLog('42\n[{"outcome":"play"}]\n')).toContain('keine Einträge');
  });

  it('keeps the newest entries, last', () => {
    const many = log(...Array.from({ length: 9 }, (_, i) => ({ outcome: 'play', why: `w${i}` })));
    const lines = body(many);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain('play/w4');
    expect(lines[lines.length - 1]).toContain('play/w8');
    // Fewer records than asked for: all of them, and the header drops its "hier die neuesten".
    const few = summarizeBootLog(log({ outcome: 'play' }, { outcome: 'skip' }));
    expect(few.split('\n')[0]).toBe('Startdiagnose — 2 Einträge (Zeit in UTC):');
    expect(summarizeBootLog(log({ outcome: 'play' })).split('\n')[0]).toContain('1 Eintrag ');
  });

  it('counts the log in the header and never what is under it', () => {
    // The mail composer's ladder deletes lines from beneath this header to make a `mailto:`
    // fit, so a header saying „hier die letzten 5" is a header that arrives showing two of
    // them. The count that stays is the log's own, which trimming cannot make untrue.
    const many = log(...Array.from({ length: 9 }, (_, i) => ({ outcome: 'play', why: `w${i}` })));
    expect(summarizeBootLog(many).split('\n')[0]).toBe(
      'Startdiagnose — 9 Einträge, hier die neuesten (Zeit in UTC):',
    );
    expect(summarizeBootLog(many)).not.toMatch(/letzten \d/);
  });

  it('spends whole lines at its ceiling, oldest first', () => {
    // A `slice()` over the finished text cut the last line mid-clause — „· Ende 21" reads as a
    // corrupted record, and the record it corrupted is the newest one, which is the one the
    // report is about. Dropping from the top spends the boot nobody asked about.
    const fat = log(...Array.from({ length: 10 }, (_, i) => ({ ...PLAY, why: `w${i}`.padEnd(38, 'x') })));
    // Ten asked for, ~170 characters each: more than the ceiling, so the ceiling has to choose.
    const out = summarizeBootLog(fat, 10);
    const lines = out.split('\n').slice(1);
    expect(out.length).toBeLessThanOrEqual(BOOT_SUMMARY_MAX_CHARS);
    expect(lines.length).toBeLessThan(10);
    for (const line of lines) expect(line).toMatch(/Aussetzer$/);
    expect(out).toContain('play/w9');
    expect(out).not.toContain('play/w0');
  });

  it('cannot be made to forge a line or blow the mail up', () => {
    // `why` crosses IPC from the renderer and bootLogLine never inspects it. A newline in it
    // would invent a report line in the support mail; a long one would eat the mailto budget.
    const out = summarizeBootLog(log({ outcome: 'play', why: 'a\nb\n' + 'x'.repeat(500) }));
    expect(out.split('\n')).toHaveLength(2);
    expect(out.length).toBeLessThan(120);
    // And the whole thing stays inside its ceiling however fat the log is.
    const fat = log(...Array.from({ length: 100 }, () => ({ ...PLAY, why: 'y'.repeat(200) })));
    expect(summarizeBootLog(fat).length).toBeLessThanOrEqual(BOOT_SUMMARY_MAX_CHARS);
  });

  it('degrades a missing timestamp or version rather than leaking undefined', () => {
    // Not hypothetical: every line predating the wrapper, and any hand-edited log.
    const bare = '{"outcome":"play","why":"done"}\n';
    expect(summarizeBootLog(bare)).not.toContain('undefined');
    expect(body(bare)).toEqual(['? · play/done']);
  });
});
