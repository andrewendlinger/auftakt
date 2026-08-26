import {
  appendFileSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { inspect } from 'node:util';

/**
 * The app's landing place for evidence: one JSONL file in userData holding both the boot
 * reports (one line per settle, WP-61) and the runtime errors (WP-69) — a crash, a 500, a
 * failed update, a React render error. Until WP-69 the second kind had nowhere to land at
 * all: the Express server runs in-process in Electron main and a Finder-launched app has no
 * stdio, so every `console.error` in the packaged product went into a console that does not
 * exist. A customer filing „Fehler" sent frame timings and no trace of what broke.
 *
 * **One file, two kinds of line, and `src` is the discriminator.** A boot report keeps the
 * exact top-level shape it has had since WP-61 — `{v, …report, at, app}`, never an `src`
 * key — because `scripts/check-boot.mjs` and the WP-61b/c cross-version analysis read those
 * lines field by field. A runtime line is `{v:1, …entry, at, app, src}` and *always* carries
 * `src`, so everything on the read side separates the two with `'src' in line` and nothing
 * has to guess. Adding a `src` field to a boot report would silently reclassify every line
 * ever written; that is why the boot builder does not take one.
 *
 * Imports nothing from `electron`, deliberately — the same rule as backup.ts, and for the
 * same reason: it is what lets `client/src/lib/appLog.test.ts` exercise the line builders,
 * the rotation and the summary from `check:unit`, which is the only automated run that
 * reaches main-process code at all. The userData path and the app version are passed in.
 *
 * It also never *reads* anything it was not handed — no environment, no user name, no path
 * lookups. The bundle this file feeds promises the customer it carries no personal data
 * (`diagnostics.ts`), and a logger that goes looking for context is how such a promise stops
 * being true.
 */

export const APP_LOG_NAME = 'app-log.jsonl';
/** The pre-WP-69 name. Only `migrateBootLog` still uses it; kept so the rename has a source. */
export const BOOT_LOG_NAME = 'boot-log.jsonl';

/**
 * Rotation trigger, and the pair of bounds the rewrite trims down to.
 *
 * Two bounds rather than one because the file now holds two very different lines. A boot
 * report is a few hundred bytes; a runtime line carries a stack and may be the full 4 KB.
 * A lines-only bound of 500 would therefore permit ~2 MB — far past the trigger — so every
 * single append past the trigger would rewrite the whole file and immediately be past it
 * again. Keeping *both* bounds and holding `APP_LOG_KEEP_BYTES * 2 <= APP_LOG_MAX_BYTES`
 * guarantees the headroom that makes a rotation rare whatever the lines look like.
 */
export const APP_LOG_MAX_BYTES = 512 * 1024;
export const APP_LOG_KEEP_LINES = 500;
export const APP_LOG_KEEP_BYTES = 256 * 1024;

/**
 * The renderer is the untrusted side. A boot report is a dozen numbers and short strings —
 * anything past this is not a report, and must not become a disk-filling channel.
 */
export const BOOT_REPORT_MAX_CHARS = 4096;
/** Same ceiling for a runtime line, whole and serialised: a stack plus a message, no more. */
export const APP_LOG_EVENT_MAX_CHARS = 4096;

/**
 * Per-field ceilings, applied before the whole-line one so an overlong stack costs its own
 * tail rather than the entire event. Flattening is not the point — JSON.stringify escapes
 * newlines, so a line stays a line either way — the disk and the mail budget are.
 */
export const APP_LOG_FIELD_CAPS: Readonly<Record<string, number>> = {
  event: 64,
  msg: 500,
  stack: 3000,
};

/** Where a runtime line came from. Its presence is what makes a line *not* a boot report. */
export type AppLogSource = 'main' | 'server' | 'renderer';

/** The wrapper fields of a runtime line. Stamped by main, never by whoever sent the entry. */
export interface AppLogMeta {
  at: string;
  app: string;
  src: AppLogSource;
}

/* ---- writing ------------------------------------------------------------------------ */

/**
 * Pure: wrap an untrusted renderer payload into one JSONL boot line, or null if it is not a
 * plausible report (not a plain object, unserialisable, or oversized). The wrapper's own
 * fields land last so a payload that carries `at`/`app` keys cannot spoof them.
 * JSON.stringify escapes newlines, so the result is one line by construction.
 *
 * No `src` — that absence is the boot line's identity, see the header.
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

/**
 * Pure: wrap one runtime event into a JSONL line, or null if it cannot become one.
 *
 * Same trust rule as `bootLogLine` and one addition: the fields this codebase names —
 * `event`, `msg`, `stack` — are cut to their caps first, because a runtime entry is
 * assembled from a stack trace or a `console.error`'s arguments, and those have no length
 * anybody controls. Everything else the caller passes rides along untouched under the
 * whole-line cap. The meta spread lands last, so an entry carrying `at`, `app` or `src`
 * loses all three: a renderer must not be able to claim it is main.
 */
export function appLogLine(entry: unknown, meta: AppLogMeta): string | null {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
  let body: string;
  try {
    // Inside the try because reading the properties can itself throw: a hostile or merely
    // exotic object may carry a getter, and `Object.entries` invokes them.
    const capped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entry)) {
      const cap = APP_LOG_FIELD_CAPS[key];
      capped[key] = cap !== undefined && typeof value === 'string' ? value.slice(0, cap) : value;
    }
    body = JSON.stringify({ v: 1, ...capped, at: meta.at, app: meta.app, src: meta.src });
  } catch {
    return null; // cyclic, a throwing getter or toJSON — not an event
  }
  if (body.length > APP_LOG_EVENT_MAX_CHARS) return null;
  return body;
}

