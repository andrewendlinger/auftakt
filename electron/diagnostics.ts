/**
 * The diagnostics bundle — every boot the app logged and the failures it caught while running,
 * in one file a customer can actually hand over (WP-54, split into two sections by WP-69f).
 *
 * A `mailto:` cannot carry an attachment. RFC 6068 limits which headers a client may honour,
 * and `attach=` — a Thunderbird extension — was disabled precisely because a URL that names a
 * local file is an exfiltration primitive; Apple Mail, Outlook and web handlers ignore it, and
 * `shell.openExternal` hands the URL to the OS with nothing in between. Nor does the whole log
 * fit in the body: 100 records is ~35 KB against a budget of 1900 *encoded* characters. The
 * five-line digest the mail carries is the remainder after three German fields, not a choice.
 *
 * So the file is made attachable instead of the mail made bigger. Everything the maintainer
 * would otherwise ask for goes into one `.txt` on the desktop, named after the mail's own
 * reference, and the mail says which file to attach. Plain text and a `.txt` extension on
 * purpose: `app-log.jsonl` does not open on double-click on Windows, and it sits in userData
 * among `Cache/`, `GPUCache/` and `blob_storage/`, which is not a folder to send anybody into.
 *
 * Imports nothing from `electron`, deliberately — the same rule `appLog.ts` follows, and for
 * the same reason: it is what lets `client/src/lib/diagnostics.test.ts` hold this text from
 * `check:unit`. Main collects the facts and passes them in.
 */

import {
  APP_LOG_NAME,
  countEntries,
  splitAppLog,
  tailAppLog,
  type BootDiagnostics,
} from './appLog';

/** What `get-diagnostics` returns: the boot log's digest, plus one line about the machine. */
export interface Diagnostics extends BootDiagnostics {
  /** „Windows 11 Pro (10.0.26100) · 2560×1440 @1.5×" — '' when the facts are unavailable. */
  system: string;
}

/** One screen, as `screen.getAllDisplays()` describes it. */
export interface DisplayFacts {
  width: number;
  height: number;
  /** `scaleFactor` — 1.5 on the customer's Windows machine, 2 on a Retina Mac. */
  scale: number;
  rotation: number;
  colorDepth: number;
  internal: boolean;
}

/** Everything main can say about the machine without asking the user anything. */
export interface SystemFacts {
  app: string;
  packaged: boolean;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
  /** `process.getSystemVersion()` — '15.6' on macOS, '10.0.26100' on Windows. */
  osVersion: string;
  /** `os.version()` — a product name on Windows, the kernel banner on macOS. */
  osName: string;
  /** `os.release()`. */
  osRelease: string;
  cpu: string;
  cores: number;
  memTotal: number;
  memFree: number;
  displays: DisplayFacts[];
  locale: string;
  systemLocale: string;
  timeZone: string;
  /** `app.getGPUFeatureStatus()` — the `gpu_compositing` key is the one WP-61 turns on. */
  gpu: Record<string, string>;
  /** Vendor and device out of `app.getGPUInfo('basic')`, already flattened to a line. */
  gpuDevice: string;
  userData: string;
  dataDir: string;
  /** `os.homedir()`, so `redactHome` has a prefix to strip. Never printed itself. */
  home: string;
}

export const BUNDLE_PREFIX = 'Auftakt-Diagnose-';

/**
 * Whether an IPC argument may become a filename.
 *
 * `save-diagnostics` is the one diagnostics channel that takes an argument at all, against the
 * rule its neighbour follows (`get-diagnostics` takes none, so that no path the renderer names
 * can ever reach the filesystem — X-02). The rule holds here because of the alphabet: `AF-` and
 * ten digits cannot spell a separator, a `..` or a drive letter, so the renderer picks a *name*
 * and main still picks the directory.
 *
 * The renderer builds these in `client/src/lib/feedbackMail.ts` and this is not imported from
 * there on purpose. Main validating with the renderer's own validator is not validation, and
 * the shape is a five-token regex — cheap to state twice, and each side states it for its own
 * reason.
 */
