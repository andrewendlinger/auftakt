import { useState } from 'react';
import { FooterHint, Label, Modal, TextInput, onEnterKey } from './fields';
import { PillSelect } from './PillSelect';
import { RichTextEditor } from './RichTextEditor';
import { Btn } from './ui';
import { api } from '../api/client';
import type { CustomColumnOption, EventItem } from '../api/types';
import { formatEventWhen } from '../lib/dates';
import {
  eventTimeProblem,
  fieldsFromEvent,
  fieldsTouched,
  untouchedWhen,
  whenFromFields,
  withStartDate,
  type EventFields,
} from '../lib/eventTime';
import { useGuardedAction, useInvalidateAll, useUndoablePatch } from '../hooks';

export interface EventParent {
  artist_id?: number;
  project_id?: number;
}

export function EventEditor({
  event,
  parent,
  eventTypes,
  onClose,
}: {
  event: EventItem | null;
  parent: EventParent;
  eventTypes: CustomColumnOption[];
  onClose: () => void;
}) {
  const invalidate = useInvalidateAll();
  const undoablePatch = useUndoablePatch();
  const guard = useGuardedAction();

  /**
   * One source for both the starting values and the `dirty` comparison, computed exactly once.
   *
   * That is not tidiness: WP-28 had the baseline read `!!event?.all_day` while the initial value
   * defaulted to `true`, so a freshly opened, untouched „Neuer Termin" counted as changed and
   * asked „Änderungen verwerfen?" on Escape (TTU-17). With four boxes instead of two pickers and
   * two checkboxes there is more to keep in step, so the two readings are now literally the same
   * expression and cannot drift apart.
   */
  const [initial] = useState(() => ({
    type: event?.type ?? eventTypes[0]?.value ?? 'Termin',
    title: event?.title ?? '',
    location: event?.location ?? '',
    notes: event?.notes ?? '',
    when: fieldsFromEvent(event),
  }));

  const [type, setType] = useState(initial.type);
  const [title, setTitle] = useState(initial.title);
  const [location, setLocation] = useState(initial.location);
  const [notes, setNotes] = useState(initial.notes);
  // Four plain strings — the mode („ganztägig", „Datum offen") is derived from them on save
  // rather than carried in checkboxes of its own. See `lib/eventTime.ts` for the rules.
  const [fields, setFields] = useState<EventFields>(initial.when);
  const [busy, setBusy] = useState(false);
  const [titleTouched, setTitleTouched] = useState(false);
  /**
   * The boxes a native picker considers half-typed, which is not a state their `value` can show.
   *
   * An incomplete date or time reads as `''` — „20" in the Uhrzeit box is not a start time, it is
   * an empty one, and empty means all-day: clicking Speichern there rewrote a 19:30 event as
   * „ganztägig" and dropped the clock time the box was still showing. `onEnterKey` sits the
   * picker types out for the same reason, but the button and the footer had no equivalent guard.
   *
   * `validity.badInput` is the only way to see it, and blur is the only moment worth reading it:
   * the picker fires no change event while the value stays incomplete, and every route to
   * Speichern leaves the box first.
   */
  const [halfTyped, setHalfTyped] = useState<Partial<Record<keyof EventFields, boolean>>>({});

  const edit =
    (k: keyof EventFields, next: (f: EventFields, v: string) => EventFields) =>
    (e: { target: { value: string } }) => {
      setFields((f) => next(f, e.target.value));
      setHalfTyped((h) => (h[k] ? { ...h, [k]: false } : h));
    };
  const setField = (k: keyof EventFields) => edit(k, (f, v) => ({ ...f, [k]: v }));
  const checkComplete = (k: keyof EventFields) => (e: React.FocusEvent<HTMLInputElement>) => {
    const bad = e.currentTarget.validity.badInput;
    setHalfTyped((h) => (!!h[k] === bad ? h : { ...h, [k]: bad }));
  };
  const clearWhen = () => {
    setFields({ startDate: '', startTime: '', endDate: '', endTime: '' });
    setHalfTyped({});
  };

  // The only required-field check used to be an invisible `return` in `submit`, with Speichern
  // still enabled and „Titel *" unmarked: clicking it did nothing at all, not even a busy
  // state, so users concluded the dialog was broken and left via Abbrechen or Escape — losing
  // everything they had typed, rich-text notes included (RTE-10).
  const missingTitle = !title.trim();

  const timesTouched = fieldsTouched(fields, initial.when);

  // A stray backdrop click used to discard the whole dialog; it asks first once anything has
  // been entered (TTU-17). Compared against what the dialog opened with, not against defaults.
  const dirty =
    type !== initial.type ||
    title !== initial.title ||
    location !== initial.location ||
    notes !== initial.notes ||
    timesTouched;

  // The three date columns as „Speichern" would write them — also what the summary below the
  // fields renders, so it cannot describe something other than what lands in the database. A row
  // whose four boxes are untouched is written back exactly as it was read rather than derived,
  // and nothing about it is refused; `untouchedWhen` carries the why.
  const stored = untouchedWhen(event, fields);
  const when = stored ?? whenFromFields(fields);
  // The second blocking reason, shown next to the fields it is about *and* in the footer. A
  // half-typed box comes first: its value is `''`, so every rule below it — and the summary —
  // would describe an event without the date or time the box is visibly showing.
  const timeProblem = Object.values(halfTyped).some(Boolean)
    ? 'Datum oder Uhrzeit ist unvollständig — bitte vervollständigen oder das Feld leeren.'
    : stored
      ? null
      : eventTimeProblem(fields);

  // Both blocking reasons reach the footer, and both reach `submit` and „Speichern" through this
  // one value: three spellings of „cannot save" are three things a fourth reason has to be added
  // to, and a button that goes live while the hint still says why it should not is RTE-10 again.
  // The time problem is *also* shown in red next to the boxes, but the dialog body scrolls: with
  // a few paragraphs of Notizen open that line is off screen.
  const blocker = missingTitle ? 'Bitte ausfüllen: Titel' : timeProblem;

  const submit = async () => {
    // Marked here and not only on blur: Enter saves from the Titel box itself, so a blocked
    // attempt from a field the user never left would otherwise change nothing on screen at all —
    // the footer hint was already there — and the dialog reads as broken (RTE-10).
    if (missingTitle) setTitleTouched(true);
    if (blocker || busy) return;
    setBusy(true);
    const payload = {
      artist_id: event ? event.artist_id : (parent.artist_id ?? null),
      project_id: event ? event.project_id : (parent.project_id ?? null),
      type,
      title: title.trim(),
      ...when,
      location: location.trim() === '' ? null : location,
      notes: notes.trim() === '' ? null : notes,
    };
    try {
      // Without this the rejection was dropped by `Btn`'s onClick: the dialog stayed open
      // looking exactly as before, so the user clicked Speichern again and again — collecting
      // duplicate events once the transient cause cleared (RTE-04).
      const ok = await guard('Der Termin konnte nicht gespeichert werden.', () =>
        event
          ? undoablePatch({ res: api.events, row: event, patch: payload, label: 'Änderung am Termin' })
          : api.events.create(payload).then(invalidate),
      );
      if (ok) onClose();
    } finally {
      setBusy(false);
    }
  };

  // Enter saves — the shared handler, on the two text boxes only. See `onEnterKey` for why the
  // date and time boxes are not among them and why this is not on the grid.
  const onEnter = onEnterKey(submit);

  return (
    <Modal
      title={event ? 'Termin bearbeiten' : 'Neuer Termin'}
      onClose={onClose}
      size="lg"
      dirty={dirty}
      footer={
        <>
          {blocker && <FooterHint>{blocker}</FooterHint>}
          <Btn onClick={onClose}>Abbrechen</Btn>
          <Btn variant="primary" onClick={submit} disabled={busy || !!blocker}>
            Speichern
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-3">
        {/* Title first and alone: it is the only required field, and it used to sit third,
            behind a type dropdown and two checkboxes the customer never touched (WP-40). */}
        <div className="col-span-2">
          <Label>Titel *</Label>
          <TextInput
            autoFocus
            value={title}
            invalid={missingTitle && titleTouched}
            onBlur={() => setTitleTouched(true)}
            onKeyDown={onEnter}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {/* Date and time are two controls, not one `datetime-local`. That control renders both
            halves inside a single box and wrapped *within itself* at half the modal's width —
            the complaint WP-40 opens with, and one no grid change could have fixed. Splitting
            it also removed both checkboxes: an empty date is „Datum offen", an empty time is
            all-day, which is what they meant anyway. */}
        {(
          [
            { key: 'start', label: 'Beginn', date: 'startDate', time: 'startTime' },
            { key: 'end', label: 'Ende (optional)', date: 'endDate', time: 'endTime' },
          ] as const
        ).map((row) => (
          <div key={row.key} className="col-span-2 flex flex-wrap items-end gap-3">
            <div className="w-full sm:w-52">
              <Label>{row.label}</Label>
              {/* `Label` has no `htmlFor` and these fields carry no placeholder, so the
                  aria-label is what makes them addressable — for screen readers and for the
                  Playwright checks in docs/VERIFYING.md, which otherwise count inputs.
                  Moving the *start* date takes a derived end date with it (`withStartDate`). */}
              <TextInput
                type="date"
                aria-label={`${row.label} — Datum`}
                value={fields[row.date]}
                onBlur={checkComplete(row.date)}
                onChange={
                  row.date === 'startDate' ? edit('startDate', withStartDate) : setField(row.date)
                }
              />
            </div>
            <div className="w-full sm:w-32">
              <Label>Uhrzeit</Label>
              <TextInput
                type="time"
                aria-label={`${row.label} — Uhrzeit`}
                value={fields[row.time]}
                onBlur={checkComplete(row.time)}
                onChange={setField(row.time)}
              />
            </div>
          </div>
        ))}

        {/* What the two checkboxes used to say, said by the dialog instead: rendered from the
            payload above through the same `formatEventWhen` the list and the print sheets use. */}
        <div className="col-span-2 -mt-1 flex items-start justify-between gap-3">
          {timeProblem ? (
            <p className="text-xs text-red-600">{timeProblem}</p>
          ) : (
            <p className="text-xs text-neutral-500">
              {!when.start_at
                ? 'Datum offen — der Termin erscheint ganz oben in der Liste.'
                : when.all_day
                  ? `Ganztägig · ${formatEventWhen(when)}`
                  : formatEventWhen(when)}
            </p>
          )}
          {/* „Datum offen" as an *action*, not the checkbox it replaced: the state is four empty
              boxes, and emptying them one at a time goes through „Ein Ende ohne Beginn kann nicht
              gespeichert werden" — a refusal about a box the user had not reached yet (WP-40). */}
          {(fields.startDate || fields.startTime || fields.endDate || fields.endTime) && (
            <button
              type="button"
              onClick={clearWhen}
              title="Alle Datums- und Zeitfelder leeren"
              className="shrink-0 text-xs text-neutral-400 transition hover:text-neutral-700"
            >
              Datum offen
            </button>
          )}
        </div>

        <div className="col-span-2 sm:col-span-1">
          <Label>Ort</Label>
          <TextInput value={location} onKeyDown={onEnter} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <Label>Typ</Label>
          {/* `eventTypes` carries a colour per entry, and EventList renders each event's type
              as a coloured pill from exactly that data. A plain <Select> threw the colour away,
              so a user who colour-codes Auftritt/Probe/Deadline saw those colours everywhere
              except the one screen where they pick a type (RTE-18). */}
          <div className="py-1">
            <PillSelect value={type} options={eventTypes} onChange={setType} />
          </div>
        </div>
        <div className="col-span-2">
          <Label>Notizen</Label>
          <RichTextEditor value={notes} onChange={setNotes} />
        </div>
      </div>
    </Modal>
  );
}
