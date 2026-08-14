import { useEffect, useState } from 'react';
import { Btn, Card, PickerRow } from './ui';
import { FooterHint, Label, Modal, TextArea } from './fields';
import { useToast } from './Toast';
import { useSeasonTerm } from '../hooks';
import { openExternal, type BootDiagnostics } from '../lib/external';
import {
  FEEDBACK_FIELD_MAX,
  FEEDBACK_TO,
  feedbackBody,
  feedbackMailto,
  type FeedbackDraft,
} from '../lib/feedbackMail';
import { useRovingFocus, rovingItem } from '../lib/rovingFocus';

/**
 * The guided support mail (WP-54).
 *
 * A „Feedback" button that opens a blank mail gets „es geht nicht" back, which costs a round
 * of questions before anything can be looked at — and the one answer that would settle the
 * boot-gesture report (WP-61) is in a file the customer has no way to reach. So the dialog
 * asks the three questions a usable report answers, and attaches a short summary of the last
 * program starts, which the composer keeps inside what a mail client will carry.
 *
 * Everything shaped like logic is somewhere else and unit-tested: `feedbackMailto` builds the
 * URL, `summarizeBootLog` builds the diagnostic block. What is left here is the form.
 */
export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const term = useSeasonTerm();
  const toast = useToast();
  const [area, setArea] = useState<string | null>(null);
  const [did, setDid] = useState('');
  const [happened, setHappened] = useState('');
  const [expected, setExpected] = useState('');
  const [diag, setDiag] = useState<BootDiagnostics | null>(null);
  const [version, setVersion] = useState('');

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

  const roving = useRovingFocus();
  const stop = area ?? areas[0];

  const draft: FeedbackDraft = { area: area ?? '', did, happened, expected };
  const ctx = {
    version,
    platform: window.auftakt?.platform ?? '',
    diagnostics: diag?.summary ?? '',
  };
  const ready = area !== null && happened.trim().length > 0;
  const hasBridge = typeof window.auftakt?.revealDiagnostics === 'function';

  const send = () => {
    openExternal(feedbackMailto(draft, ctx));
    // A mailto: is fire-and-forget — the app can never learn whether it was sent, and a
    // customer who reads „gesendet" and closes their client is a bug report nobody gets.
    toast.show({ message: 'E-Mail-Programm geöffnet — bitte dort noch abschicken.' });
    onClose();
  };

  const copy = () => {
    void navigator.clipboard
      ?.writeText(`${FEEDBACK_TO}\n\n${feedbackBody(draft, ctx)}`)
      .then(() => toast.show({ message: 'Text kopiert — in eine E-Mail einfügen.' }))
      .catch(() => toast.show({ message: 'Text konnte nicht kopiert werden.' }));
  };

  const reveal = () => {
    void window.auftakt?.revealDiagnostics?.().then((r) => {
      // Silence on 'revealed': the window that just opened in Finder is the feedback.
      if (r === 'opened') {
        toast.show({ message: 'Noch keine Startprotokolle — der Ordner ist geöffnet.' });
      } else if (r !== 'revealed') {
        toast.show({ message: 'Der Ordner konnte nicht geöffnet werden.' });
      }
    });
  };

  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
    autoFocus = false,
  ) => (
    <div>
      <Label>{label}</Label>
      <TextArea
        autoFocus={autoFocus}
        rows={3}
        maxLength={FEEDBACK_FIELD_MAX}
        className="resize-y"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );

  return (
    <Modal
      title="Feedback & Diagnose"
      onClose={onClose}
      // Only typed text is worth a question — a picked area is one click to redo.
      dirty={[did, happened, expected].some((v) => v.trim() !== '')}
      size="lg"
      footer={
        <>
          {!ready && (
            <FooterHint>
              {area === null ? 'Bitte zuerst einen Bereich wählen.' : 'Bitte „Was ist passiert?“ ausfüllen.'}
            </FooterHint>
          )}
          <Btn onClick={onClose}>Abbrechen</Btn>
          <Btn onClick={copy} disabled={!ready}>
            Text kopieren
          </Btn>
          <Btn variant="primary" onClick={send} disabled={!ready}>
            E-Mail schreiben
          </Btn>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label>Worum geht’s?</Label>
          {/* One tab stop for the whole group, arrows inside it: five rows between the
              dialog's first stop and the text fields is four Tabs of nothing. */}
          <div ref={roving.ref} onKeyDown={roving.onKeyDown} className="space-y-1.5">
            {areas.map((a) => (
              <PickerRow
                key={a}
                {...rovingItem(a === stop)}
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
            {field(
              'Was ist passiert?',
              happened,
              setHappened,
              'z. B. „Beim Start war die Animation nur kurz zu sehen, dann kam die Übersicht.“',
              true,
            )}
            {field('Was hast du davor gemacht?', did, setDid, 'z. B. „Auftakt neu gestartet.“')}
            {field(
              'Was hättest du erwartet?',
              expected,
              setExpected,
              'Optional — hilft, wenn es nicht offensichtlich ist.',
            )}

            <details className="text-xs text-neutral-500">
              <summary className="cursor-pointer select-none font-medium text-neutral-600">
                Was wird mitgeschickt?
              </summary>
              {/* Shown in full before it leaves: the diagnostics are timings and a version,
                  but „technische Angaben" is not something to ask anyone to take on trust. */}
              <pre className="mt-2 overflow-x-auto rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600">
                {feedbackBody(draft, ctx)}
              </pre>
            </details>
          </>
        )}

        <Card className="bg-neutral-50 p-3 text-xs text-neutral-500 shadow-none">
          <div className="flex flex-wrap items-center gap-2">
            <Btn onClick={reveal} disabled={!hasBridge}>
              Diagnoseordner öffnen
            </Btn>
            <span>
              Für ein Startproblem: den Ordner öffnen und <code>boot-log.jsonl</code> an die E-Mail
              anhängen.
            </span>
          </div>
          {diag && <p className="mt-2 break-all text-neutral-400">{diag.file}</p>}
          {!hasBridge && (
            <p className="mt-2 text-amber-600">
              Der Diagnoseordner steht nur in der Desktop-App zur Verfügung, nicht im Browser-Modus.
            </p>
          )}
          <p className="mt-2">
            Ohne E-Mail-Programm: direkt an <strong>{FEEDBACK_TO}</strong> schreiben.
          </p>
        </Card>
      </div>
    </Modal>
  );
}