export function isBundleRef(ref: unknown): ref is string {
  return typeof ref === 'string' && /^AF-\d{10}$/.test(ref);
}

/** The bundle's name, and the only place the mail's reference becomes a filename. */
export function diagnosticsFileName(ref: string): string {
  return `${BUNDLE_PREFIX}${ref}.txt`;
}

/**
 * The first name on the desktop that is not taken yet — `…-2.txt`, `…-3.txt` after that.
 *
 * The reference is minute resolution on purpose (`docs/DECISIONS.md`): it is read aloud and
 * typed into replies. What that leaves is two *files* of the same name, and the loser is the
 * first report: it is overwritten by the second, while its mail still asks the customer to
 * attach it. Somebody who sends a report, spots a typo and sends another is not a rare person
 * — they are the one taking this seriously — so the second file gets its own name and main
 * returns it, which is the name the mail then carries.
 *
 * Both mails still say the same reference. That is the point of one: they are two attempts at
 * the same report, and the suffix is only what keeps a desktop from losing one of them.
 *
 * The caller supplies `taken`, so this stays free of `fs` and `check:unit` can reach it.
 */
export function uniqueBundleName(ref: string, taken: (name: string) => boolean): string {
  const first = diagnosticsFileName(ref);
  if (!taken(first)) return first;
  for (let n = 2; n < 100; n++) {
    const name = `${BUNDLE_PREFIX}${ref}-${n}.txt`;
    if (!taken(name)) return name;
  }
  // A hundred reports inside one minute is not a case to design for; overwriting the last of
  // them beats failing to write at all, which would cost the mail its attachment line.
  return `${BUNDLE_PREFIX}${ref}-99.txt`;
}

/**
 * Replace the home directory with `~` wherever it appears.
 *
 * The bundle is going to be mailed. `C:\Users\Marianne Fürst\AppData\Roaming\Auftakt` names
 * the customer in a way `~\AppData\Roaming\Auftakt` does not, and the account name has never
 * once been the thing that explained a fault — the shape of the path is.
 *
 * A literal split rather than a `RegExp`: a Windows home path is nothing but backslashes, and
 * escaping one into a pattern is a way to get this wrong for no gain. Best-effort by
 * construction — a path the OS spelt with different capitalisation survives it — which is why
 * the file is left on the desktop for the person to read before they attach it.
 *
 * **Twice on Windows, once everywhere else.** The log sections below are JSONL, and
 * `JSON.stringify` doubles every backslash — a home path inside a stack trace is spelt
 * `C:\\Users\\Marianne Fürst` in that text, which the literal split walks straight past. Since
 * WP-69 those lines carry stacks and `err.message`s that really do name paths, so the escaped
 * spelling is stripped too. The doubled form cannot occur in a plain path, so trying both
 * costs nothing on a text that has neither.
 */
export function redactHome(text: string, home: string): string {
  if (!home) return text;
  const out = text.split(home).join('~');
  const escaped = home.split('\\').join('\\\\');
  return escaped === home ? out : out.split(escaped).join('~');
}

