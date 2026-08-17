import { useEffect, useRef, useState } from 'react';
import { Btn, ExternalLink, PickerRow } from './ui';
import { FooterHint, Label, Modal, TextArea } from './fields';
import { useToast } from './Toast';
import { useSeasonTerm } from '../hooks';
import { type Diagnostics } from '../lib/external';
import {
  FEEDBACK_FIELD_MAX,
  FEEDBACK_KINDS,
  FEEDBACK_TO,
  diagnosticsFileName,
  feedbackBody,
  feedbackMailBody,
  feedbackMailto,
  feedbackRef,
  feedbackSubject,
  fitFeedbackAnswer,
  requiredField,
  type FeedbackContext,
  type FeedbackDraft,
  type FeedbackKind,
} from '../lib/feedbackMail';
import { useRovingFocus, rovingItem } from '../lib/rovingFocus';

/**
 * The guided support mail (WP-54, reshaped by WP-66).
 *
 * A „Feedback" button that opens a blank mail gets „es geht nicht" back, which costs a round
 * of questions before anything can be looked at — and the one answer that would settle the
 * boot-gesture report (WP-61) is in a file the customer has no way to reach. So the dialog
 * asks the questions a usable report answers, and hands over the diagnostics: the log in full
 * as a file on the desktop, because a `mailto:` cannot carry an attachment (see
 * `electron/diagnostics.ts`).
 *
 * What it asks depends on the first answer. A wish and a fault are not the same question, and
 * asking „Was ist passiert?" about a wish is how feature requests arrive phrased as bugs.
 *
 * **Nothing on this path opens anything (WP-66).** It used to: one click wrote the file, opened
 * a Finder window on it and launched a mail client, and the customer met two new windows before
 * having read a word. Webmail in a browser is the normal case for the people this is for, and
 * on such a machine the mail client either does not exist or is not the one they use. So the
 * second step *hands over* instead — address, subject and text to copy, and the file already
 * lying on the desktop — and the `mailto:` survives as one optional link for whoever does have
 * a client set up. `docs/DECISIONS.md` carries the reversal.
 *
 * Everything shaped like logic is somewhere else and unit-tested: `feedbackMailto` builds the
 * URL, `FEEDBACK_KINDS` holds the questions, `summarizeBootLog` builds the diagnostic block.
 * What is left here is the form.
 */