/**
 * Pure: the content to rewrite once the file is past `APP_LOG_MAX_BYTES` — the newest lines
 * that fit *both* bounds, whole lines only.
 *
 * A half line is worse than no line: it survives rotation as unparseable text that every
 * reader here then has to step over. One line longer than the byte budget on its own is kept
 * anyway — the alternative is an empty log, and `appLogLine` caps a line at 4 KB regardless.
 */
export function trimAppLog(
  content: string,
  keepLines = APP_LOG_KEEP_LINES,
  keepBytes = APP_LOG_KEEP_BYTES,
): string {
  return lastLines(content, keepLines, keepBytes);
}

/** How many lines the bundle's runtime section shows, and the ceiling in bytes over them. */
export const BUNDLE_TAIL_LINES = 200;
export const BUNDLE_TAIL_BYTES = 64 * 1024;

/**
 * Pure: the tail the diagnostics bundle carries. Same whole-line rule as `trimAppLog`, much
 * smaller budget — this one ends up in a text file a customer reads and mails, not in a ring
 * buffer, so it is sized for a person rather than for the next rotation.
 */
export function tailAppLog(
  content: string,
  maxLines = BUNDLE_TAIL_LINES,
  maxBytes = BUNDLE_TAIL_BYTES,
): string {
  return lastLines(content, maxLines, maxBytes);
}

/**
 * The newest lines fitting both bounds, oldest first, with the trailing newline the file is
 * written with. Bytes and not characters: the trigger reads `statSync().size`, and a German
 * message is two bytes per umlaut there and one character here.
 */
function lastLines(content: string, maxLines: number, maxBytes: number): string {
  const lines = content.split('\n').filter((l) => l.length > 0);
  const kept: string[] = [];
  let bytes = 0;
  for (let i = lines.length - 1; i >= 0 && kept.length < maxLines; i--) {
    const line = lines[i] ?? '';
    const size = Buffer.byteLength(line, 'utf8') + 1; // the '\n' it is stored with
    if (kept.length > 0 && bytes + size > maxBytes) break;
    bytes += size;
    kept.push(line);
  }
  kept.reverse();
  return kept.length > 0 ? kept.join('\n') + '\n' : '';
}

/** How many entries a log holds — non-empty lines, which is what the bundle header counts. */
export function countEntries(content: string): number {
  return content.split('\n').filter((l) => l.length > 0).length;
}

/**
 * Append one line and rotate past the cap. Synchronous on purpose: the line is a few hundred
 * bytes, and the two callers below both write at moments where an async handle is a liability
 * — the boot report lands just before the startup backup's VACUUM INTO, and the runtime writer
 * has to survive an `uncaughtException` handler that exits the process on the next statement.
 *
 * The append/stat/rewrite sequence is not a TOCTOU: the only writer is the single Electron
 * main process and nothing yields between the three calls (docs/DECISIONS.md, the dismissed
 * `js/file-system-race` alerts).
 */
function appendAndRotate(dir: string, line: string): void {
  const file = join(dir, APP_LOG_NAME);
  appendFileSync(file, line + '\n', 'utf8');
  if (statSync(file).size > APP_LOG_MAX_BYTES) {
    writeFileSync(file, trimAppLog(readFileSync(file, 'utf8')), 'utf8');
  }
}

