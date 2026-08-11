import { describe, expect, it } from 'vitest';
import {
  BOOT_LOG_KEEP_LINES,
  BOOT_REPORT_MAX_CHARS,
  bootLogLine,
  trimBootLog,
} from '../../../electron/bootLog';

/**
 * Same arrangement as backupDir.test.ts: the module lives in `electron/`, imports nothing
 * from `electron`, and this suite is the only automated run that reaches it. What is worth
 * pinning is the trust boundary — the report crosses IPC from the renderer, so the line
 * builder is the one place deciding what an untrusted payload may put on disk — and the
 * rotation arithmetic, which silently eats the log's history if it is off by one.
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