export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const term = useSeasonTerm();
  const toast = useToast();
  const [kind, setKind] = useState<FeedbackKind | null>(null);
  const [area, setArea] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [version, setVersion] = useState('');
  // Set by the last keystroke that did not fit, cleared by the next one that did — see
  // `onAnswer`. A box that stops taking text without saying why reads as a broken keyboard.
  const [full, setFull] = useState(false);
  // The form, then the handover. „Weiter" writes the diagnostics file and *then* shows what the
  // mail needs; from there on every step is the customer's own click.
  const [step, setStep] = useState<'form' | 'send'>('form');
  // What main really wrote, and the only thing the handover is ever composed from: `null` means
  // there is no file (a Wunsch, the browser build, a failed write). Never a prediction — the
  // handover does not open until this is settled, because everything in it names the file.
  const [sent, setSent] = useState<FeedbackContext | null>(null);
  // „Weiter" pressed, main not back yet. It disables the button rather than opening a handover
  // that would have to guess the name.
  const [saving, setSaving] = useState(false);
  // Report text → the name main gave the bundle holding it. Keyed by the text and not by „has
  // anything been written at all": „Zurück", a corrected answer and „Weiter" again has to write
  // a *second* bundle, because attaching the first version of what they wrote is worse than a
  // stray text file — while going back to a text that is already on the desktop has to name
  // that file rather than write a third.
  const written = useRef(new Map<string, string>());
  // Which row was just copied, so the button can say so where the eye already is. Cleared on a
  // timer below; a failed copy says so in a toast instead, because there is nothing to confirm.
  const [copied, setCopied] = useState<string | null>(null);
  // Set by a failed „Text kopieren" only: the row shows a description, so „bitte von Hand
  // markieren" has nothing to point at until the body is actually on screen.
  const [showText, setShowText] = useState(false);
  // Stamped once, when the dialog opened: it names both the mail and the file written next to
  // it, so it has to be the same value in the preview below and in what actually goes out.
  const [ref] = useState(() => feedbackRef(new Date()));

  // Same shape as UpdateCard's mount effect: optional-chained twice over, because there is no
  // bridge in browser dev and an older packaged preload would not carry these members.
  useEffect(() => {
    void window.auftakt
      ?.getVersion?.()
      .then(setVersion)
      .catch(() => {});
    void window.auftakt
      ?.getDiagnostics?.()
      .then(setDiag)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (copied === null) return;
    const t = window.setTimeout(() => setCopied(null), 2500);
    return () => window.clearTimeout(t);
  }, [copied]);

  // „Worum geht's?" is a *where*, not a severity: it is the one thing the maintainer cannot
  // work out from the text, and it decides which screen to open first.
  //
  // Deduplicated because one of the five is free text: „Bezeichnung" set to „Termine" would
  // otherwise put two identical rows in the list, both selected by either click — the label
  // is also the value that travels in the mail, so the second row could not say anything the
  // first does not. An empty or blank season term drops out for the same reason.
  const areas = ['Allgemein', term.singular, 'Künstler', 'Projekt', 'Termine']
    .map((a) => a.trim())
    .filter((a, i, all) => a.length > 0 && all.indexOf(a) === i);

  const kindRoving = useRovingFocus();
  const areaRoving = useRovingFocus();
  const kinds = Object.keys(FEEDBACK_KINDS) as FeedbackKind[];

  const spec = kind ? FEEDBACK_KINDS[kind] : null;
  const draft: FeedbackDraft = { kind: kind ?? 'bug', area: area ?? '', answers };
  // Named before it exists, so „Was wird mitgeschickt?" shows the body that will really go
  // out. Main returns the name it actually wrote and that is what the handover shows; this is
  // the prediction the preview is drawn from, and the two are pinned to agree in the tests.
  const willAttach =
    spec?.diagnostics === true && typeof window.auftakt?.saveDiagnostics === 'function'
      ? diagnosticsFileName(ref)
      : '';
  const ctx: FeedbackContext = {
    ref,
    version,
    platform: window.auftakt?.platform ?? '',
    system: diag?.system ?? '',
    // A wish carries none: startup timings say nothing about it, and the budget they would
    // spend is better spent on what the person wrote. Nor does a report whose log is
    // travelling in full as a file — `feedbackBody` drops it rather than send it twice.
    diagnostics: spec?.diagnostics ? (diag?.summary ?? '') : '',
    attachment: willAttach,
  };
  // What the handover shows and copies. `sent` is set before the step changes, so inside the
  // handover this is always main's answer; `ctx` covers the form, where nothing has been
  // written yet and `attachment` is only the prediction „Was wird mitgeschickt?" previews.
  const out = sent ?? ctx;
  const required = kind ? requiredField(kind) : null;
  const ready =
    kind !== null && area !== null && (answers[required?.key ?? '']?.trim().length ?? 0) > 0;

  // Every keystroke goes through the mail's own length budget, because that budget is in
  // *encoded* characters and no `maxLength` can be: the same 300 characters cost 300 or 1800
  // depending on how much German is in them. What the box holds is therefore always what the
  // mail carries, and the composer's last rung — clipping their words — stays unreached.
  const onAnswer = (key: string, text: string) => {
    const fitted = fitFeedbackAnswer(draft, ctx, key, text);
    setFull(fitted !== text);
    setAnswers((prev) => ({ ...prev, [key]: fitted }));
  };

  /**
   * „Weiter": put the file on the desktop, *then* show the handover.
   *
   * In that order, and the step waits for main's answer. Everything in the handover names the
   * file — the attach line, the body the „Text kopieren" button hands over, the `mailto:` behind
   * the optional link, the toast — and the name is only predictable for the *first* bundle: a
   * second one comes back as `…-2.txt` (`uniqueBundleName`), so a handover opened before main
   * answered would tell a customer who has just corrected an answer to attach the file holding
   * the draft they replaced.
   *
   * The write happens here rather than behind a button in the handover because the file has to
   * already be there when the customer switches to their mail — they attach it before they come
   * back, and a step telling them to attach a file that main has not written yet is the one
   * instruction the dialog must not give. Nothing is revealed and nothing is opened; the only
   * trace is a named text file where they can see it.
   */
  const toHandover = () => {
    // A Wunsch carries no file, and must not inherit the one a Fehler wrote in this same
    // dialog: `sent` outlives a „Zurück", so leaving it standing would put a bug bundle's
    // attach line into a wish's mail and name it in the toast.
    if (!willAttach) {
      setSent(null);
      setStep('send');
      return;
    }
    // The copy that goes *into* the file carries neither the attach instruction nor the
    // summary: a file telling its reader to attach that same file is nonsense, and the log it
    // would summarize is printed in full two sections further down.
    const forFile = feedbackBody(draft, { ...ctx, attachment: '', diagnostics: '' });
    const already = written.current.get(forFile);
    if (already !== undefined) {
      setSent({ ...ctx, attachment: already });
      setStep('send');
      return;
    }
    setSaving(true);
    // Main answers `{ ok: false }` rather than throwing, but a channel that is not there at all
    // rejects — and an unhandled rejection here would leave „Weiter" disabled with no handover
    // ever shown. A failed write is a mail without an attachment, never a dead button.
    void window.auftakt
      ?.saveDiagnostics?.(ref, forFile)
      .catch(() => null)
      .then((saved) => {
        if (saved?.ok) written.current.set(forFile, saved.name);
        setSent(saved?.ok ? { ...ctx, attachment: saved.name } : { ...ctx, attachment: '' });
        setSaving(false);
        setStep('send');
      });
  };

  // The mail, field by field, in the order the compose window asks for them. „Text" shows a
  // description rather than the body itself: it is up to twelve lines, it is already on screen
  // in full under „Was wird mitgeschickt?" one dialog back, and what matters here is that the
  // button puts it on the clipboard.
  const fields = [
    {
      key: 'to',
      label: 'An',
      shown: FEEDBACK_TO,
      copies: FEEDBACK_TO,
      action: 'Adresse kopieren',
      failed: 'Kopieren hat nicht geklappt — die Adresse steht im Dialog und lässt sich von Hand markieren.',
    },
    {
      key: 'subject',
      label: 'Betreff',
      shown: feedbackSubject(draft, out),
      copies: feedbackSubject(draft, out),
      action: 'Betreff kopieren',
      failed: 'Kopieren hat nicht geklappt — der Betreff steht im Dialog und lässt sich von Hand markieren.',
    },
    {
      key: 'body',
      label: 'Text',
      shown: 'was du geschrieben hast, mit den technischen Angaben',
      copies: feedbackMailBody(draft, out),
      action: 'Text kopieren',
      failed: 'Kopieren hat nicht geklappt — der Text steht jetzt im Dialog und lässt sich von Hand markieren.',
    },
  ];

  const copy = async (field: (typeof fields)[number]) => {
    try {
      await navigator.clipboard.writeText(field.copies);
      setCopied(field.key);
    } catch {
      setCopied(null);
      // The other two rows show their value; this one shows a description, so „von Hand
      // markieren" is an instruction with nothing to follow it until the body is on screen.
      if (field.key === 'body') setShowText(true);
      toast.show({ message: field.failed });
    }
  };

  // The dialog closes on the customer's own „Fertig", so nothing here can claim the mail was
  // sent. What outlives the dialog is the file, so that is what the reminder is about.
  const finish = () => {
    if (out.attachment) {
      toast.show({
        message: `Die Datei ${out.attachment} liegt auf deinem Schreibtisch — bitte an die E-Mail anhängen und abschicken.`,
      });
    }
    onClose();
  };

  const hint = () => {
    if (kind === null) return 'Bitte zuerst Fehler oder Wunsch wählen.';
    if (area === null) return 'Bitte einen Bereich wählen.';
    return `Bitte „${required?.ask}“ ausfüllen.`;
  };

  return (
    <Modal
      title="Feedback & Diagnose"
      onClose={onClose}
      // Only typed text is worth a question — a picked kind or area is one click to redo.
      dirty={Object.values(answers).some((v) => v.trim() !== '')}
      size="lg"
      footer={
        <>
          {!ready && <FooterHint>{hint()}</FooterHint>}
          <Btn onClick={onClose}>Abbrechen</Btn>
          {/* Disabled while main is writing, which is the whole of the wait: the handover is
              composed from the name main returns, so it opens once and opens correct. */}
          <Btn variant="primary" onClick={toHandover} disabled={!ready || saving}>
            Weiter
          </Btn>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label>Was möchtest du melden?</Label>
          {/* First, because it decides the questions below it — and because a wish filed on a
              form that only asks „Was ist passiert?" comes out looking like a fault. */}
          <div ref={kindRoving.ref} onKeyDown={kindRoving.onKeyDown} className="flex gap-2">
            {kinds.map((k) => (
              <PickerRow
                key={k}
                {...rovingItem(k === (kind ?? kinds[0]))}
                selected={kind === k}
                onClick={() => setKind(k)}
              >
                {FEEDBACK_KINDS[k].label}
                <span className="ml-2 text-xs text-neutral-400">
                  {k === 'bug' ? 'etwas geht nicht' : 'etwas fehlt'}
                </span>
              </PickerRow>
            ))}
          </div>
        </div>

        {kind !== null && spec && (
          <>
            <div>
              <Label>Worum geht’s?</Label>
              {/* One tab stop for the whole group, arrows inside it: five rows between the
                  dialog's first stop and the text fields is four Tabs of nothing. */}
              <div ref={areaRoving.ref} onKeyDown={areaRoving.onKeyDown} className="space-y-1.5">
                {areas.map((a) => (
                  <PickerRow
                    key={a}
                    {...rovingItem(a === (area ?? areas[0]))}
                    selected={area === a}
                    onClick={() => setArea(a)}
                  >
                    {a}
                  </PickerRow>
                ))}
              </div>
            </div>

            {/* The fields appear once an area is picked, so the dialog opens on one question
                rather than on a form. Mounting them here is also what lets autoFocus land. */}
            {area !== null && (
              <>
                {spec.fields.map((f, i) => (
                  <div key={f.key}>
                    <Label>{f.ask}</Label>
                    <TextArea
                      autoFocus={i === 0}
                      rows={3}
                      maxLength={FEEDBACK_FIELD_MAX}
                      className="resize-y"
                      placeholder={f.placeholder}
                      value={answers[f.key] ?? ''}
                      onChange={(e) => onAnswer(f.key, e.target.value)}
                    />
                  </div>
                ))}

                {/* Only after a keystroke was actually turned away, and gone again as soon as
                    one is not: „noch 120 Zeichen" on a budget that counts umlauts as six would
                    be a number nobody can type against. */}
                {full && (
                  <p className="text-xs text-amber-700">
                    Die E-Mail ist voll — mehr Text passt nicht hinein. Alles Weitere lässt sich
                    in der Antwort darauf nachreichen.
                  </p>
                )}

                <details className="text-xs text-neutral-500">
                  <summary className="cursor-pointer select-none font-medium text-neutral-600">
                    Was wird mitgeschickt?
                  </summary>
                  {/* Shown in full before it leaves: the diagnostics are timings and a version,
                      but „technische Angaben" is not something to ask anyone to take on trust.
                      `feedbackMailBody`, not `feedbackBody` — the composer may still drop the
                      diagnostic block to make the mail fit, and a preview of a body that was
                      never sent is worse than none in a dialog promising this one. */}
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600">
                    {feedbackMailBody(draft, ctx)}
                  </pre>
                  {willAttach && (
                    <p className="mt-2">
                      Die Datei ist reine Textdatei und enthält keine Termine, Künstler oder
                      Kontakte — du kannst sie vor dem Anhängen in Ruhe durchlesen.
                    </p>
                  )}
                </details>
              </>
            )}
          </>
        )}

        {/* The handover. Everything the mail needs, in the order a compose window asks for it,
            and not one thing that happens on its own: the file is already on the desktop, the
            three buttons copy, and the `mailto:` is a link for whoever wants it (WP-66).

            A dialog rather than a card in the form so `ModalDepthCtx` gives it a depth of its
            own: Escape peels it off and leaves the filled-in form standing. It is narrower than
            the form behind it (`md`, the default) because it is a short list to work through,
            not a form to fill in. */}
        {step === 'send' && (
          <Modal
            title="So schickst du es ab"
            onClose={() => setStep('form')}
            footer={
              <>
                <Btn onClick={() => setStep('form')}>Zurück</Btn>
                <Btn variant="primary" onClick={finish}>
                  Fertig
                </Btn>
              </>
            }
          >
            <div className="space-y-4 text-sm text-neutral-600">
              {out.attachment && <p>Auftakt speichert eine Diagnose-Datei auf deinem Schreibtisch ab.</p>}
              <p>Die E-Mail schreibst du selbst — im Browser oder im E-Mail-Programm:</p>

              <div className="divide-y divide-neutral-100 rounded-xl border border-neutral-200">
                {fields.map((f) => (
                  <div key={f.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                    <span className="w-14 shrink-0 text-xs font-medium text-neutral-400">
                      {f.label}
                    </span>
                    <span className="min-w-0 flex-1 break-words text-neutral-800">{f.shown}</span>
                    {/* The label carries the row, so a screen reader hears three different
                        buttons rather than three „kopieren" — and „Kopiert ✓" replaces it
                        where the eye already is instead of in a toast at the far edge. */}
                    <Btn onClick={() => void copy(f)}>
                      {copied === f.key ? 'Kopiert ✓' : f.action}
                    </Btn>
                  </div>
                ))}
              </div>

              {/* Only after a copy was actually refused — a locked-down clipboard, an insecure
                  origin. The row above says what the text *is*; this is the text itself, so the
                  failure toast's „von Hand markieren" has something to point at. */}
              {showText && (
                <pre className="max-h-48 select-text overflow-auto whitespace-pre-wrap break-words rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600">
                  {fields.find((f) => f.key === 'body')?.copies}
                </pre>
              )}

              {out.attachment ? (
                <p className="font-medium text-neutral-800">
                  Zum Schluss die Datei <code>{out.attachment}</code> vom Schreibtisch anhängen und
                  abschicken. Das Anhängen kann kein Programm für dich übernehmen.
                </p>
              ) : (
                <p className="font-medium text-neutral-800">
                  Zum Schluss abschicken — verschicken kann Auftakt die E-Mail nicht selbst.
                </p>
              )}

              {/* Last, small, and a link rather than a button: on the machines this feature is
                  for there is often no mail client at all, and an offer that opens nothing is
                  worse than no offer. For whoever does have one it saves the three copies. */}
              <p className="text-xs text-neutral-500">
                Mit einem eingerichteten E-Mail-Programm geht es auch in einem Schritt:{' '}
                <ExternalLink href={feedbackMailto(draft, out)}>E-Mail-Programm öffnen</ExternalLink>
                .
              </p>
            </div>
          </Modal>
        )}
      </div>
    </Modal>
  );
}
