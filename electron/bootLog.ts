import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

/* ---- reading it back out (WP-54) ---------------------------------------------------
 *
 * The log only pays off if somebody can read it. `boot-log.jsonl` is the one artefact
 * that separates the three paths which produce the same „the animation flashed and was
 * gone" report — `deadline`, an `abort:*` from the frame watchdog, and `reduced-motion`
 * — and until WP-54 there was no way to it from inside the app at all. The summary below
 * is what a support mail carries; the raw file stays one button away, so this is triage,
 * not analysis. `warm` and `quick` are deliberately left out for that reason.
 */

/** How many recent settles the summary folds in. Five fit a mail body; the file keeps 100. */
export const BOOT_SUMMARY_LINES = 5;
/** Hard ceiling on the summary whatever the log holds — it travels inside a `mailto:` URL. */
export const BOOT_SUMMARY_MAX_CHARS = 1200;
/**
 * Longest any string lifted out of the log may appear in the summary.
 *
 * `bootLogLine` caps the payload as a whole and never inspects the fields inside it, so
 * `why` is an untrusted renderer string that ends up in a mail body and a URL. A 3000-char
 * `why` would bloat the mailto past what Windows hands to a mail client, and one carrying a
 * real newline — `JSON.parse('"a\\nb"')` yields a literal newline — would forge extra
 * report lines in the support mail. `tidy()` collapses and slices; this is that cap.
 */
const SUMMARY_FIELD_MAX = 40;

/** What `get-diagnostics` hands the renderer. Mirrored in `client/src/lib/external.ts`. */
export interface BootDiagnostics {
  /** German, already sanitized, ready to paste into a mail body. Never empty. */
  summary: string;
  /** false when no log file exists yet — dev never writes one, nor does a first launch. */
  hasLog: boolean;
  /** Absolute path, for display only. The renderer never sends a path back (X-02). */
  file: string;
}

/** A plain object, or null. Arrays out — the same rule `bootLogLine` applies on the way in. */
function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** A finite number, or null. Catches the `null`s the report writes for "not measured". */
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** An untrusted string, flattened to one line and cut to length. See `SUMMARY_FIELD_MAX`. */
function tidy(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const flat = v.replace(/\s+/g, ' ').trim().slice(0, SUMMARY_FIELD_MAX);
  return flat.length > 0 ? flat : null;
}

/** One record → one line. Clauses appear only when the numbers behind them do. */
function summaryLine(r: Record<string, unknown>): string {
  // Pure string surgery rather than `new Date(...)`: a formatter that reads the machine's
  // timezone cannot be asserted on, and the header says UTC so the shortcut stays honest.
  const at = tidy(r.at);
  const parts: string[] = [at ? at.slice(0, 16).replace('T', ' ') : '?'];

  const app = tidy(r.app);
  if (app) parts.push(`v${app}`);

  // The load-bearing pair for WP-61, and the one clause that is never dropped. `why` stays
  // the raw token (`abort:hitch`, `gesture-max`, …) — translating it would cost a mapping
  // to maintain and make the value ungreppable against client/index.html.
  const why = tidy(r.why);
  parts.push(`${tidy(r.outcome) ?? '?'}${why ? `/${why}` : ''}`);

  const timings: string[] = [];
  const ready = num(r.readyMs);
  const start = num(r.startMs);
  const end = num(r.endMs);
  if (ready !== null) timings.push(`bereit ${Math.round(ready)}`);
  if (start !== null) timings.push(`Start ${Math.round(start)}`);
  if (end !== null) timings.push(`Ende ${Math.round(end)}`);
  if (timings.length > 0) parts.push(`${timings.join(' · ')} ms`);

  const f = obj(r.frames);
  const n = f && num(f.n);
  if (f && n !== null) {
    // med/p95/worst are null together — `packed()` returns them only for a non-empty run.
    const med = num(f.med);
    const p95 = num(f.p95);
    const worst = num(f.worst);
    let frames = `${n} Bilder`;
    if (med !== null && p95 !== null && worst !== null) {
      frames += `, Median ${med} / p95 ${p95} / max ${worst} ms`;
    }
    // Absent (not null) when no frame was seen at all, so `num()` covers both shapes.
    const drops = num(f.drops);
    if (drops !== null && drops > 0) frames += `, ${drops} Aussetzer`;
    parts.push(frames);
  }

  // Only when the reveal fade itself misbehaved: 'ok' is the normal case and says nothing.
  const verdict = obj(r.tail) && tidy(obj(r.tail)?.verdict);
  if (verdict && verdict !== 'ok') parts.push(`Nachlauf ${verdict}`);

  return parts.join(' · ');
}

