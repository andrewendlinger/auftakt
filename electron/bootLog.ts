import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The boot report's landing place: one JSONL line per settle in userData, so a boot that
 * stuttered on somebody's machine leaves evidence that survives the overlay node, the
 * renderer and the process. The renderer sends the report over the bootSettled bridge
 * (see client/index.html and preload.ts); this module decides what of it touches disk.
 *
 * Imports nothing from `electron`, deliberately — the same rule as backup.ts, and for the
 * same reason: it is what lets `client/src/lib/bootLog.test.ts` exercise the line builder
 * and the rotation from `check:unit`, which is the only automated run that reaches
 * main-process code at all. The userData path and the app version are passed in.
 */

export const BOOT_LOG_NAME = 'boot-log.jsonl';
/** Rotation trigger. ~200+ lines of headroom against the 100 kept below. */
export const BOOT_LOG_MAX_BYTES = 64 * 1024;
export const BOOT_LOG_KEEP_LINES = 100;
/**
 * The renderer is the untrusted side. A report is a dozen numbers and short strings —
 * anything past this is not a report, and must not become a disk-filling channel.
 */
export const BOOT_REPORT_MAX_CHARS = 4096;

/**
 * Pure: wrap an untrusted renderer payload into one JSONL line, or null if it is not a
 * plausible report (not a plain object, unserialisable, or oversized). The wrapper's own
 * fields land last so a payload that carries `at`/`app` keys cannot spoof them.
 * JSON.stringify escapes newlines, so the result is one line by construction.
 */
export function bootLogLine(report: unknown, meta: { at: string; app: string }): string | null {
  if (typeof report !== 'object' || report === null || Array.isArray(report)) return null;
  let body: string;
  try {
    body = JSON.stringify({ ...report, at: meta.at, app: meta.app });
  } catch {
    return null; // cyclic, or a throwing toJSON — not a report
  }
  if (body.length > BOOT_REPORT_MAX_CHARS) return null;
  return body;
}

/** Pure: the content to rewrite once the file is past the cap — the last `keep` lines. */
export function trimBootLog(content: string, keep = BOOT_LOG_KEEP_LINES): string {
  const lines = content.split('\n').filter((l) => l.length > 0);
  return lines.slice(-keep).join('\n') + '\n';
}

/**
 * Append one settle to the log, rotating past the cap. Synchronous on purpose: the line
 * is a few hundred bytes and the very next thing on this event loop is the startup
 * backup's VACUUM INTO, so async buys nothing here. Swallows everything — a diagnostic
 * that can break the boot it diagnoses is worse than no diagnostic. An invalid payload
 * still writes a marker line: a renderer sending garbage is itself a finding.
 */
export function writeBootReport(dir: string, report: unknown, appVersion: string): void {
  try {
    const meta = { at: new Date().toISOString(), app: appVersion };
    const line =
      bootLogLine(report, meta) ??
      JSON.stringify({ outcome: 'invalid-report', at: meta.at, app: meta.app });
    const file = join(dir, BOOT_LOG_NAME);
    appendFileSync(file, line + '\n', 'utf8');
    if (statSync(file).size > BOOT_LOG_MAX_BYTES) {
      writeFileSync(file, trimBootLog(readFileSync(file, 'utf8')), 'utf8');
    }
  } catch {
    /* unwritable userData, torn read — the boot goes on */
  }
}
