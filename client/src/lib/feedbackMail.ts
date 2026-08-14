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

/** What the dialog collected. Every field may be empty except `area`. */
export interface FeedbackDraft {
  /** „Worum geht's?" — the chosen area, already in German. */
  area: string;
  /** „Was hast du gemacht?" */
  did: string;
  /** „Was ist passiert?" */
  happened: string;
  /** „Was hättest du erwartet?" */
  expected: string;
}

export interface FeedbackContext {
  /** From `getVersion`; '' while unknown or in the browser. */
  version: string;
  /** `window.auftakt?.platform` — 'darwin' | 'win32' | …; '' in the browser. */
  platform: string;
  /** `BootDiagnostics.summary`, or '' when there is no bridge. */
  diagnostics: string;
}

/** What a person recognises, not what `process.platform` calls it. */
function platformLabel(platform: string): string {
  if (platform === 'darwin') return 'macOS';
  if (platform === 'win32') return 'Windows';
  if (platform === 'linux') return 'Linux';
  return platform;
}

/** Version in the subject is what makes an inbox of these triageable at a glance. */
export function feedbackSubject(draft: FeedbackDraft, ctx: FeedbackContext): string {
  return `Auftakt-Feedback: ${draft.area}${ctx.version ? ` (v${ctx.version})` : ''}`;
}

/**
 * The body, human part first so the mail opens on what the person wrote.
 *
 * The separator is ten plain hyphens rather than `-- `, which several clients read as the
 * signature delimiter and fold away — taking the diagnostics with it — and rather than
 * box-drawing characters, which cost nine characters each once encoded.
 */
export function feedbackBody(draft: FeedbackDraft, ctx: FeedbackContext): string {
  const said = [
    ['Was ich gemacht habe', draft.did],
    ['Was passiert ist', draft.happened],
    ['Was ich erwartet hätte', draft.expected],
  ]
    .filter(([, text]) => (text ?? '').trim().length > 0)
    .map(([label, text]) => `${label}:\n${(text ?? '').trim()}`)
    .join('\n\n');

  const technical = ['Technische Angaben (bitte stehen lassen):'];
  if (ctx.version) {
    technical.push(`Auftakt ${ctx.version}${ctx.platform ? ` · ${platformLabel(ctx.platform)}` : ''}`);
  } else if (ctx.platform) {
    technical.push(platformLabel(ctx.platform));
  }
  // The block brings its own header out of summarizeBootLog, so nothing is repeated here.
  if (ctx.diagnostics) technical.push(ctx.diagnostics);

  return `Bereich: ${draft.area}\n\n${said}\n\n----------\n${technical.join('\n')}\n`;
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
 * pointer at the button that reveals the file, so this is a redirection rather than a loss
 * — and only then the person's own words. Their text is never the first casualty, and a
 * truncation is never silent.
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

  // 2 · drop the block entirely and point at the button that hands over the real file.
  const pointer = {
    ...ctx,
    diagnostics:
      'Diagnose zu lang für diese E-Mail — bitte in Auftakt unter „Programm & Hilfe“ auf ' +
      '„Diagnoseordner öffnen“ klicken und boot-log.jsonl anhängen.',
  };
  if (fits(pointer, draft) <= MAILTO_MAX_CHARS) return url(subject, feedbackBody(draft, pointer));

  // 3 · backstop, so the function is total. Unreachable for ordinary text at the field cap
  // the dialog enforces; it exists for the umlaut-heavy worst case and marks what it cut.
  let budget = FEEDBACK_FIELD_MAX;
  let clipped = draft;
  while (budget > 40) {
    budget = Math.floor(budget / 2);
    clipped = {
      area: draft.area,
      did: clip(draft.did, budget),
      happened: clip(draft.happened, budget),
      expected: clip(draft.expected, budget),
    };
    if (fits(pointer, clipped) <= MAILTO_MAX_CHARS) break;
  }
  return url(subject, feedbackBody(clipped, pointer));
}
