import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  APP_LOG_EVENT_MAX_CHARS,
  APP_LOG_FIELD_CAPS,
  APP_LOG_KEEP_BYTES,
  APP_LOG_KEEP_LINES,
  APP_LOG_MAX_BYTES,
  APP_LOG_NAME,
  BOOT_LOG_NAME,
  BOOT_REPORT_MAX_CHARS,
  BOOT_SUMMARY_MAX_CHARS,
  BUNDLE_TAIL_LINES,
  CONSOLE_ARGS_MAX_CHARS,
  appLogLine,
  bootDiagnostics,
  bootLogLine,
  countEntries,
  formatConsoleArgs,
  splitConsoleArgs,
  migrateBootLog,
  splitAppLog,
  summarizeBootLog,
  tailAppLog,
  trimAppLog,
  writeAppLog,
  writeBootReport,
} from '../../../electron/appLog';

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
 *
 * WP-69 put the runtime log in the same file, which adds one thing to pin above all others:
 * a boot line never carries `src` and a runtime line always does, because that is the only
 * thing telling `check:boot`, the cross-version boot analysis and the German digest which
 * lines are theirs.
 */

const META = { at: '2026-08-11T12:00:00.000Z', app: '0.5.0' };
const RUN = { ...META, src: 'main' } as const;

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

  it('never writes an `src` key — that absence is what makes the line a boot line', () => {
    const parsed = JSON.parse(bootLogLine({ v: 2, outcome: 'play', why: 'done' }, META) as string);
    expect('src' in parsed).toBe(false);
    // And the shape the WP-61b/c analysis reads is otherwise untouched by the unification.
    expect(Object.keys(parsed)).toEqual(['v', 'outcome', 'why', 'at', 'app']);
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

describe('appLogLine', () => {
  it('stamps v, at, app and src, and a payload cannot spoof any of them', () => {
    const line = appLogLine(
      { event: 'uncaught-exception', msg: 'boom', at: 'spoofed', app: '9.9.9', src: 'renderer' },
      RUN,
    );
    expect(line).not.toBeNull();
    expect(line).not.toContain('\n');
    const parsed = JSON.parse(line as string);
    expect(parsed).toEqual({
      v: 1,
      event: 'uncaught-exception',
      msg: 'boom',
      at: RUN.at,
      app: RUN.app,
      src: 'main',
    });
  });

  it('always carries src, so the read side can tell it from a boot report', () => {
    // Even an entry that looks exactly like a boot report is a runtime line here.
    const parsed = JSON.parse(appLogLine({ outcome: 'play', why: 'done' }, RUN) as string);
    expect(parsed.src).toBe('main');
  });

  it('caps the fields whose length nobody controls', () => {
    const parsed = JSON.parse(
      appLogLine(
        {
          event: 'e'.repeat(200),
          msg: 'm'.repeat(2000),
          stack: 'TOP' + 's'.repeat(9000),
          note: 'n'.repeat(20), // not a capped field: it rides along whole
        },
        RUN,
      ) as string,
    );
    expect(parsed.event).toHaveLength(APP_LOG_FIELD_CAPS.event as number);
    expect(parsed.msg).toHaveLength(APP_LOG_FIELD_CAPS.msg as number);
    expect(parsed.stack).toHaveLength(APP_LOG_FIELD_CAPS.stack as number);
    // The cap must cut the tail, not the head: the top frames are the ones that name the
    // throw site, and they are what sourcemapped stacks exist for.
    expect(parsed.stack.startsWith('TOP')).toBe(true);
    expect(parsed.note).toHaveLength(20);
  });

  it('shortens the stack before surrendering the line to the marker', () => {
    // 3000 backslashes fit the raw field cap but serialize to 6000: the whole-line cap counts
    // escaped characters, and Windows stacks are the ones that inflate. The deepest crash must
    // survive with less stack, not vanish into an invalid-log-event marker.
    const parsed = JSON.parse(
      appLogLine({ event: 'crash', msg: 'm', stack: '\\'.repeat(3000) }, RUN) as string,
    );
    expect(parsed.event).toBe('crash');
    expect(parsed.stack).toHaveLength(1500);
    expect(JSON.stringify(parsed).length).toBeLessThanOrEqual(APP_LOG_EVENT_MAX_CHARS);
    // When the bloat is not the stack, dropping the stack cannot save it — the marker stands.
    expect(appLogLine({ event: 'x', stack: 's', pad: 'p'.repeat(5000) }, RUN)).toBeNull();
  });

  it('stamps the envelope version itself, so an entry cannot claim another one', () => {
    const parsed = JSON.parse(appLogLine({ event: 'x', v: 99 }, RUN) as string);
    expect(parsed.v).toBe(1);
  });

  it('stays one line however many newlines a stack carries', () => {
    const line = appLogLine({ event: 'x', stack: 'a\nb\nc' }, RUN) as string;
    expect(line).not.toContain('\n');
    expect(JSON.parse(line).stack).toBe('a\nb\nc');
  });

  it('drops what is not a plain object', () => {
    expect(appLogLine('boom', RUN)).toBeNull();
    expect(appLogLine(42, RUN)).toBeNull();
    expect(appLogLine(null, RUN)).toBeNull();
    expect(appLogLine(undefined, RUN)).toBeNull();
    expect(appLogLine([{ event: 'x' }], RUN)).toBeNull();
  });

  it('drops an oversized entry — the field caps do not bound the fields it invented', () => {
    expect(appLogLine({ event: 'x', pad: 'p'.repeat(APP_LOG_EVENT_MAX_CHARS) }, RUN)).toBeNull();
  });

  it('drops an entry it cannot read or serialise', () => {
    const cyclic: Record<string, unknown> = { event: 'x' };
    cyclic.self = cyclic;
    expect(appLogLine(cyclic, RUN)).toBeNull();
    const hostile = Object.defineProperty({ event: 'x' }, 'boom', {
      enumerable: true,
      get() {
        throw new Error('nope');
      },
    });
    expect(appLogLine(hostile, RUN)).toBeNull();
    expect(
      appLogLine(
        {
          toJSON() {
            throw new Error('nope');
          },
        },
        RUN,
      ),
    ).toBeNull();
  });
});

describe('trimAppLog', () => {
  const lines = (n: number, from = 0) =>
    Array.from({ length: n }, (_, i) => `{"i":${from + i}}`).join('\n') + '\n';

  it('holds the invariant that makes rotation cheap', () => {
    // Trim to at most half the trigger, so an append after a rotation has a whole rotation's
    // worth of headroom. Without it a fat log rotates on every single append: rewrite, still
    // over, rewrite again — the sync write path that the 500-loop and the crash handler use.
    expect(APP_LOG_KEEP_BYTES * 2).toBeLessThanOrEqual(APP_LOG_MAX_BYTES);
  });

  it('keeps exactly the last N lines when the line bound is the binding one', () => {
    const total = APP_LOG_KEEP_LINES + 150;
    const trimmed = trimAppLog(lines(total));
    const kept = trimmed.split('\n').filter((l) => l.length > 0);
    expect(kept).toHaveLength(APP_LOG_KEEP_LINES);
    expect(kept[0]).toBe(`{"i":${total - APP_LOG_KEEP_LINES}}`);
    expect(kept[kept.length - 1]).toBe(`{"i":${total - 1}}`);
    expect(trimmed.endsWith('\n')).toBe(true);
  });

  it('keeps fewer lines when the byte bound is the binding one', () => {
    // A runtime line carries a stack: 500 of them is megabytes, far past the trigger the
    // rotation is supposed to get back under. This is the case a lines-only bound got wrong.
    const fat = Array.from(
      { length: APP_LOG_KEEP_LINES },
      (_, i) => JSON.stringify({ i, stack: 'x'.repeat(3000) }),
    ).join('\n') + '\n';
    const kept = trimAppLog(fat).split('\n').filter((l) => l.length > 0);
    expect(kept.length).toBeLessThan(APP_LOG_KEEP_LINES);
    expect(Buffer.byteLength(trimAppLog(fat), 'utf8')).toBeLessThanOrEqual(APP_LOG_KEEP_BYTES);
    // Whole lines only, newest last: every survivor still parses.
    for (const line of kept) expect(() => JSON.parse(line)).not.toThrow();
    expect(JSON.parse(kept[kept.length - 1] as string).i).toBe(APP_LOG_KEEP_LINES - 1);
  });

  it('counts bytes and not characters', () => {
    // Two bytes per umlaut. A character-counting budget lets a German log past the trigger.
    const line = JSON.stringify({ msg: 'ä'.repeat(50) });
    const kept = trimAppLog(`${line}\n${line}\n${line}\n`, 10, Buffer.byteLength(line, 'utf8') * 2);
    expect(kept.split('\n').filter((l) => l.length > 0)).toHaveLength(1);
  });

  it('keeps the newest line even when it alone busts the byte budget', () => {
    // An empty log is worse than an oversized one, and cutting the line is not on offer.
    expect(trimAppLog('{"i":0}\n{"i":1}\n', 10, 2)).toBe('{"i":1}\n');
  });

  it('returns short content unchanged apart from the trailing newline', () => {
    expect(trimAppLog(lines(3))).toBe(lines(3));
    // A file whose last write was torn mid-line still trims without losing whole lines.
    expect(trimAppLog('{"i":0}\n{"i":1}')).toBe('{"i":0}\n{"i":1}\n');
    expect(trimAppLog('')).toBe('');
    expect(trimAppLog('\n\n')).toBe('');
  });
});

describe('tailAppLog', () => {
  const line = (i: number) => JSON.stringify({ i, msg: 'm'.repeat(100) });
  const log = (n: number) => Array.from({ length: n }, (_, i) => line(i)).join('\n') + '\n';

  it('takes the newest lines up to the bundle line budget', () => {
    const kept = tailAppLog(log(BUNDLE_TAIL_LINES + 50)).split('\n').filter((l) => l.length > 0);
    expect(kept).toHaveLength(BUNDLE_TAIL_LINES);
    expect(JSON.parse(kept[kept.length - 1] as string).i).toBe(BUNDLE_TAIL_LINES + 49);
  });

  it('stays inside the byte budget and never cuts a line in half', () => {
    const out = tailAppLog(log(50), BUNDLE_TAIL_LINES, 600);
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(600);
    const kept = out.split('\n').filter((l) => l.length > 0);
    expect(kept.length).toBeGreaterThan(0);
    for (const l of kept) expect(() => JSON.parse(l)).not.toThrow();
    expect(JSON.parse(kept[kept.length - 1] as string).i).toBe(49);
  });

  it('says nothing about an empty log rather than inventing a newline', () => {
    expect(tailAppLog('')).toBe('');
  });
});

describe('countEntries', () => {
  it('counts non-empty lines of either kind', () => {
    expect(countEntries('')).toBe(0);
    expect(countEntries('\n\n')).toBe(0);
    expect(countEntries('{"outcome":"play"}\n')).toBe(1);
    expect(countEntries('{"outcome":"play"}\n{"event":"x","src":"main"}\n')).toBe(2);
    // A torn last line is still an entry as far as the bundle header is concerned.
    expect(countEntries('{"a":1}\n{"b":')).toBe(2);
  });
});

describe('splitAppLog', () => {
  const BOOT = '{"outcome":"play","why":"done","at":"2026-08-25T09:00:00.000Z"}';
  const RUNTIME = '{"v":1,"event":"server-error","msg":"boom","at":"2026-08-25T09:00:01.000Z","src":"server"}';

  it('sorts the two kinds apart by the one discriminator, keeping the lines verbatim', () => {
    const { boot, runtime } = splitAppLog(`${BOOT}\n${RUNTIME}\n`);
    expect(boot).toEqual([BOOT]);
    expect(runtime).toEqual([RUNTIME]);
  });

  it('keeps each side in file order and loses nothing in between', () => {
    // The bundle prints both sides raw, and a boot analysis reads them in the order they
    // were written — interleaving with runtime lines must not reorder either side.
    const lines = ['{"outcome":"a"}', RUNTIME, '{"outcome":"b"}', RUNTIME, '{"outcome":"c"}'];
    const { boot, runtime } = splitAppLog(lines.join('\n') + '\n');
    expect(boot).toEqual(['{"outcome":"a"}', '{"outcome":"b"}', '{"outcome":"c"}']);
    expect(runtime).toHaveLength(2);
    expect(boot.length + runtime.length).toBe(countEntries(lines.join('\n')));
  });

  it('counts an explicit null src as a runtime line, like isBootLine does', () => {
    const { boot, runtime } = splitAppLog('{"outcome":"play","src":null}\n');
    expect(boot).toEqual([]);
    expect(runtime).toHaveLength(1);
  });

  it('never drops a line it cannot read — an unreadable log line is itself a finding', () => {
    // `trimAppLog` does not validate JSON, so a rotated file really can carry a torn line,
    // and so can a disk that lost a write. It belongs in the bundle either way.
    const { boot, runtime } = splitAppLog(`${BOOT}\n{"b":\nnot json at all\n[1,2,3]\n"a string"\n`);
    expect(boot).toEqual([BOOT]);
    expect(runtime).toEqual(['{"b":', 'not json at all', '[1,2,3]', '"a string"']);
  });

  it('says nothing about an empty log', () => {
    expect(splitAppLog('')).toEqual({ boot: [], runtime: [] });
    expect(splitAppLog('\n\n')).toEqual({ boot: [], runtime: [] });
  });
});

describe('writing (the one file both kinds land in)', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'auftakt-applog-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const read = () => readFileSync(join(dir, APP_LOG_NAME), 'utf8');
  const parsed = () =>
    read()
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l));

  it('writes boot reports and runtime events into app-log.jsonl, in order', () => {
    writeBootReport(dir, { outcome: 'play', why: 'done' }, '0.11.0');
    writeAppLog(dir, { event: 'app-start' }, { app: '0.11.0', src: 'main' });
    writeBootReport(dir, { outcome: 'no-report', why: 'quit' }, '0.11.0');
    expect(existsSync(join(dir, BOOT_LOG_NAME))).toBe(false);
    const [boot, run, quit] = parsed();
    expect(boot.outcome).toBe('play');
    expect('src' in boot).toBe(false);
    expect(run).toMatchObject({ v: 1, event: 'app-start', src: 'main', app: '0.11.0' });
    expect(quit.outcome).toBe('no-report');
    // …and the digest still describes the two boots and not the three lines.
    expect(summarizeBootLog(read())).toContain('2 Einträge');
  });

  it('writes a marker rather than nothing when a payload is unusable', () => {
    // A renderer sending garbage is itself a finding, on both channels.
    writeBootReport(dir, 'not a report', '0.11.0');
    writeAppLog(dir, ['not', 'an', 'entry'], { app: '0.11.0', src: 'renderer' });
    writeAppLog(dir, { event: 'x', pad: 'p'.repeat(APP_LOG_EVENT_MAX_CHARS) }, {
      app: '0.11.0',
      src: 'renderer',
    });
    const [boot, invalid, oversized] = parsed();
    expect(boot).toMatchObject({ outcome: 'invalid-report', app: '0.11.0' });
    expect('src' in boot).toBe(false);
    expect(invalid).toMatchObject({ v: 1, event: 'invalid-log-event', src: 'renderer' });
    expect(oversized).toMatchObject({ v: 1, event: 'invalid-log-event', src: 'renderer' });
    expect(typeof invalid.at).toBe('string');
  });

  it('rotates back under the trigger instead of growing without end', () => {
    const stack = 'x'.repeat(3000);
    for (let i = 0; i < 250; i++) {
      writeAppLog(dir, { event: 'boom', stack, i }, { app: '0.11.0', src: 'server' });
    }
    const size = statSync(join(dir, APP_LOG_NAME)).size;
    expect(size).toBeLessThanOrEqual(APP_LOG_MAX_BYTES);
    const lines = parsed();
    expect(lines.length).toBeLessThanOrEqual(APP_LOG_KEEP_LINES);
    // Rotation spends the oldest lines, never the one that was just written.
    expect(lines[lines.length - 1].i).toBe(249);
  });

  it('swallows an unwritable directory rather than taking the boot with it', () => {
    const gone = join(dir, 'nope');
    expect(() => writeBootReport(gone, { outcome: 'play' }, '0.11.0')).not.toThrow();
    expect(() => writeAppLog(gone, { event: 'x' }, { app: '0.11.0', src: 'main' })).not.toThrow();
  });

  it('reads the unified file back out for the „Fehler" dialog', () => {
    // `hasLog` and `summary` come from one read, so they cannot disagree about the file.
    const before = bootDiagnostics(dir);
    expect(before.hasLog).toBe(false);
    expect(before.file).toBe(join(dir, APP_LOG_NAME));
    expect(before.summary).toContain('keine Einträge');
    writeBootReport(dir, { outcome: 'play', why: 'done' }, '0.11.0');
    writeAppLog(dir, { event: 'app-start' }, { app: '0.11.0', src: 'main' });
    const after = bootDiagnostics(dir);
    expect(after.hasLog).toBe(true);
    expect(after.summary).toContain('1 Eintrag ');
  });
});

