import { useState } from 'react';
import { Label, Modal, Select, TextInput } from './fields';
import { MarkdownTextarea } from './MarkdownTextarea';
import { Btn } from './ui';
import { api } from '../api/client';
import type { CustomColumnOption, EventItem } from '../api/types';
import { useInvalidateAll, useUndoablePatch } from '../hooks';

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
  const [type, setType] = useState(event?.type ?? eventTypes[0]?.value ?? 'Termin');
  const [title, setTitle] = useState(event?.title ?? '');
  const [allDay, setAllDay] = useState<boolean>(!!event?.all_day);
  const [start, setStart] = useState(event?.start_at ?? '');
  const [end, setEnd] = useState(event?.end_at ?? '');
  const [location, setLocation] = useState(event?.location ?? '');
  const [notes, setNotes] = useState(event?.notes ?? '');
  const [busy, setBusy] = useState(false);

  const toggleAllDay = (v: boolean) => {
    setAllDay(v);
    setStart((s) => (v ? s.slice(0, 10) : s.length === 10 ? `${s}T09:00` : s));
    setEnd((e) => (!e ? e : v ? e.slice(0, 10) : e.length === 10 ? `${e}T10:00` : e));
  };

  const submit = async () => {
    if (!title.trim() || !start.trim()) return;
    setBusy(true);
    const payload = {
      artist_id: event ? event.artist_id : (parent.artist_id ?? null),
      project_id: event ? event.project_id : (parent.project_id ?? null),
      type,
      title: title.trim(),
      start_at: start,
      end_at: end.trim() === '' ? null : end,
      all_day: allDay ? 1 : 0,
      location: location.trim() === '' ? null : location,
      notes: notes.trim() === '' ? null : notes,
    };
    try {
      if (event) {
        await undoablePatch({ res: api.events, row: event, patch: payload, label: 'Änderung am Termin' });
      } else {
        await api.events.create(payload);
        await invalidate();
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={event ? 'Termin bearbeiten' : 'Neuer Termin'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Btn onClick={onClose}>Abbrechen</Btn>
          <Btn variant="primary" onClick={submit} disabled={busy}>
            Speichern
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-3">
        <div className="col-span-2 sm:col-span-1">
          <Label>Typ</Label>
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {eventTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="col-span-2 flex items-end sm:col-span-1">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={allDay} onChange={(e) => toggleAllDay(e.target.checked)} />
            Ganztägig / mehrtägig (ohne Uhrzeit)
          </label>
        </div>
        <div className="col-span-2">
          <Label>Titel *</Label>
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <Label>Beginn *</Label>
          <TextInput
            type={allDay ? 'date' : 'datetime-local'}
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <Label>Ende (optional)</Label>
          <TextInput
            type={allDay ? 'date' : 'datetime-local'}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <Label>Ort</Label>
          <TextInput value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div className="col-span-2">
          <Label>Notizen</Label>
          <MarkdownTextarea value={notes} onChange={setNotes} />
        </div>
      </div>
    </Modal>
  );
}
