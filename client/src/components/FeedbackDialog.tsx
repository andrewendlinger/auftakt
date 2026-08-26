import { useEffect, useRef, useState } from 'react';
import { Btn, ExternalLink } from './ui';
import { Label, Modal, TextArea } from './fields';
import { useToast } from './Toast';
import { type Diagnostics } from '../lib/external';
import {
  FEEDBACK_NOTE_MAX,
  FEEDBACK_TO,
  feedbackMailto,
  feedbackRef,
  feedbackReport,
  type FeedbackContext,
} from '../lib/feedbackMail';

/**
 * Reporting something, in two clicks (WP-54, reshaped by WP-66, cut down by WP-75).
 *
 * **What it costs the customer is the whole design.** The first version asked which kind of
 * thing this was, then which area it was in, then made them write an answer, and only then
 * handed over an address, a subject and a body to copy — seven to nine clicks and a paragraph
 * of typing before anything was on their desktop. What actually helps is the file: the log in
 * full, the version, the machine, in one `.txt` a maintainer can read. So the file is what one
 * click produces, and writing a word about it is optional.
 *
 * Open · „Bericht speichern" · „Fertig" — and between the second and the third, the address on
 * one copy button and two sentences saying to attach the file. Nothing else is asked.
 *
 * **Nothing on this path opens anything (WP-66).** It used to: one click wrote the file, opened
 * a Finder window on it and launched a mail client, and the customer met two new windows before
 * having read a word. Webmail in a browser is the normal case for the people this is for, and
 * on such a machine the mail client either does not exist or is not the one they use. So the
 * second step *hands over* instead — the address to copy, and the file already lying on the
 * desktop — and the `mailto:` survives as one optional link for whoever does have a client set
 * up. `docs/DECISIONS.md` carries both that reversal and this cut.
 *
 * The two steps are one dialog in two states rather than two stacked ones. The handover
 * replaces the form instead of covering it, which is what a step is; the form is one optional
 * box, so there is nothing behind the second state worth keeping on screen.
 */
