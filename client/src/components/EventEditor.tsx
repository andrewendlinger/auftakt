import { useState } from 'react';
import { Label, Modal, TextInput } from './fields';
import { PillSelect } from './PillSelect';
import { RichTextEditor } from './RichTextEditor';
import { Btn } from './ui';
import { api } from '../api/client';
import type { CustomColumnOption, EventItem } from '../api/types';
import { useGuardedAction, useInvalidateAll, useUndoablePatch } from '../hooks';

export interface EventParent {
  artist_id?: number;
  project_id?: number;
}

/** A stored `YYYY-MM-DD` (all-day) widened to `YYYY-MM-DDTHH:mm`; anything else left alone. */
function withTime(stored: string | null | undefined, fallback: string): string {
  if (!stored) return '';
  return stored.length === 10 ? `${stored}T${fallback}` : stored;
}

/** The value to store: all-day events keep only the calendar day, per the date convention. */
function forStorage(v: string, allDay: boolean): string | null {
  if (v.trim() === '') return null;
  return allDay ? v.slice(0, 10) : v;
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
  const [type, setType] = useState(event?.type ?? eventTypes[0]?.value ?? 'Termin');
  const [title, setTitle] = useState(event?.title ?? '');
  // A new event is all-day: typing a date and saving is the common case, and hunting for the
  // checkbox every time was the friction WP-28 names. Editing still reads the record — an
  // existing event with a clock time must not lose it on open. Used as the `dirty` baseline
  // too, or an untouched „Neuer Termin" would open dirty and ask before closing on Escape.
  const initialAllDay = event ? !!event.all_day : true;
  const [allDay, setAllDay] = useState<boolean>(initialAllDay);
  // TBD = no fixed date yet; stored as start_at NULL. The pickers keep their values while
  // the box is ticked so un-ticking restores them.
  const [tbd, setTbd] = useState<boolean>(event ? !event.start_at : false);
  // „Mit Uhrzeit" follows the same rule: `start`/`end` always hold the full `YYYY-MM-DDTHH:mm`
  // and `submit` derives the date-only form. Truncating them on toggle destroyed the event's
  // real clock times — untick and immediately re-tick and 19:30–21:15 came back as 09:00–10:00,
  // unrecoverable inside the dialog and written to the DB on Speichern (RTE-03).
  const [start, setStart] = useState(withTime(event?.start_at, '09:00'));
  const [end, setEnd] = useState(withTime(event?.end_at, '10:00'));
  const [location, setLocation] = useState(event?.location ?? '');
  const [notes, setNotes] = useState(event?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [titleTouched, setTitleTouched] = useState(false);
  // The only required-field check used to be an invisible `return` in `submit`, with Speichern
  // still enabled and „Titel *" unmarked: clicking it did nothing at all, not even a busy
  // state, so users concluded the dialog was broken and left via Abbrechen or Escape — losing
  // everything they had typed, rich-text notes included (RTE-10).
  const missingTitle = !title.trim();

  // A stray backdrop click used to discard the whole dialog; it asks first once anything has
  // been entered (TTU-17). Compared against what the dialog opened with, not against defaults.
  const dirty =
    type !== (event?.type ?? eventTypes[0]?.value ?? 'Termin') ||
    title !== (event?.title ?? '') ||
    allDay !== initialAllDay ||
    tbd !== (event ? !event.start_at : false) ||
    start !== withTime(event?.start_at, '09:00') ||
    end !== withTime(event?.end_at, '10:00') ||
    location !== (event?.location ?? '') ||
    notes !== (event?.notes ?? '');

  /** Picking a day while „Mit Uhrzeit" is off keeps whatever time the event already had. */
  const setDay = (set: (v: string) => void, current: string, day: string, fallback: string) =>
    set(day === '' ? '' : `${day}T${current.slice(11) || fallback}`);

  const submit = async () => {
    if (missingTitle) return;
    setBusy(true);
    const payload = {
      artist_id: event ? event.artist_id : (parent.artist_id ?? null),
      project_id: event ? event.project_id : (parent.project_id ?? null),
      type,
      title: title.trim(),
      start_at: tbd ? null : forStorage(start, allDay),
      end_at: tbd ? null : forStorage(end, allDay),
      all_day: allDay ? 1 : 0,
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
          <Btn variant="primary" onClick={submit} disabled={busy || missingTitle}>
            Speichern
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-3">
        <div className="col-span-2 sm:col-span-1">
          <Label>Typ</Label>
          {/* `eventTypes` carries a colour per entry, and EventList renders each event's type
              as a coloured pill from exactly that data. A plain <Select> threw the colour away,
              so a user who colour-codes Auftritt/Probe/Deadline saw those colours everywhere
              except the one screen where they pick a type (RTE-18). */}
          <div>
            <PillSelect value={type} options={eventTypes} onChange={setType} />
          </div>
        </div>
        <div className="col-span-2 flex flex-col justify-end gap-1.5 sm:col-span-1">
          {/* Ticked for a *time*, not against one: the default is all-day, so the box has to
              read as the addition it now is. `all_day` in the DB is untouched — only the
              wording and the checked state are inverted here. */}
          <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={!allDay}
              onChange={(e) => setAllDay(!e.target.checked)}
            />
            Mit Uhrzeit
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={tbd} onChange={(e) => setTbd(e.target.checked)} />
            Datum offen (TBD)
          </label>
        </div>
        <div className="col-span-2">
          <Label>Titel *</Label>
          <TextInput
            value={title}
            invalid={missingTitle && titleTouched}
            onBlur={() => setTitleTouched(true)}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <Label>Beginn</Label>
          <TextInput
            type={allDay ? 'date' : 'datetime-local'}
            value={allDay ? start.slice(0, 10) : start}
            disabled={tbd}
            className="disabled:bg-neutral-100 disabled:text-neutral-400"
            onChange={(e) =>
              allDay ? setDay(setStart, start, e.target.value, '09:00') : setStart(e.target.value)
            }
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <Label>Ende (optional)</Label>
          <TextInput
            type={allDay ? 'date' : 'datetime-local'}
            value={allDay ? end.slice(0, 10) : end}
            disabled={tbd}
            className="disabled:bg-neutral-100 disabled:text-neutral-400"
            onChange={(e) =>
              allDay ? setDay(setEnd, end, e.target.value, '10:00') : setEnd(e.target.value)
            }
          />
        </div>
        <div className="col-span-2">
          <Label>Ort</Label>
          <TextInput value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div className="col-span-2">
          <Label>Notizen</Label>
          <RichTextEditor value={notes} onChange={setNotes} />
        </div>
      </div>
    </Modal>
  );
}
