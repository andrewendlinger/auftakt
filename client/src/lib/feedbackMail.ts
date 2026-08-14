/**
 * Compose the support mail (WP-54).
 *
 * The app cannot send mail itself — that would need a mail service, credentials and a
 * network, against the whole offline character of the thing — so the report is handed to
 * the customer's own mail client as a `mailto:`, which is also the moment they see and
 * approve what is being sent. Everything here is pure, so `check:unit` can hold the
 * encoding and the length budget rather than a browser.
 */

/** Where feedback goes. One address, hardcoded: there is one maintainer and no intake service. */
export const FEEDBACK_TO = 'auftakt@e-mail.de';

/**
 * How long the finished `mailto:` may get.
 *
 * On Windows the URL goes through ShellExecute, which is not dependable much past 2 KB, and
 * clients truncate silently rather than refuse. What has to be measured is the *encoded*
 * length: `encodeURIComponent` spends 3 characters on every newline and 6 on every umlaut,
 * so a German body is far longer than its character count suggests.
 */
export const MAILTO_MAX_CHARS = 1900;

/**
 * Per free-text field, enforced by the dialog's `maxLength`.
 *
 * Sized so three full fields of ordinary German prose plus a five-line diagnostic block
 * still fit — that is the point of a cap the user can see coming, rather than a truncation
 * they find out about from the maintainer. It is not a worst-case guarantee: 300 characters
 * of nothing but umlauts encode to 1800 on their own, and that case falls to the ladder
 * below, which spends the diagnostics before it spends a word the person wrote.
 */
export const FEEDBACK_FIELD_MAX = 300;

/* ---- what kind of thing is being reported ------------------------------------------
 *
 * A „Feedback" button that only ever asks „Was ist passiert?" gets feature requests phrased
 * as faults, because that is the only sentence on offer. The kind is asked first, and it
 * decides both the questions and whether startup timings travel: they say nothing at all
 * about a wish, and leaving them out gives the person's own words the budget instead.
 */

export type FeedbackKind = 'bug' | 'wish';

export interface FeedbackField {
  key: string;
  /** The dialog's question. */
  ask: string;
  /** The same thing as a heading in the mail — „Was ist passiert?" → „Was passiert ist". */
  said: string;
  placeholder: string;
  /** Exactly one field per kind carries this; it is the one the send button waits for. */
  required?: true;
}

export interface FeedbackKindSpec {
  /** Goes in the subject, so it is what the maintainer sorts an inbox by. */
  label: string;
  /** Whether the boot summary and the desktop diagnostics file belong to this kind. */
  diagnostics: boolean;
  fields: readonly FeedbackField[];
}

/**
 * The one definition of what is asked and how it is headed in the mail.
 *
 * Both spellings used to be written out separately — questions in the dialog, statements in
 * the body — with nothing keeping them in step. The dialog renders from this table and
 * `feedbackBody` composes from it, so a re-worded question cannot leave a stale heading
 * behind in the mail.
 */
export const FEEDBACK_KINDS: Record<FeedbackKind, FeedbackKindSpec> = {
  bug: {
    label: 'Fehler',
    diagnostics: true,
    fields: [
      {
        key: 'happened',
        ask: 'Was ist passiert?',
        said: 'Was passiert ist',
        placeholder: 'z. B. „Beim Start war die Animation nur kurz zu sehen, dann kam die Übersicht.“',
        required: true,
      },
      {
        key: 'did',
        ask: 'Was hast du davor gemacht?',
        said: 'Was ich davor gemacht habe',
        placeholder: 'z. B. „Auftakt neu gestartet.“',
      },
      {
        key: 'expected',
        ask: 'Was hättest du erwartet?',
        said: 'Was ich erwartet hätte',
        placeholder: 'Optional — hilft, wenn es nicht offensichtlich ist.',
      },
    ],
  },
  wish: {
    label: 'Wunsch',
    diagnostics: false,
    fields: [
      {
        key: 'want',
        ask: 'Was möchtest du tun können?',
        said: 'Was ich tun können möchte',
        placeholder: 'z. B. „Die Künstlerliste nach Land sortieren.“',
        required: true,
      },
      {
        key: 'today',
        ask: 'Wie machst du es heute?',
        said: 'Wie ich es heute mache',
        placeholder: 'z. B. „Ich exportiere die Liste und sortiere sie in Excel.“',
      },
      {
        key: 'why',
        ask: 'Warum wäre das besser?',
        said: 'Warum das besser wäre',
        placeholder: 'Optional — was es dir spart.',
      },
    ],
  },
};