describe('migrateBootLog', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'auftakt-applog-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const legacy = () => join(dir, BOOT_LOG_NAME);
  const unified = () => join(dir, APP_LOG_NAME);

  it('renames the old log when it is the only one there', () => {
    writeFileSync(legacy(), '{"outcome":"play"}\n', 'utf8');
    migrateBootLog(dir);
    expect(existsSync(legacy())).toBe(false);
    expect(readFileSync(unified(), 'utf8')).toBe('{"outcome":"play"}\n');
  });

  it('leaves both alone when the unified log already exists', () => {
    writeFileSync(legacy(), '{"outcome":"old"}\n', 'utf8');
    writeFileSync(unified(), '{"outcome":"new"}\n', 'utf8');
    migrateBootLog(dir);
    expect(readFileSync(unified(), 'utf8')).toBe('{"outcome":"new"}\n');
    expect(readFileSync(legacy(), 'utf8')).toBe('{"outcome":"old"}\n');
  });

  it('is a no-op on a fresh install and idempotent on every launch after the first', () => {
    expect(() => migrateBootLog(dir)).not.toThrow();
    expect(existsSync(unified())).toBe(false);
    writeFileSync(legacy(), '{"outcome":"play"}\n', 'utf8');
    migrateBootLog(dir);
    migrateBootLog(dir);
    migrateBootLog(dir);
    expect(readFileSync(unified(), 'utf8')).toBe('{"outcome":"play"}\n');
    // A directory that is not there at all is a first launch under a broken userData.
    expect(() => migrateBootLog(join(dir, 'nope'))).not.toThrow();
  });
});