/**
 * Pure: fold a log's last `keep` records into a short German block.
 *
 * Oldest first, newest last — it matches the file and `tail -n5`, and it is the order the
 * mail composer's truncation ladder relies on: it drops from the top, so the boot that
 * prompted the report survives longest.
 *
 * Tolerant by construction. A torn final line, a line that is not JSON, and a line holding
 * an array all fall out at the parse step; `trimBootLog` does not validate JSON, so a
 * rotated file really can carry one.
 */
export function summarizeBootLog(content: string, keep = BOOT_SUMMARY_LINES): string {
  const records: Record<string, unknown>[] = [];
  // `for…of` rather than an index: under `noUncheckedIndexedAccess` (which the client
  // tsconfig sets and this file is type-checked through) `lines[i]` is `string | undefined`.
  for (const line of content.split('\n')) {
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const r = obj(parsed);
    if (r) records.push(r);
  }

  if (records.length === 0) {
    return 'Startdiagnose — keine Einträge (die App hat noch keinen Start protokolliert).';
  }

  // `slice(-0)` is `slice(0)` — the whole array, not none. Guarded here rather than at the
  // call sites, so a caller asking for nothing gets nothing.
  const tail = keep > 0 ? records.slice(-keep) : [];
  const entries = records.length === 1 ? '1 Eintrag' : `${records.length} Einträge`;
  // Newest first, so the ceiling below spends the oldest line rather than the boot that
  // prompted the report — and so it spends whole lines: a `slice()` over the finished text
  // cuts the last one mid-clause, which reads as a corrupted record rather than as a cut.
  const head = `Startdiagnose — ${entries}, hier die neuesten (Zeit in UTC):`;
  const lines: string[] = [];
  let used = head.length;
  for (let i = tail.length - 1; i >= 0; i--) {
    const line = summaryLine(tail[i] ?? {});
    if (used + 1 + line.length > BOOT_SUMMARY_MAX_CHARS) break;
    used += 1 + line.length;
    lines.unshift(line);
  }

  // A single line longer than the whole ceiling would leave a „Startdiagnose —" header with
  // nothing under it, which reads as a diagnostic that was collected and says nothing. Out of
  // reach while every field is capped at 40 characters, and one raised cap from being in it.
  if (lines.length === 0 && tail.length > 0) {
    const newest = summaryLine(tail[tail.length - 1] ?? {});
    lines.push(`${newest.slice(0, Math.max(0, BOOT_SUMMARY_MAX_CHARS - head.length - 5)).trimEnd()} […]`);
  }

  // The count is of the log, not of what is shown, so it stays true however much is dropped
  // here — and „die neuesten" carries no number for the same reason: the mail composer's
  // truncation ladder drops further lines from under this header on its way into a `mailto:`,
  // and a header promising five entries above two is a header that has to be checked by hand.
  const header = lines.length < records.length ? head : `Startdiagnose — ${entries} (Zeit in UTC):`;
  return [header, ...lines].join('\n');
}

/**
 * Read the log and summarize it, plus what the renderer needs to talk about the file.
 *
 * One IO entry point, so `hasLog` cannot drift from `summary`. Swallows everything, same
 * rule as `writeBootReport`: a diagnostic that can break the thing it diagnoses is worse
 * than no diagnostic.
 */
export function bootDiagnostics(dir: string): BootDiagnostics {
  const file = join(dir, BOOT_LOG_NAME);
  let content = '';
  let hasLog = false;
  try {
    hasLog = existsSync(file);
    if (hasLog) content = readFileSync(file, 'utf8');
  } catch {
    /* unreadable userData — report it as "no log", which is what the user can act on */
    hasLog = false;
  }
  return { summary: summarizeBootLog(content), hasLog, file };
}