/**
 * Append one settle to the log. Swallows everything — a diagnostic that can break the boot it
 * diagnoses is worse than no diagnostic. An invalid payload still writes a marker line: a
 * renderer sending garbage is itself a finding.
 */
export function writeBootReport(dir: string, report: unknown, appVersion: string): void {
  try {
    const meta = { at: new Date().toISOString(), app: appVersion };
    const line =
      bootLogLine(report, meta) ??
      JSON.stringify({ outcome: 'invalid-report', at: meta.at, app: meta.app });
    appendAndRotate(dir, line);
  } catch {
    /* unwritable userData, torn read — the boot goes on */
  }
}

/**
 * Append one runtime event. Same swallow-everything rule and the same marker principle as
 * `writeBootReport`: something that tried to log and could not be logged is worth a line.
 *
 * The timestamp is taken here rather than passed in, for the reason `at` is spread last —
 * the clock belongs to main, not to whoever produced the entry.
 */
export function writeAppLog(
  dir: string,
  entry: unknown,
  meta: { app: string; src: AppLogSource },
): void {
  try {
    const full: AppLogMeta = { at: new Date().toISOString(), app: meta.app, src: meta.src };
    const line =
      appLogLine(entry, full) ?? JSON.stringify({ v: 1, event: 'invalid-log-event', ...full });
    appendAndRotate(dir, line);
  } catch {
    /* unwritable userData, a full disk — whatever was being reported matters more */
  }
}

/** Ceiling on the whole formatted message. `APP_LOG_FIELD_CAPS.msg` cuts it again if used there. */
export const CONSOLE_ARGS_MAX_CHARS = 2000;

/**
 * Format `console.error`/`console.warn` arguments into one message string for the tee (WP-69b).
 *
 * **This must never throw.** It runs inside a wrapped `console.error`, so an exception here
 * would replace the error being reported with an error about reporting it — and, on the
 * `uncaughtException` path, would take out the handler that writes the crash line. Hence the
 * belt and braces: `inspect` with `getters: false` (a throwing getter prints as `[Getter]`
 * rather than running), per-argument try/catch for a hostile `[util.inspect.custom]`, and an
 * outer one for anything left.
 */
export function formatConsoleArgs(args: unknown[]): string {
  try {
    const parts: string[] = [];
    let len = 0;
    for (const arg of args) {
      const part = formatArg(arg);
      parts.push(part);
      len += part.length + 1;
      if (len > CONSOLE_ARGS_MAX_CHARS) break; // a thousand arguments is not a message
    }
    const out = parts.join(' ');
    return out.length > CONSOLE_ARGS_MAX_CHARS
      ? out.slice(0, CONSOLE_ARGS_MAX_CHARS - 4).trimEnd() + ' […]'
      : out;
  } catch {
    return '[unformattable console arguments]';
  }
}

/**
 * Like `formatConsoleArgs`, but with the first stack-carrying Error lifted into its own field.
 *
 * Inlined into `msg` a stack lives inside the 500-character cap, which keeps three or four
 * frames of it; in the line's `stack` slot it has 3000. The server's error middleware —
 * `console.error('API-Fehler', method, path, err)` — is the line this exists for: the one
 * unhandled-500 record a customer bundle carries. Same never-throw contract as above.
 */
export function splitConsoleArgs(args: unknown[]): { msg: string; stack?: string } {
  try {
    let stack: string | undefined;
    const flat = args.map((arg) => {
      if (!(arg instanceof Error)) return arg;
      try {
        stack ??= typeof arg.stack === 'string' ? arg.stack : undefined;
        return `${arg.name}: ${arg.message}`;
      } catch {
        return '[unformattable]'; // a throwing name/message/stack getter
      }
    });
    return { msg: formatConsoleArgs(flat), stack };
  } catch {
    return { msg: '[unformattable console arguments]' };
  }
}

/** One argument. An Error is worth its stack; everything else gets a shallow inspect. */
function formatArg(arg: unknown): string {
  try {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return arg.stack ?? `${arg.name}: ${arg.message}`;
    return inspect(arg, {
      depth: 2,
      colors: false,
      getters: false,
      breakLength: Infinity,
      maxArrayLength: 20,
      maxStringLength: 500,
    });
  } catch {
    return '[unformattable]';
  }
}