describe('formatConsoleArgs', () => {
  it('keeps an Error readable — message and stack, which is the whole point', () => {
    const out = formatConsoleArgs(['API-Fehler', 'GET', '/api/tasks/7', new Error('no such row')]);
    expect(out).toContain('API-Fehler GET /api/tasks/7');
    expect(out).toContain('no such row');
    expect(out).toContain('appLog.test.ts'); // a frame, i.e. the stack really is in there
  });

  it('survives what a console argument can be', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(formatConsoleArgs([cyclic])).toContain('Circular');

    const hostile = Object.defineProperty({ ok: 1 }, 'boom', {
      enumerable: true,
      get() {
        throw new Error('nope');
      },
    });
    // `getters: false` prints the getter rather than running it, which is why this is safe.
    expect(formatConsoleArgs([hostile])).toContain('ok: 1');

    const cursed = {
      [Symbol.for('nodejs.util.inspect.custom')]() {
        throw new Error('nope');
      },
    };
    expect(formatConsoleArgs([cursed])).toContain('[unformattable]');
    expect(
      formatConsoleArgs([
        {
          toString() {
            throw new Error('nope');
          },
        },
      ]),
    ).toContain('toString');
  });

  it('joins mixed primitives the way a console would read them', () => {
    expect(formatConsoleArgs(['n =', 42, true, null, undefined])).toBe(
      'n = 42 true null undefined',
    );
    expect(formatConsoleArgs([])).toBe('');
    expect(formatConsoleArgs([{ a: [1, 2] }])).toBe('{ a: [ 1, 2 ] }');
  });

  it('caps what it returns — a console argument can be a whole file', () => {
    const out = formatConsoleArgs(['x'.repeat(50_000)]);
    expect(out.length).toBeLessThanOrEqual(CONSOLE_ARGS_MAX_CHARS);
    expect(out.endsWith('[…]')).toBe(true);
    // A thousand arguments must not cost a thousand inspects either.
    const many = formatConsoleArgs(Array.from({ length: 1000 }, (_, i) => `arg${i}`));
    expect(many.length).toBeLessThanOrEqual(CONSOLE_ARGS_MAX_CHARS);
  });

  it('never throws, whatever it is handed', () => {
    // It runs inside the wrapped console.error and on the uncaughtException path: an
    // exception here replaces the error being reported with an error about reporting it.
    const boom = () => {
      throw new Error('nope');
    };
    const cases: unknown[][] = [
      [Symbol('s')],
      [10n],
      [() => 0],
      [new Proxy({}, { get: boom, ownKeys: boom, getOwnPropertyDescriptor: boom })],
      [Object.create(null)],
      [new Map([[{ a: 1 }, new Set([1, 2])]])],
    ];
    for (const args of cases) {
      expect(() => formatConsoleArgs(args)).not.toThrow();
      expect(typeof formatConsoleArgs(args)).toBe('string');
    }
  });
});