/** The one field the dialog insists on before it will send. */
export function requiredField(kind: FeedbackKind): FeedbackField {
  const found = FEEDBACK_KINDS[kind].fields.find((f) => f.required);
  // Every kind above declares one; the fallback keeps the type honest without a `!`.
  return found ?? { key: '', ask: '', said: '', placeholder: '' };
}

/* ---- the report's own name ---------------------------------------------------------- */

/**
 * `AF-YYMMDDHHMM` — what makes two reports from the same screen tellable apart.
 *
 * Every mail out of this dialog used to have the same subject, so an inbox of them could not
 * be sorted, and a reply could not name which one it answered. The stamp is minute
 * resolution in **naive local time**, the convention `shared/time.ts` sets for everything
 * else the app stamps; `now` is passed in rather than read here so the tests can pin it.
 *
 * It also names the diagnostics file, which is what lets a mail and a loose attachment on a
 * desktop find each other. That makes it the one renderer value that reaches a filename, so
 * the main process re-checks the shape on its own terms before using it — `isBundleRef` in
 * `electron/diagnostics.ts`, deliberately not imported from here (X-02).
 */
export function feedbackRef(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `AF-${p(now.getFullYear() % 100)}${p(now.getMonth() + 1)}${p(now.getDate())}${p(now.getHours())}${p(now.getMinutes())}`;
}

/* ---- the draft and its context ------------------------------------------------------ */

/** What the dialog collected. Answers are keyed by `FeedbackField.key`, any of them empty. */
export interface FeedbackDraft {
  kind: FeedbackKind;
  /** „Worum geht's?" — the chosen area, already in German. */
  area: string;
  answers: Record<string, string>;
}

export interface FeedbackContext {
  /** `feedbackRef` at the moment the dialog opened. */
  ref: string;
  /** From `getVersion`; '' while unknown or in the browser. */
  version: string;
  /** `window.auftakt?.platform` — 'darwin' | 'win32' | …; '' in the browser. */
  platform: string;
  /**
   * „Windows 11 (10.0.26100) · 2560×1440 @1.5×" — main's one-line machine clause, which
   * replaces the bare platform label when it is there. '' without a bridge.
   */
  system: string;
  /** `Diagnostics.summary`, or '' when there is no bridge or the kind carries none. */
  diagnostics: string;
  /** File name of the bundle written to the desktop; '' when none was (see the dialog). */
  attachment: string;
}

/** What a person recognises, not what `process.platform` calls it. */
function platformLabel(platform: string): string {
  if (platform === 'darwin') return 'macOS';
  if (platform === 'win32') return 'Windows';
  if (platform === 'linux') return 'Linux';
  return platform;
}

/**
 * Ref, kind, area, version — the four things that decide whether a mail gets opened now or
 * later, all in the line an inbox shows without opening anything.
 */
export function feedbackSubject(draft: FeedbackDraft, ctx: FeedbackContext): string {
  const kind = FEEDBACK_KINDS[draft.kind].label;
  return `${ctx.ref ? `[${ctx.ref}] ` : ''}Auftakt-${kind}: ${draft.area}${
    ctx.version ? ` (v${ctx.version})` : ''
  }`;
}

/**
 * The body, human part first so the mail opens on what the person wrote.
 *
 * The separator is ten plain hyphens rather than `-- `, which several clients read as the
 * signature delimiter and fold away — taking the diagnostics with it — and rather than
 * box-drawing characters, which cost nine characters each once encoded.
 */