/**
 * One-time rename of the pre-WP-69 `boot-log.jsonl` onto the unified name, so an installation
 * that updates into this version keeps the boot history it already collected — that history is
 * what the cross-version comparison of boot timings is made of.
 *
 * A rename and not a merge: the old file holds boot lines only, which is exactly what the new
 * one starts as. Idempotent by the `existsSync` pair — once the unified file exists (because
 * this ran, or because a fresh install wrote one first) the legacy file is left alone rather
 * than overwriting anything. Swallows everything, like every other IO here.
 */
export function migrateBootLog(dir: string): void {
  try {
    const legacy = join(dir, BOOT_LOG_NAME);
    const unified = join(dir, APP_LOG_NAME);
    if (existsSync(legacy) && !existsSync(unified)) renameSync(legacy, unified);
  } catch {
    /* a locked or unreadable userData — the app logs to the new name and loses the history */
  }
}

/* ---- reading it back out (WP-54) ---------------------------------------------------
 *
 * The log only pays off if somebody can read it. Its boot lines are the one artefact that
 * separate the three paths which produce the same „the animation flashed and was gone"
 * report — `deadline`, an `abort:*` from the frame watchdog, and `reduced-motion` — and
 * until WP-54 there was no way to them from inside the app at all. The summary below is
 * what a support mail carries; the raw file stays one button away, so this is triage, not
 * analysis. `warm` and `quick` are deliberately left out for that reason.
 *
 * Since WP-69 everything here filters to boot lines first. A runtime line has none of the
 * fields a summary line is made of, so an unfiltered summary would read „12 Einträge" over
 * two boots and ten `? · ?` rows — the count is part of the triage, so it has to count the
 * thing it names.
 */

/** How many recent settles the summary folds in. Five fit a mail body; the file keeps 500. */
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

/**
 * Is this parsed line a boot report? The discriminator, in one place.
 *
 * `in` and not `=== undefined`: a line that explicitly carries `"src":null` came from the
 * runtime writer too, and the point is to keep runtime lines out of the boot summary rather
 * than to judge how well-formed they are.
 */
export function isBootLine(line: Record<string, unknown>): boolean {
  return !('src' in line);
}

/** A log's raw lines, sorted into the two kinds. Every non-empty line is in exactly one. */
export interface AppLogSplit {
  /** Boot reports — the lines `isBootLine` accepts, in file order. */
  boot: string[];
  /** Everything else: runtime events, and any line that is not a JSON object at all. */
  runtime: string[];
}

/**
 * Pure: sort a log's lines into boot reports and runtime lines, without changing any of them
 * (WP-69f). The diagnostics bundle prints each kind under its own heading, and the two are
 * budgeted differently — every boot line travels, the runtime side travels as a tail.
 *
 * Raw lines rather than parsed records: the bundle shows the file's own text, and the
 * cross-version boot analysis reads those lines field by field. Parsing here only decides
 * which side a line falls on.
 *
 * A line that is not JSON, or JSON that is not a plain object, counts as a runtime line —
 * nothing is dropped. `trimAppLog` does not validate JSON, so a rotated file really can carry
 * a torn one, and on a report about a crash an unreadable log line is itself the finding.
 */
export function splitAppLog(content: string): AppLogSplit {
  const boot: string[] = [];
  const runtime: string[] = [];
  // `for…of` for the reason `summarizeBootLog` gives: `lines[i]` is `string | undefined`
  // under the client tsconfig this file is also checked through.
  for (const line of content.split('\n')) {
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      runtime.push(line);
      continue;
    }
    const r = obj(parsed);
    (r && isBootLine(r) ? boot : runtime).push(line);
  }
  return { boot, runtime };
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
 * Pure: fold a log's last `keep` **boot** records into a short German block.
 *
 * Oldest first, newest last — it matches the file and `tail -n5`, and it is the order the
 * mail composer's truncation ladder relies on: it drops from the top, so the boot that
 * prompted the report survives longest.
 *
 * Tolerant by construction. A torn final line, a line that is not JSON, and a line holding
 * an array all fall out at the parse step; `trimAppLog` does not validate JSON, so a
 * rotated file really can carry one. Runtime lines fall out one step later, at `isBootLine`.
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
    if (r && isBootLine(r)) records.push(r);
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
 * Read the log and summarize its boot lines, plus what the renderer needs to talk about the
 * file.
 *
 * One IO entry point, so `hasLog` cannot drift from `summary`. Swallows everything, same
 * rule as `writeBootReport`: a diagnostic that can break the thing it diagnoses is worse
 * than no diagnostic.
 */
export function bootDiagnostics(dir: string): BootDiagnostics {
  const file = join(dir, APP_LOG_NAME);
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