describe('splitConsoleArgs', () => {
  it('lifts the stack out of the message, which is what the 500-char msg cap demands', () => {
    const { msg, stack } = splitConsoleArgs([
      'API-Fehler',
      'GET',
      '/api/tasks/7',
      new Error('no such row'),
    ]);
    expect(msg).toContain('API-Fehler GET /api/tasks/7');
    expect(msg).toContain('Error: no such row');
    expect(msg).not.toContain('appLog.test.ts'); // no frames in msg …
    expect(stack).toContain('appLog.test.ts'); // … they all live here, under the 3000 cap
  });

  it('takes the first stack-carrying Error and leaves stack unset without one', () => {
    const bare = new Error('first');
    bare.stack = undefined;
    const second = new Error('second');
    expect(splitConsoleArgs([bare, second]).stack).toContain('second');
    expect(splitConsoleArgs(['nur Text', 42]).stack).toBeUndefined();
  });

  it('never throws — it shares the tee seat with formatConsoleArgs', () => {
    const cursed = new Error('x');
    Object.defineProperty(cursed, 'stack', {
      get() {
        throw new Error('nope');
      },
    });
    expect(() => splitConsoleArgs([cursed])).not.toThrow();
    expect(splitConsoleArgs([cursed]).msg).toContain('[unformattable]');
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

  it('summarizes a v:2 report exactly like its v:1 predecessor', () => {
    // WP-61 bumped the report to v:2 and added `frames.warm2` beside `warm`. Neither is a
    // summary field — `warm`/`warm2`/`quick` are triage noise (see summarizeBootLog) — so a
    // log holding both generations must render them identically. This is the property the
    // schema bump promises: nothing here branches on `v`, and an old line stays readable.
    const v2 = { ...PLAY, v: 2, frames: { ...PLAY.frames, warm2: 210.4 } };
    expect(body(log(v2))).toEqual(body(log(PLAY)));
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

  it('reads past the runtime lines sharing the file with it (WP-69)', () => {
    // The digest is „Startdiagnose": a crash line has none of the fields a summary line is
    // made of, so an unfiltered run would count it and render it as `? · ?`.
    const mixed =
      rec(PLAY) +
      '\n' +
      JSON.stringify({ v: 1, event: 'app-start', at: META.at, app: META.app, src: 'main' }) +
      '\n' +
      JSON.stringify({
        v: 1,
        event: 'uncaught-exception',
        msg: 'boom',
        at: META.at,
        app: META.app,
        src: 'renderer',
      }) +
      '\n' +
      rec({ outcome: 'skip', why: 'warm' }) +
      '\n';
    const out = summarizeBootLog(mixed);
    expect(out).toContain('2 Einträge');
    expect(out.split('\n')).toHaveLength(3);
    expect(out).not.toContain('app-start');
    expect(out).not.toContain('boom');
    // The discriminator is the key's presence, not its value: a line that says `src: null`
    // came from the runtime writer too.
    expect(summarizeBootLog('{"outcome":"play","src":null}\n')).toContain('keine Einträge');
    // A file that is nothing but runtime lines reads as a log with no boots in it.
    expect(summarizeBootLog(JSON.stringify({ event: 'x', src: 'main' }) + '\n')).toContain(
      'keine Einträge',
    );
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
