import { useEffect, useState } from 'react';
import { Btn, PickerRow } from './ui';
import { FooterHint, Label, Modal, TextArea } from './fields';
import { useToast } from './Toast';
import { useSeasonTerm } from '../hooks';
import { openExternal, type Diagnostics } from '../lib/external';
import {
  FEEDBACK_FIELD_MAX,
  FEEDBACK_KINDS,
  FEEDBACK_TO,
  diagnosticsFileName,
  feedbackBody,
  feedbackMailBody,
  feedbackMailto,
  feedbackRef,
  fitFeedbackAnswer,
  requiredField,
  type FeedbackContext,
  type FeedbackDraft,
  type FeedbackKind,
} from '../lib/feedbackMail';
import { useRovingFocus, rovingItem } from '../lib/rovingFocus';

/**
 * The guided support mail (WP-54).
 *
 * A „Feedback" button that opens a blank mail gets „es geht nicht" back, which costs a round
 * of questions before anything can be looked at — and the one answer that would settle the
 * boot-gesture report (WP-61) is in a file the customer has no way to reach. So the dialog
 * asks the questions a usable report answers, and hands over the diagnostics: a short summary
 * inside the mail, and the log in full as a file on the desktop, because a `mailto:` cannot
 * carry an attachment (see `electron/diagnostics.ts`).
 *
 * What it asks depends on the first answer. A wish and a fault are not the same question, and
 * asking „Was ist passiert?" about a wish is how feature requests arrive phrased as bugs.
 *
 * There is exactly one way out of it: „Weiter". No second button, no folder to go looking in —
 * the one step the app genuinely cannot do for anybody is attaching the file, so that is the
 * one step the dialog spends its words on. It spends them in a second dialog rather than in a
 * card above the button: a card is scrolled past, a dialog is answered.
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
  const [sending, setSending] = useState(false);
  // Set by the last keystroke that did not fit, cleared by the next one that did — see
  // `onAnswer`. A box that stops taking text without saying why reads as a broken keyboard.
  const [full, setFull] = useState(false);
  // The form, then the steps. Nothing is written and no client is opened until the second
  // one is answered — „Weiter" is a question, not the action.
  const [step, setStep] = useState<'form' | 'confirm'>('form');
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

  // „Worum geht's?" is a *where*, not a severity: it is the one thing the maintainer cannot
  // work out from the text, and it decides which screen to open first.
  const areas = ['Allgemein', term.singular, 'Künstler', 'Projekt', 'Termine'];

  const kindRoving = useRovingFocus();
  const areaRoving = useRovingFocus();
  const kinds = Object.keys(FEEDBACK_KINDS) as FeedbackKind[];

  const spec = kind ? FEEDBACK_KINDS[kind] : null;
  const draft: FeedbackDraft = { kind: kind ?? 'bug', area: area ?? '', answers };
  // Named before it exists, so „Was wird mitgeschickt?" shows the body that will really go
  // out. Main returns the name it actually wrote and that is what gets sent; this is the
  // prediction the preview is drawn from, and the two are pinned to agree in the tests.
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

  const send = async () => {
    setSending(true);
    let sent = ctx;
    if (willAttach) {
      // Written and revealed before the mail opens, in that order: the compose window should
      // be the thing on top when this is over, not a file manager.
      //
      // The copy that goes *into* the file carries neither the attach instruction nor the
      // summary: a file telling its reader to attach that same file is nonsense, and the log
      // it would summarize is printed in full two sections further down.
      const forFile = feedbackBody(draft, { ...ctx, attachment: '', diagnostics: '' });
      // Main answers `{ ok: false }` rather than throwing, but a channel that is not there at
      // all rejects — and an unhandled rejection here would leave „E-Mail öffnen" disabled
      // with no mail opened, which is the one state the second dialog must not be able to
      // end in. A failed write is a mail without an attachment, never a dead button.
      const saved = await window.auftakt?.saveDiagnostics?.(ref, forFile).catch(() => null);
      // A failed write drops the attachment line and puts the summary back, because promising
      // a file that was never written is worse than sending the short version of it.
      sent = saved?.ok ? { ...ctx, attachment: saved.name } : { ...ctx, attachment: '' };
    }
    openExternal(feedbackMailto(draft, sent));
    // A mailto: is fire-and-forget — the app can never learn whether it was sent, and a
    // customer who reads „gesendet" and closes their client is a bug report nobody gets.
    toast.show({
      message: sent.attachment
        ? `Die Datei ${sent.attachment} liegt auf dem Schreibtisch — bitte an die E-Mail anhängen und abschicken.`
        : 'E-Mail-Programm geöffnet — bitte dort noch abschicken.',
    });
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
          <Btn variant="primary" onClick={() => setStep('confirm')} disabled={!ready}>
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
                  {/* Unconditional, because the branch that needs it most is the one that used
                      to hide it: a Fehler on a machine with no mail handler opens nothing at
                      all, and this is then the only address anywhere in the app. */}
                  <p className="mt-2">Ohne E-Mail-Programm: direkt an {FEEDBACK_TO} schreiben.</p>
                </details>
              </>
            )}
          </>
        )}

        {/* What „Weiter" is about to set off, before any of it happens — a file appearing on
            the desktop and a mail opening on top of it is two surprises at once otherwise,
            and the attaching only happens if they are expecting to have to do it.

            A dialog rather than the card this used to be, and rendered inside the one above
            so `ModalDepthCtx` gives it a depth of its own: Escape peels it off and leaves the
            filled-in form standing. Both buttons are in the footer, „Zurück" first, because a
            confirm has no body tabbable and `Modal` focuses the footer's first button — the
            keystroke that reaches the question should answer it with the safe answer. */}
        {step === 'confirm' && (
          <Modal
            title="So geht es weiter"
            onClose={() => setStep('form')}
            footer={
              <>
                <Btn onClick={() => setStep('form')}>Zurück</Btn>
                <Btn variant="primary" onClick={() => void send()} disabled={sending}>
                  E-Mail öffnen
                </Btn>
              </>
            }
          >
            <ol className="list-decimal space-y-2 pl-5 text-sm text-neutral-600">
              {willAttach && (
                <li>
                  Auftakt legt <code>{willAttach}</code> auf deinem Schreibtisch ab — das
                  vollständige Startprotokoll und die Angaben zu deinem Rechner.
                </li>
              )}
              <li>Dein E-Mail-Programm öffnet sich mit dem fertigen Text.</li>
              {willAttach && (
                <li className="font-medium text-neutral-800">
                  Die Datei hängst du selbst an — zieh sie vom Schreibtisch in die E-Mail. Das
                  kann kein Programm für dich übernehmen.
                </li>
              )}
              <li>
                Abschicken
                {willAttach ? '.' : ' — Auftakt kann die E-Mail nicht selbst verschicken.'}
              </li>
            </ol>
          </Modal>
        )}
      </div>
    </Modal>
  );
}