export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [version, setVersion] = useState('');
  // What main really wrote, and the only thing the handover is ever composed from: `null` is
  // the form, an `attachment` of '' means there is no file (the browser build, a failed
  // write). Never a prediction — the handover does not open until this is settled, because
  // everything in it names the file.
  const [sent, setSent] = useState<{ attachment: string; failed: boolean } | null>(null);
  // The save button pressed, main not back yet. It disables the button rather than opening a
  // handover that would have to guess the name.
  const [saving, setSaving] = useState(false);
  // Report text → the name main gave the bundle holding it. Keyed by the text and not by „has
  // anything been written at all": „Text ergänzen", a correction and a second save has to write
  // a *second* bundle, because attaching the first version of what they wrote is worse than a
  // stray text file — while going back to a text that is already on the desktop has to name
  // that file rather than write a third.
  const written = useRef(new Map<string, string>());
  // Cleared on a timer below; a failed copy says so in a toast instead, because there is
  // nothing to confirm.
  const [copied, setCopied] = useState(false);
  // Stamped once, when the dialog opened: it names both the file and the mail beside it, and a
  // second save out of the same dialog has to land on the same reference — that is what makes
  // main's `uniqueBundleName` answer `…-2.txt` rather than a second first name.
  const [ref] = useState(() => feedbackRef(new Date()));
  // The bridge, not the method: without a preload there is no desktop to write to, and the
  // dialog then hands over an address and nothing else.
  const canSave = typeof window.auftakt?.saveDiagnostics === 'function';

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
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(t);
  }, [copied]);

  const ctx: FeedbackContext = {
    ref,
    version,
    platform: window.auftakt?.platform ?? '',
    system: diag?.system ?? '',
    // Only reaches the mail when no file was written — `feedbackBody` drops it otherwise,
    // rather than sending the digest and the whole log it digests.
    diagnostics: diag?.summary ?? '',
    attachment: sent?.attachment ?? '',
  };

  /**
   * The one click: put the file on the desktop, *then* show what to do with it.
   *
   * In that order, and the step waits for main's answer. Everything in the handover names the
   * file — the attach line, the `mailto:` behind the optional link, the toast — and the name is
   * only predictable for the *first* bundle: a second one comes back as `…-2.txt`
   * (`uniqueBundleName`), so a handover opened before main answered would tell a customer who
   * has just added a sentence to attach the file without it.
   *
   * The write happens here rather than behind a button in the handover because the file has to
   * already be there when the customer switches to their mail — they attach it before they come
   * back, and a step telling them to attach a file that main has not written yet is the one
   * instruction the dialog must not give. It also happens *only* here: opening the dialog
   * writes nothing, so a customer who looks and closes leaves no file behind. Nothing is
   * revealed and nothing is opened; the only trace is a named text file where they can see it.
   */
  const save = () => {
    if (!canSave) {
      setSent({ attachment: '', failed: false });
      return;
    }
    const report = feedbackReport(note);
    const already = written.current.get(report);
    if (already !== undefined) {
      setSent({ attachment: already, failed: false });
      return;
    }
    setSaving(true);
    // Main answers `{ ok: false }` rather than throwing, but a channel that is not there at all
    // rejects — and an unhandled rejection here would leave the button disabled with no
    // handover ever shown. A failed write is a mail without an attachment, never a dead button.
    void window.auftakt
      ?.saveDiagnostics?.(ref, report)
      .catch(() => null)
      .then((saved) => {
        if (saved?.ok) written.current.set(report, saved.name);
        setSent({ attachment: saved?.ok ? saved.name : '', failed: !saved?.ok });
        setSaving(false);
      });
  };

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(FEEDBACK_TO);
      setCopied(true);
    } catch {
      setCopied(false);
      // The address is on screen in full beside the button, so there is something for „von
      // Hand markieren" to point at — which is why this row needs no fallback of its own.
      toast.show({
        message: 'Kopieren hat nicht geklappt — die Adresse steht im Dialog und lässt sich von Hand markieren.',
      });
    }
  };

  // The dialog closes on the customer's own „Fertig", so nothing here can claim the mail was
  // sent. What outlives the dialog is the file, so that is what the reminder is about.
  const finish = () => {
    if (sent?.attachment) {
      toast.show({
        message: `Die Datei ${sent.attachment} liegt auf deinem Schreibtisch — bitte an die E-Mail anhängen und abschicken.`,
      });
    }
    onClose();
  };

  return (
    <Modal
      title="Feedback & Diagnose"
      onClose={onClose}
      // Guard exactly the words that exist nowhere but in this box: a note whose report is in
      // `written` is on the desktop and no longer at stake — which also keeps „Text ergänzen"
      // with an unchanged text from asking about a file that was already written. A *failed*
      // write is the opposite case: `sent.failed` means the paragraph never reached a file,
      // so closing from the handover must still ask (PR157-review finding 1).
      dirty={(sent === null || sent.failed) && note.trim() !== '' && !written.current.has(feedbackReport(note))}
      footer={
        sent === null ? (
          <>
            <Btn onClick={onClose}>Abbrechen</Btn>
            {/* Disabled *and* re-labelled while main is writing: the handover is composed from
                the name main returns, so it opens once and opens correct — but the wait is up
                to two seconds when the GPU process is the thing that is wedged
                (`collectSystemFacts` races `getGPUInfo` against a 2 s timeout, and a wedged GPU
                is exactly what gets reported). A primary button that only greys out for that
                long reads as a dead button, and the person watching it is the one already
                having a bad time. */}
            <Btn variant="primary" onClick={save} disabled={saving}>
              {saving ? 'Speichert…' : canSave ? 'Bericht speichern' : 'Weiter'}
            </Btn>
          </>
        ) : (
          <>
            {/* Not „Zurück": the only reason to go back is to say something, and naming it is
                what stops the second save from being a mystery. It writes a second bundle
                unless the text is one already on the desktop. */}
            <Btn onClick={() => setSent(null)}>Text ergänzen</Btn>
            <Btn variant="primary" onClick={finish}>
              Fertig
            </Btn>
          </>
        )
      }
    >
      {sent === null ? (
        <div className="space-y-4">
          <p className="text-sm text-neutral-600">
            {canSave
              ? 'Auftakt legt einen Bericht auf deinen Schreibtisch. Den schickst du uns per E-Mail — wie das geht, steht im nächsten Schritt.'
              : 'Im Browser-Modus legt Auftakt keinen Bericht an — das tut nur die Desktop-App. Die Adresse steht im nächsten Schritt.'}
          </p>

          <div>
            {/* Optional, and it says so where the question is asked rather than in a hint
                somewhere under it: „(optional)" in the label is the difference between a form
                to fill in and a box to use if there is something to say. */}
            <Label>Was ist passiert? (optional)</Label>
            <TextArea
              rows={4}
              maxLength={FEEDBACK_NOTE_MAX}
              className="resize-y"
              placeholder="z. B. „Beim Drucken bleibt das Blatt leer.“"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <p className="mt-1 text-xs text-neutral-400">
              Kann leer bleiben — der Bericht allein hilft schon weiter.
            </p>
          </div>

          {canSave && (
            <details className="text-xs text-neutral-500">
              <summary className="cursor-pointer select-none font-medium text-neutral-600">
                Was steht im Bericht?
              </summary>
              {/* The same promise the file itself opens with, made before it is written:
                  „technische Angaben" is not something to ask anyone to take on trust in an app
                  holding a festival's contact data. */}
              <p className="mt-2">
                Auftakt-Version, Betriebssystem, Bildschirm, die Protokolle der letzten
                Programmstarts — und was du oben schreibst. Keine privaten oder vertraulichen
                Daten; du kannst die Datei vor dem Anhängen in Ruhe durchlesen.
              </p>
              {diag?.summary && (
                <pre className="mt-2 overflow-x-auto rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600">
                  {diag.summary}
                </pre>
              )}
            </details>
          )}
        </div>
      ) : (
        /* The handover: where the file is, where to send it, and not one thing that happens on
           its own (WP-66). Three lines of it, because the customer is now in their mail
           program and everything said here has to survive the walk over. */
        <div className="space-y-4 text-sm text-neutral-600">
          {sent.attachment ? (
            /* The name on its own line, not inside the sentence: it is what the customer has to
               find among everything else on their desktop, and a file name broken across a line
               wrap in the middle of a paragraph is one they cannot match by eye. */
            <div>
              <p>Der Bericht liegt jetzt auf deinem Schreibtisch:</p>
              <p className="mt-1.5">
                <code className="break-all rounded bg-neutral-100 px-1.5 py-1 font-medium text-neutral-800">
                  {sent.attachment}
                </code>
              </p>
            </div>
          ) : sent.failed ? (
            <p>Der Bericht ließ sich diesmal nicht speichern — schreib uns bitte trotzdem.</p>
          ) : (
            <p>Ohne Desktop-App gibt es keine Berichtsdatei — schreib uns einfach direkt.</p>
          )}

          {/* Focused, so the first Tab and the first Enter land on the first thing to do — the
              WP-42 rule („the dialog's first field"), which this state has to place itself:
              the body changed under a `Modal` that places focus only when it opens. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-neutral-200 px-3 py-2.5">
            <span className="w-8 shrink-0 text-xs font-medium text-neutral-400">An</span>
            <span className="min-w-0 flex-1 break-words text-neutral-800">{FEEDBACK_TO}</span>
            <Btn autoFocus onClick={() => void copyAddress()}>
              {copied ? 'Kopiert ✓' : 'Adresse kopieren'}
            </Btn>
          </div>

          {sent.attachment ? (
            <p className="font-medium text-neutral-800">
              Häng die Datei an eine E-Mail an diese Adresse und schick sie ab. Sie enthält
              keine privaten oder vertraulichen Daten.
            </p>
          ) : (
            <p className="font-medium text-neutral-800">
              Schreib eine E-Mail an diese Adresse — am besten mit einem Satz dazu, was passiert
              ist.
            </p>
          )}

          {/* Last, small, and a link rather than a button: on the machines this feature is for
              there is often no mail client at all, and an offer that opens nothing is worse
              than no offer. For whoever does have one it saves the copying. */}
          <p className="text-xs text-neutral-500">
            Oder einfach <ExternalLink href={feedbackMailto(note, ctx)}>hier klicken</ExternalLink>,
            um einen E-Mail-Entwurf zu öffnen
            {sent.attachment ? ' — die Datei anhängen musst du aber noch selbst.' : '.'}
          </p>
        </div>
      )}
    </Modal>
  );
}
