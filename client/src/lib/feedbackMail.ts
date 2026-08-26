/**
 * What leaves the app when somebody reports something (WP-54, reshaped by WP-66 and WP-75).
 *
 * The artefact is the **file**: `save-diagnostics` writes `Auftakt-Diagnose-<ref>.txt` to the
 * desktop and the customer attaches it to a mail they write themselves. This module composes
 * the two texts around it — what goes into that file's „Meldung" section, and the optional
 * `mailto:` for whoever has a mail client set up. Everything here is pure, so `check:unit` can
 * hold the encoding and the length budget rather than a browser.
 *
 * WP-75 took the questions out. There is no kind, no area and no required answer any more —
 * one optional box, and a report that is written whether or not anything was typed into it —
 * so what a mail carries is short by construction and the ladder that used to spend a mail's
 * budget field by field is two rungs (`mailBody`).
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
 * The optional note's `maxLength`, in typed characters.
 *
 * Sized against the **file**, not against the mail: the note's home is the bundle's „Meldung"
 * section, main caps what it takes there at `BOOT_REPORT_MAX_CHARS` (4096), and a cap the
 * person can feel is one they can write a report inside. The mail is the derived copy and
 * carries as much of it as a `mailto:` can — `mailBody` clips its own copy and marks the cut,
 * where the customer can see it in their compose window before they send.
 *
 * That is the WP-75 reversal of the per-keystroke fit: while a *required* answer had to travel
 * in the mail, the budget had to be enforced in the box the person was typing in, because
 * nothing else carried their words. The file carries them now.
 */
export const FEEDBACK_NOTE_MAX = 2000;

/**
 * The „Meldung" of a report nobody wrote a word into — the default case since WP-75.
 *
 * The section is where the customer's own words go, so an empty one reads as a file that lost
 * them. It says instead that there are none, in the same voice as `CRASH_REPORT_TEXT` (the
 * other auto-generated „Meldung"), and asks for the one sentence that cannot be collected.
 */
export const FEEDBACK_NO_NOTE =
  'Ohne eigenen Text gespeichert: Der Bericht wurde in Auftakt über „Feedback senden“ angelegt.\n' +
  'Was unmittelbar davor getan wurde, weiß nur, wer davorsaß — ein Satz dazu in der E-Mail hilft sehr.';

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
 * What `save-diagnostics` puts in the bundle's „Meldung": the note, or the stand-in above.
 *
 * Nothing else — no reference, no machine line, no attach instruction. The bundle already
 * carries all three around this text, and a file telling its reader to attach that same file
 * is nonsense. It is also the key the dialog remembers a written bundle under, so what it
 * returns has to depend on the note and on nothing else.
 */
export function feedbackReport(note: string): string {
  return note.trim() || FEEDBACK_NO_NOTE;
}

/* ---- the optional mail -------------------------------------------------------------- */

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
  /** `Diagnostics.summary`, or '' when there is no bridge. Only travels without a file. */
  diagnostics: string;
  /** File name of the bundle main wrote; '' when none was (see the dialog). */
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
 * Reference and version — what an inbox shows without opening anything.
 *
 * Kind and area used to lead it too. They were two clicks the customer had to spend before
 * they could say anything (WP-75), and what they filed the report under is answerable from
 * the report itself: the attached bundle names the version, the machine and every boot, and
 * the reference is what a reply is threaded on.
 */
export function feedbackSubject(ctx: FeedbackContext): string {
  return `${ctx.ref ? `[${ctx.ref}] ` : ''}Auftakt-Feedback${ctx.version ? ` (v${ctx.version})` : ''}`;
}

/**
 * The body: the one thing left to do, then what the person wrote, then the machine.
 *
 * A mail client opens on the first line, so that line is the only instruction the reader
 * still has to act on. Everything below is headed, because a note and a technical block
 * separated by nothing but blank lines is one paragraph to a reader in a hurry, which is what
 * a support mail is read by. „Meldung" is the bundle's own heading for the same text, so the
 * file and the mail say the same thing under the same word.
 *
 * The decoration is `!!` and `---` rather than `===`, `##` or box-drawing characters for a
 * reason that is not taste: `encodeURIComponent` leaves `!` and `-` alone and spends three
 * characters on `=` or `#` and nine on `─`, against the budget below. `---` is also not the
 * `-- ` several clients read as a signature delimiter and fold away.
 */
export function feedbackBody(note: string, ctx: FeedbackContext): string {
  const parts: string[] = [];

  // First, in capitals, addressed to the customer rather than the maintainer: it is the one
  // step no program can take for them (RFC 6068 gives a `mailto:` no way to attach), and
  // every earlier place it was said is a place it could be scrolled past.
  if (ctx.attachment) {
    parts.push(
      `!! BITTE NOCH ANHÄNGEN: ${ctx.attachment}\n` +
        'Die Datei liegt auf deinem Schreibtisch. Hineinziehen, dann abschicken.',
    );
  }

  // The person's words ride along even though the file carries them too: this is what the
  // compose window shows, and a customer who has just written a sentence and sees a mail
  // without it in has every reason to think it was lost.
  const said = note.trim();
  if (said) parts.push(`--- Meldung\n${said}`);

  const technical = ['--- Technische Angaben (bitte stehen lassen)'];
  // „(bitte stehen lassen)" marks what is not theirs to tidy — every sentence asking the
  // reader to decide something is a sentence that can be decided wrong.
  if (ctx.ref) technical.push(`Kennung: ${ctx.ref}`);
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
  parts.push(technical.join('\n'));

  return `${parts.join('\n\n')}\n`;
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
 * The body as the URL will really carry it: two rungs, machine before person.
 *
 * The whole ladder used to be four rungs deep, because a required three-field report and a
 * boot digest fought over 1900 encoded characters (`docs/DECISIONS.md`). Since WP-75 the file
 * carries the report and the note is optional, so what is left is the ordering principle: the
 * digest is spendable — it is in the attachment in full, or it is a machine's guess at what
 * matters — and a word the person wrote is spent last and marked.
 */
function mailBody(note: string, ctx: FeedbackContext): string {
  const subject = feedbackSubject(ctx);
  const fits = (body: string) => url(subject, body).length <= MAILTO_MAX_CHARS;

  const full = feedbackBody(note, ctx);
  if (fits(full)) return full;

  // 1 · the digest. With a file attached there is none in the body to begin with, so this
  // rung only ever fires on the branch where no bundle was written.
  const lean = { ...ctx, diagnostics: '' };
  const withoutDigest = feedbackBody(note, lean);
  if (fits(withoutDigest)) return withoutDigest;

  // 2 · the note, halved until it fits and marked `[…]`. The loop halves while the budget is
  // still above 40, so the last cut can land between 21 and 40 characters — even all-umlaut
  // that is at most ~240 encoded against a subject and a technical block of about 300.
  let budget = note.length;
  let body = withoutDigest;
  while (budget > 40) {
    budget = Math.floor(budget / 2);
    body = feedbackBody(clip(note, budget), lean);
    if (fits(body)) break;
  }
  return body;
}

/** The finished URL: the subject, and the body the ladder settled on. */
export function feedbackMailto(note: string, ctx: FeedbackContext): string {
  return url(feedbackSubject(ctx), mailBody(note, ctx));
}
