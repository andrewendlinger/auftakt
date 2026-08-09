import { useState, type KeyboardEvent } from 'react';
import { Label, Modal, TextInput } from './fields';
import { PillSelect } from './PillSelect';
import { RichTextEditor } from './RichTextEditor';
import { Btn } from './ui';
import { api } from '../api/client';
import type { CustomColumnOption, EventItem } from '../api/types';
import { formatEventWhen } from '../lib/dates';
import { eventTimeProblem, fieldsFromEvent, whenFromFields, type EventFields } from '../lib/eventTime';
import { useGuardedAction, useInvalidateAll, useUndoablePatch } from '../hooks';

export interface EventParent {
  artist_id?: number;
  project_id?: number;
}

const FIELD_KEYS = ['startDate', 'startTime', 'endDate', 'endTime'] as const;

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

  const setField = (k: keyof EventFields) => (e: { target: { value: string } }) =>
    setFields((f) => ({ ...f, [k]: e.target.value }));

  // The only required-field check used to be an invisible `return` in `submit`, with Speichern
  // still enabled and „Titel *" unmarked: clicking it did nothing at all, not even a busy
  // state, so users concluded the dialog was broken and left via Abbrechen or Escape — losing
  // everything they had typed, rich-text notes included (RTE-10).
  const missingTitle = !title.trim();
  // The second blocking reason, shown next to the fields it is about rather than in the footer.
  const timeProblem = eventTimeProblem(fields);

  // A stray backdrop click used to discard the whole dialog; it asks first once anything has
  // been entered (TTU-17). Compared against what the dialog opened with, not against defaults.
  const dirty =
    type !== initial.type ||
    title !== initial.title ||
    location !== initial.location ||
    notes !== initial.notes ||
    FIELD_KEYS.some((k) => fields[k] !== initial.when[k]);

  // Exactly what „Speichern" would write, so the summary below the fields cannot describe
  // something other than what lands in the database.
  const when = whenFromFields(fields);

  const submit = async () => {
    if (missingTitle || timeProblem || busy) return;
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

  /**
   * Enter saves. Attached to each single-line input rather than to the grid, on purpose: the
   * notes are a `RichTextEditor` where Enter is a paragraph, and `PillSelect` re-implements the
   * keyboard contract of the `<select>` it replaced, Enter included (RTE-11). Neither may see it.
   */
  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    void submit();
  };

  return (
    <Modal
      title={event ? 'Termin bearbeiten' : 'Neuer Termin'}
      onClose={onClose}
      size="lg"
      dirty={dirty}
      footer={
        <>
          {missingTitle && (
            <p className="mr-auto self-center text-xs text-neutral-500">Bitte ausfüllen: Titel</p>
          )}
          <Btn onClick={onClose}>Abbrechen</Btn>
          <Btn variant="primary" onClick={submit} disabled={busy || missingTitle || !!timeProblem}>
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
                  Playwright checks in docs/VERIFYING.md, which otherwise count inputs. */}
              <TextInput
                type="date"
                aria-label={`${row.label} — Datum`}
                value={fields[row.date]}
                onKeyDown={onEnter}
                onChange={setField(row.date)}
              />
            </div>
            <div className="w-full sm:w-32">
              <Label>Uhrzeit</Label>
              <TextInput
                type="time"
                aria-label={`${row.label} — Uhrzeit`}
                value={fields[row.time]}
                onKeyDown={onEnter}
                onChange={setField(row.time)}
              />
            </div>
          </div>
        ))}

        {/* What the two checkboxes used to say, said by the dialog instead: rendered from the
            payload above through the same `formatEventWhen` the list and the print sheets use. */}
        <div className="col-span-2 -mt-1">
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