/** German decimal comma, fixed to one place. Not `Intl`: this has to be the same everywhere. */
function gib(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} GB`;
}

/** „2560×1440 @1.5×" — the two numbers a compositing fault is read from first. */
function displayLabel(d: DisplayFacts): string {
  const scale = String(d.scale).replace('.', ',');
  return `${d.width}×${d.height} @${scale}×`;
}

/**
 * The OS as a person names it.
 *
 * `os.version()` is a product name on Windows („Windows 11 Pro") and the Darwin kernel banner
 * on macOS, so it is usable on one platform and noise on the other. The build below prefers
 * whichever field is the readable one per platform and keeps the numeric version in
 * parentheses, because that is what a support answer has to match against a changelog.
 */
export function osLabel(facts: SystemFacts): string {
  const { platform, osName, osVersion, osRelease } = facts;
  if (platform === 'win32') {
    const name = osName || 'Windows';
    return osVersion ? `${name} (${osVersion})` : name;
  }
  if (platform === 'darwin') return osVersion ? `macOS ${osVersion}` : 'macOS';
  if (platform === 'linux') return osRelease ? `Linux ${osRelease}` : 'Linux';
  return [platform, osRelease].filter(Boolean).join(' ');
}

/**
 * The one line the mail body can afford: which OS, and how the primary screen is scaled.
 *
 * Those two decide the first guess at a rendering fault, and they cost about 40 characters
 * against a budget the truncation ladder is already spending carefully. Everything else —
 * the GPU flags, the other screens, the memory — waits in the bundle.
 */
export function systemLine(facts: SystemFacts): string {
  const first = facts.displays[0];
  return [osLabel(facts), first ? displayLabel(first) : ''].filter(Boolean).join(' · ');
}

/** Label column wide enough for the longest key below, so the block reads as a table. */
function row(label: string, value: string): string {
  return `${label.padEnd(12)}${value}`;
}

/** Continuation lines under a `row`, aligned with its value column. */
function contRows(values: string[]): string[] {
  return values.map((v) => `${''.padEnd(12)}${v}`);
}

/** The German block describing the machine. Every line is optional but the first. */
export function formatSystemInfo(facts: SystemFacts): string {
  const lines: string[] = [];
  lines.push(row('Auftakt', `${facts.app}${facts.packaged ? '' : ' (Entwicklungsmodus)'}`));
  lines.push(
    row('Laufzeit', `Electron ${facts.electron} · Chrome ${facts.chrome} · Node ${facts.node}`),
  );
  lines.push(row('System', `${osLabel(facts)} · ${facts.platform} ${facts.arch}`));
  if (facts.cpu) lines.push(row('Prozessor', `${facts.cpu} · ${facts.cores} Kerne`));
  if (facts.memTotal > 0) {
    lines.push(row('Speicher', `${gib(facts.memTotal)} gesamt · ${gib(facts.memFree)} frei`));
  }

  if (facts.displays.length > 0) {
    const [first, ...rest] = facts.displays;
    const describe = (d: DisplayFacts) =>
      [
        displayLabel(d),
        `${d.colorDepth} Bit`,
        d.internal ? 'intern' : 'extern',
        d.rotation ? `${d.rotation}° gedreht` : '',
      ]
        .filter(Boolean)
        .join(' · ');
    if (first) lines.push(row('Bildschirme', describe(first)));
    lines.push(...contRows(rest.map(describe)));
  }

  lines.push(
    row(
      'Sprache',
      `${facts.locale} · System ${facts.systemLocale} · Zeitzone ${facts.timeZone}`,
    ),
  );

  // The GPU flags are the reason this section exists at all: a boot gesture that flashes and
  // vanishes on one machine and not another is usually `gpu_compositing: disabled_software`
  // or a driver on the blocklist, and neither is guessable from the timings.
  const gpuKeys = Object.keys(facts.gpu).sort();
  if (facts.gpuDevice || gpuKeys.length > 0) {
    lines.push(row('Grafik', facts.gpuDevice || '(unbekannt)'));
    lines.push(...contRows(gpuKeys.map((k) => `${k}: ${facts.gpu[k]}`)));
  }

  const folders = [facts.userData, facts.dataDir].filter(
    (p, i, all) => p && all.indexOf(p) === i,
  ) as string[];
  if (folders.length > 0) {
    const [first, ...rest] = folders;
    if (first) lines.push(row('Ordner', first));
    lines.push(...contRows(rest));
  }

  return lines.join('\n');
}

function section(title: string): string {
  return `\n========== ${title} ==========\n`;
}

export interface BundleInput {
  ref: string;
  /** `localStamp()` — passed in, so this module stays pure and the tests can pin it. */
  at: string;
  /** The mail body, verbatim: the file and the mail then say the same thing. */
  report: string;
  facts: SystemFacts;
  /**
   * `app-log.jsonl` in full — every line, unparsed. The split into the two sections happens
   * here rather than at the call site: a count that is not derived from the lines actually
   * printed under it is a count that goes wrong the first time either budget changes.
   */
  log: string;
}

/** „1 Eintrag" / „7 Einträge" — the noun rides along, the two sections counting different things. */
function counted(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * Header, the report, the machine, then the log — as two sections, because it holds two
 * different things (WP-69f).
 *
 * The order is for the person carrying the file, not the person reading it: they opened it to
 * check what they are about to send, so what they wrote themselves comes first and the
 * machine-generated bulk comes last. The note at the top is the same promise the dialog makes
 * — no festival data leaves in here — stated where it can still be checked against the
 * contents below it.
 *
 * **Boot lines are complete, runtime lines are a tail.** The boot reports are the raw material
 * of the cross-version timing comparison and a missing one cannot be asked for again, so every
 * single one travels; rotation already bounds how many there can be. Runtime lines have no such
 * ceiling — one misbehaving interval can write hundreds — and the newest of them are the ones
 * next to whatever the person is reporting, so that side is cut from the top and says so in its
 * own heading. Last in the file for the same reason: on a crash bundle it is what the reader
 * scrolls to the end for.
 */
export function buildDiagnosticsBundle(input: BundleInput): string {
  const { ref, at, report, facts, log } = input;
  const { boot, runtime } = splitAppLog(log);
  // Through `tailAppLog` rather than a slice: it is the budget in bytes as well as lines, and
  // whole lines only, which is what keeps the section parseable for whoever reads it back.
  const tail = tailAppLog(runtime.join('\n'));
  const shown = countEntries(tail);
  const bootCount = counted(boot.length, 'Starteintrag', 'Starteinträge');
  const runtimeCount =
    shown < runtime.length
      ? `letzte ${shown} von ${runtime.length} Einträgen`
      : counted(runtime.length, 'Eintrag', 'Einträge');
  const parts = [
    'Auftakt-Diagnosebericht',
    `Kennung:  ${ref}`,
    `Erstellt: ${at}`,
    '',
    'Diese Datei gehört zur E-Mail mit derselben Kennung. Sie enthält keine Termine, Künstler,',
    'Kontakte oder Notizen — nur Angaben zum Programm und zum Rechner, das Protokoll der letzten',
    'Programmstarts und die Fehler, die dem Programm zuletzt aufgefallen sind. Du kannst sie in',
    'Ruhe durchlesen, bevor du sie anhängst.',
    section('Meldung'),
    report.trim(),
    section('Rechner'),
    formatSystemInfo(facts),
    section(`Startprotokoll (${APP_LOG_NAME}, ${bootCount})`),
    // Dev writes no log at all, and neither has an install that has not settled a boot yet.
    // Saying so beats an empty section that reads like a truncated file.
    boot.join('\n') ||
      '(kein Startprotokoll vorhanden — die App hat auf diesem Rechner noch keinen Start ' +
        'protokolliert)',
    section(`Laufzeitprotokoll (${APP_LOG_NAME}, ${runtimeCount})`),
    // The good case, and the one an installation is in for weeks at a time: nothing went wrong.
    // Worth a sentence, because an empty section here reads as a log that was lost.
    tail.trim() ||
      '(kein Laufzeitprotokoll vorhanden — die App hat auf diesem Rechner noch keinen Fehler ' +
        'protokolliert)',
    '',
  ];
  // Over the finished text, not over the paths alone: the report the person wrote can name a
  // folder too, and a season file they mention by full path carries the account name just the
  // same as `userData` does.
  return redactHome(parts.join('\n'), facts.home);
}