export function feedbackBody(draft: FeedbackDraft, ctx: FeedbackContext): string {
  const said = FEEDBACK_KINDS[draft.kind].fields
    .map((f) => [f.said, (draft.answers[f.key] ?? '').trim()] as const)
    .filter(([, text]) => text.length > 0)
    .map(([label, text]) => `${label}:\n${text}`)
    .join('\n\n');

  const technical = ['Technische Angaben (bitte stehen lassen):'];
  // The ref is repeated here because a subject is the first thing a forward or a reply
  // rewrites, and the file on the desktop is named after it.
  if (ctx.ref) technical.push(`Kennung: ${ctx.ref}`);
  // `system` already names the OS, so it stands in for the platform label rather than
  // following it — otherwise every mail says „Windows · Windows 11".
  const machine = ctx.system || platformLabel(ctx.platform);
  if (ctx.version) {
    technical.push(`Auftakt ${ctx.version}${machine ? ` · ${machine}` : ''}`);
  } else if (machine) {
    technical.push(machine);
  }
  // Terse on purpose. It was a sentence explaining what the file holds, and 211 encoded
  // characters is a quarter of what three full fields cost — the file says that on its own
  // first page, and the dialog said it before the file was written.
  if (ctx.attachment) technical.push(`Anhang (vom Schreibtisch): ${ctx.attachment}`);
  // The block brings its own header out of summarizeBootLog, so nothing is repeated here.
  if (ctx.diagnostics) technical.push(ctx.diagnostics);

  const kind = FEEDBACK_KINDS[draft.kind].label;
  return `Art: ${kind} · Bereich: ${draft.area}\n\n${said}\n\n----------\n${technical.join('\n')}\n`;
}

function url(subject: string, body: string): string {
  // encodeURIComponent never emits `+` for a space, so the round trip through a
  // `URLSearchParams` reader is exact — which is what the test asserts on.
  return `mailto:${FEEDBACK_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Cut a raw string and mark the cut. Never applied to an encoded one — that breaks escapes. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()} […]`;
}

/**
 * The finished URL, shrunk until it fits.
 *
 * The ladder has a deliberate order: diagnostic entries go first (oldest first, which is
 * why the summary is written newest-last), then the whole diagnostic block — replaced by a
 * pointer at where the full version is, so this is a redirection rather than a loss — and
 * only then the person's own words. Their text is never the first casualty, and a
 * truncation is never silent.
 *
 * The attachment line is not on the ladder at all. It is one sentence, and it is the one
 * sentence that makes the summary above it redundant: dropping it to save 120 characters
 * would leave the customer holding a file nothing asked them for.
 */
export function feedbackMailto(draft: FeedbackDraft, ctx: FeedbackContext): string {
  const subject = feedbackSubject(draft, ctx);
  const fits = (c: FeedbackContext, d: FeedbackDraft) => url(subject, feedbackBody(d, c)).length;

  if (fits(ctx, draft) <= MAILTO_MAX_CHARS) return url(subject, feedbackBody(draft, ctx));

  // 1 · drop diagnostic entries from the top, keeping the header and the newest boots.
  // Stops one short of emptying it: a „Startdiagnose —" header with nothing under it reads
  // as a diagnostic that was collected and says nothing, which is worse than step 2's
  // honest pointer at the file.
  const lines = ctx.diagnostics.split('\n');
  const head = lines[0] ?? '';
  for (let drop = 1; drop <= lines.length - 2; drop++) {
    const kept = [head, ...lines.slice(1 + drop)].join('\n');
    const trimmed = { ...ctx, diagnostics: kept };
    if (fits(trimmed, draft) <= MAILTO_MAX_CHARS) return url(subject, feedbackBody(draft, trimmed));
  }

  // 2 · drop the block entirely. With an attachment that is simply the end of it: the line
  // above already names the file the log is in, and a sentence under it saying the log is in
  // the file named above is 140 encoded characters of nothing. Without one — browser mode, or
  // a write that failed — the block is replaced by the route to the file, so this stays a
  // redirection rather than a loss.
  const pointer = {
    ...ctx,
    diagnostics: ctx.attachment
      ? ''
      : 'Diagnose zu lang für diese E-Mail — bitte in Auftakt unter „Programm & Hilfe“ auf ' +
        '„Diagnoseordner öffnen“ klicken und boot-log.jsonl anhängen.',
  };
  if (fits(pointer, draft) <= MAILTO_MAX_CHARS) return url(subject, feedbackBody(draft, pointer));

  // 3 · backstop, so the function is total. Unreachable for ordinary text at the field cap
  // the dialog enforces; it exists for the umlaut-heavy worst case and marks what it cut.
  let budget = FEEDBACK_FIELD_MAX;
  let clipped = draft;
  while (budget > 40) {
    budget = Math.floor(budget / 2);
    const answers: Record<string, string> = {};
    for (const [key, text] of Object.entries(draft.answers)) answers[key] = clip(text, budget);
    clipped = { ...draft, answers };
    if (fits(pointer, clipped) <= MAILTO_MAX_CHARS) break;
  }
  return url(subject, feedbackBody(clipped, pointer));
}
