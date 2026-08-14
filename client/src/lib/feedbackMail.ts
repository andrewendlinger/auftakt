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
 * The size of an answer, not the size of the budget — those are two different measurements
 * and only one of them can be a character count. Three fields at this length are longer than
 * a `mailto:` can carry as soon as the German is ordinary German: an umlaut costs six encoded
 * characters against one for a letter, so about thirteen of them across three full fields is
 * the difference between fitting and not. No per-field character cap can express that, and
 * one sized for the true worst case — 300 umlauts encode to 1800 on their own — would be
 * around a hundred characters, which is not a report anybody could write.
 *
 * So the cap keeps a field to the shape of an answer, and the *encoded* length is what the
 * dialog actually stops typing on: `feedbackHeadroom` measures it and `fitFeedbackAnswer`
 * enforces it, keystroke by keystroke, where the person can still see what they wrote.
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

/**
 * The name the diagnostics file will have, before main has written it.
 *
 * The dialog needs it one step early: „Was wird mitgeschickt?" has to show the body that
 * will actually go out, and that body names the attachment. Main returns the real name once
 * it has written the file, and that is what is sent — this only has to agree with it, which
 * `diagnostics.test.ts` asserts across both modules.
 */
export function diagnosticsFileName(ref: string): string {
  return `Auftakt-Diagnose-${ref}.txt`;
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
 * The body: the one thing left to do, then what the person wrote, then the machine.
 *
 * A mail client opens on the first line, so that line is the only instruction the reader
 * still has to act on — not the metadata it used to open with, which says nothing to them
 * and is in the subject anyway. Everything below is headed, because three answers and a
 * technical block separated by nothing but blank lines is one paragraph to a reader in a
 * hurry, which is what a support mail is read by.
 *
 * The decoration is `!!` and `---` rather than `===`, `##` or box-drawing characters for a
 * reason that is not taste: `encodeURIComponent` leaves `!` and `-` alone and spends three
 * characters on `=` or `#` and nine on `─`, against the budget below. `---` is also not the
 * `-- ` several clients read as a signature delimiter and fold away.
 */
export function feedbackBody(draft: FeedbackDraft, ctx: FeedbackContext): string {
  const said = FEEDBACK_KINDS[draft.kind].fields
    .map((f) => [f.said, (draft.answers[f.key] ?? '').trim()] as const)
    .filter(([, text]) => text.length > 0)
    .map(([label, text]) => `--- ${label}\n${text}`)
    .join('\n\n');

  // First, in capitals, addressed to the customer rather than the maintainer: it is the one
  // step no program can take for them, and every earlier place it was said is a place it
  // could be scrolled past. Not phrased as something to tidy away afterwards either —
  // every sentence asking the reader to decide something is a sentence that can be decided
  // wrong; „(bitte stehen lassen)" below marks what is not theirs to touch.
  const todo = ctx.attachment
    ? `!! BITTE NOCH ANHÄNGEN: ${ctx.attachment}\n` +
      'Die Datei liegt auf deinem Schreibtisch. Hineinziehen, dann abschicken.\n\n'
    : '';

  const technical = ['--- Technische Angaben (bitte stehen lassen)'];
  // Kind, area and reference travel down here as one line. They read as a filing stamp, not
  // as something to act on, and the subject carries the same three — but a subject is the
  // first thing a forward or a reply rewrites, and the file on the desktop is named after
  // the reference. Labelling only the reference: the other two are self-evident, and the
  // 24 encoded characters the labels would cost are the person's to spend on words.
  const stamp = `${FEEDBACK_KINDS[draft.kind].label}${draft.area ? ` · ${draft.area}` : ''}`;
  technical.push(ctx.ref ? `${stamp} · Kennung: ${ctx.ref}` : stamp);
  // `system` already names the OS, so it stands in for the platform label rather than
  // following it — otherwise every mail says „Windows · Windows 11".
  const machine = ctx.system || platformLabel(ctx.platform);
  if (ctx.version) {
    technical.push(`Auftakt ${ctx.version}${machine ? ` · ${machine}` : ''}`);
  } else if (machine) {
    technical.push(machine);
  }
  // Only when nothing was attached. With the file there it is the same data twice, and the
  // half in the mail is the truncated one — five folded lines against the whole log.
  if (ctx.diagnostics && !ctx.attachment) technical.push(ctx.diagnostics);

  return `${todo}${said}\n\n${technical.join('\n')}\n`;
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
 * The ladder's first two rungs: everything that can be spent before a word the person wrote.
 *
 * With a file attached there is nothing to spend — the body carries no diagnostics when the
 * whole log is travelling as an attachment — so the context comes back untouched and the
 * words are the only thing left, which is what `fitFeedbackAnswer` exists to make impossible.
 *
 * Without one, diagnostic entries go first (oldest first, which is why the summary is written
 * newest-last), then the whole block.
 */
function spend(draft: FeedbackDraft, ctx: FeedbackContext): FeedbackContext {
  const subject = feedbackSubject(draft, ctx);
  const fits = (c: FeedbackContext) =>
    url(subject, feedbackBody(draft, c)).length <= MAILTO_MAX_CHARS;

  if (fits(ctx) || ctx.attachment) return ctx;

  // 1 · drop diagnostic entries from the top, keeping the header and the newest boots.
  // Stops one short of emptying it: a „Startdiagnose —" header with nothing under it reads
  // as a diagnostic that was collected and says nothing, which is worse than step 2. The
  // header survives every rung because it names no count — see `summarizeBootLog`, which
  // stopped promising „die letzten 5" precisely so this loop cannot make it a lie.
  const lines = ctx.diagnostics.split('\n');
  const head = lines[0] ?? '';
  for (let drop = 1; drop <= lines.length - 2; drop++) {
    const trimmed = { ...ctx, diagnostics: [head, ...lines.slice(1 + drop)].join('\n') };
    if (fits(trimmed)) return trimmed;
  }

  // 2 · drop the block. There is nowhere to redirect the reader to — the file that would
  // have carried it is the one that could not be written — so it goes, and the machine
  // line plus the reference are what the report still arrives with.
  return { ...ctx, diagnostics: '' };
}

/**
 * Encoded characters still free for the person's own words. Negative when the mail is over.
 *
 * Measured *after* the diagnostics have been spent, so it answers the only question the
 * dialog has: is there room for one more character of theirs. It is the real unit — a
 * character count cannot be, because the same 300 characters encode to anywhere between 300
 * and 1800 depending on how many of them are umlauts.
 */
export function feedbackHeadroom(draft: FeedbackDraft, ctx: FeedbackContext): number {
  const spent = spend(draft, ctx);
  return MAILTO_MAX_CHARS - url(feedbackSubject(draft, ctx), feedbackBody(draft, spent)).length;
}

/**
 * The longest prefix of `text` that still fits in `key`, given everything else in the draft.
 *
 * This is what the dialog puts in the box on every keystroke, which is the whole point: a cap
 * enforced where the person is looking is a cap they can work with, and one enforced in
 * `feedbackMailBody` on the way out is a truncation they hear about from the maintainer. A
 * blocked keystroke leaves the box exactly as it was; a paste lands cut, in front of them,
 * where it can be edited.
 *
 * Bisected rather than stepped: the cost of a character is not a constant, so the fit has to
 * be measured, and ten measurements per keystroke is nothing next to a re-render.
 */
export function fitFeedbackAnswer(
  draft: FeedbackDraft,
  ctx: FeedbackContext,
  key: string,
  text: string,
): string {
  const at = (n: number) => ({
    ...draft,
    answers: { ...draft.answers, [key]: text.slice(0, n) },
  });
  if (feedbackHeadroom(at(text.length), ctx) >= 0) return text;

  // `lo` is known to fit or is the floor, `hi` is known not to — length is monotonic in the
  // encoded size, so the boundary between them is the answer.
  let lo = 0;
  let hi = text.length;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (feedbackHeadroom(at(mid), ctx) >= 0) lo = mid;
    else hi = mid;
  }
  return text.slice(0, lo);
}

/**
 * The body as it will really be sent — the ladder's output, not its input.
 *
 * Exported because „Was wird mitgeschickt?" shows it: a preview of a body the composer then
 * trims is a preview of something that was never sent, which is worse than no preview at all
 * in a dialog whose promise is that the report is shown in full before it leaves.
 */
export function feedbackMailBody(draft: FeedbackDraft, ctx: FeedbackContext): string {
  const subject = feedbackSubject(draft, ctx);
  const spent = spend(draft, ctx);
  const body = feedbackBody(draft, spent);
  if (url(subject, body).length <= MAILTO_MAX_CHARS) return body;

  // 3 · backstop, so the function is total. The dialog's own fit keeps ordinary typing off
  // this rung entirely; what still reaches it is a mail that grew *after* it was typed — a
  // bundle that failed to write, putting the summary back into a body sized without it — and
  // any draft that did not come through the dialog at all. It marks what it cut.
  const longest = Math.max(FEEDBACK_FIELD_MAX, ...Object.values(draft.answers).map((t) => t.length));
  let budget = longest;
  let clipped = draft;
  while (budget > 40) {
    budget = Math.floor(budget / 2);
    const answers: Record<string, string> = {};
    for (const [key, text] of Object.entries(draft.answers)) answers[key] = clip(text, budget);
    clipped = { ...draft, answers };
    if (url(subject, feedbackBody(clipped, spent)).length <= MAILTO_MAX_CHARS) break;
  }
  return feedbackBody(clipped, spent);
}

/** The finished URL: the subject, and the body the ladder settled on. */
export function feedbackMailto(draft: FeedbackDraft, ctx: FeedbackContext): string {
  return url(feedbackSubject(draft, ctx), feedbackMailBody(draft, ctx));
}
