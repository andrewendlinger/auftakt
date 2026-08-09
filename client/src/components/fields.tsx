import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Btn, IconButton } from './ui';
import { RichTextEditor } from './RichTextEditor';
import { contrastText } from '../lib/colors';
import { resizeToDataUrl } from '../lib/image';
import { useErrorToast, useGuardedAction } from '../hooks';

// Viewport-relative, not a fixed rem cap: on a large window the old max-w-2xl left every
// entity dialog at 42rem no matter how much room there was. The upper bounds stop form
// fields drifting uncomfortably far from their labels on a very wide monitor.
const MODAL_WIDTH = {
  md: 'w-[min(34rem,92vw)]',
  lg: 'w-[min(64rem,92vw)]',
  xl: 'w-[min(76rem,92vw)]',
} as const;

/**
 * Nesting depth of the `Modal` a subtree sits in — 0 outside any dialog.
 *
 * Escape used to close *every* open Modal at once: each one registered its own unconditional
 * `window` listener, so dismissing `ColumnEditModal` also tore down „Spalten verwalten"
 * underneath it and threw away the option edits (TTU-16). Only the topmost layer may act, and
 * depth is how we identify it — deliberately *not* a mount-order stack, because React runs
 * effects child-first and would register a nested dialog before its own parent.
 */
const ModalDepthCtx = createContext(0);

/** Depth of every mounted Modal, keyed by instance token. Read at keydown time, not render. */
const openModals = new Map<object, number>();

export function Modal({
  title,
  children,
  onClose,
  footer,
  wide,
  size,
  dirty = false,
}: {
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  /** Deprecated shorthand for size="xl". */
  wide?: boolean;
  /** Modal max-width: md (default), lg, or xl. */
  size?: keyof typeof MODAL_WIDTH;
  /** The form holds unsaved input: the *accidental* exits (backdrop, Escape) confirm first. */
  dirty?: boolean;
}) {
  const width = MODAL_WIDTH[size ?? (wide ? 'xl' : 'md')];
  const depth = useContext(ModalDepthCtx) + 1;
  const [confirming, setConfirming] = useState(false);
  // mousedown and mouseup must *both* land on the backdrop. A drag that starts on the dialog's
  // own text and ends outside it is a text selection, not a dismissal (TTU-17).
  const downOnBackdrop = useRef(false);
  // Read from the (stable) window listener, so it never needs to re-register on a keystroke.
  const dirtyRef = useRef(dirty);
  const confirmingRef = useRef(confirming);
  dirtyRef.current = dirty;
  confirmingRef.current = confirming;

  useEffect(() => {
    const token = {};
    openModals.set(token, depth);
    return () => {
      openModals.delete(token);
    };
  }, [depth]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // A layer that handled the key for itself (RichTextEditor's link bar and emoji picker)
      // marks it; anything below the topmost dialog stays out of the way entirely.
      let top = 0;
      for (const d of openModals.values()) top = Math.max(top, d);
      if (depth !== top) return;
      if (confirmingRef.current) setConfirming(false); // Escape backs out of the question.
      else if (dirtyRef.current) setConfirming(true);
      else onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, depth]);

  const requestClose = () => {
    if (dirty) setConfirming(true);
    else onClose();
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4 py-10"
      onMouseDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) requestClose();
        downOnBackdrop.current = false;
      }}
    >
      {/* Column layout with a scrolling body: height used to be unbounded and the *overlay*
          scrolled, which pushed a long form's own footer off-screen. py-10 above = 5rem. */}
      <div
        className={`relative ${width} flex max-h-[calc(100vh-5rem)] flex-col rounded-2xl bg-white text-neutral-800 shadow-xl`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-neutral-100 px-5 py-3">
          <h3 className="font-semibold text-neutral-800">{title}</h3>
          {/* ✕ and the footer's Abbrechen are deliberate exits and never confirm. */}
          <IconButton onClick={onClose} title="Schließen" aria-label="Schließen" className="-mr-1">
            ✕
          </IconButton>
        </div>
        <ModalDepthCtx.Provider value={depth}>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </ModalDepthCtx.Provider>
        {footer && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-neutral-100 px-5 py-3">
            {footer}
          </div>
        )}
        {confirming && (
          // Inside the dialog rather than as a nested `Modal`: it must not register a depth of
          // its own, and the form underneath has to stay visible while the user decides.
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-white/80 p-4">
            <div className="w-full max-w-sm rounded-xl bg-white p-4 text-sm shadow-lg ring-1 ring-black/10">
              <p className="text-neutral-700">Änderungen verwerfen?</p>
              <p className="mt-1 text-xs text-neutral-500">
                Die eingegebenen Daten gehen verloren.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <Btn onClick={() => setConfirming(false)}>Weiter bearbeiten</Btn>
                <Btn variant="danger" onClick={onClose}>
                  Verwerfen
                </Btn>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1 block text-xs font-medium text-neutral-500">{children}</label>;
}

const inputCls =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-800 outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-900/5';

// Swapped in rather than appended: two `border-*` utilities on one element are resolved by
// stylesheet order, not by the order they appear in the class attribute.
const invalidInputCls = inputCls.replace('border-neutral-300', 'border-red-400');

type Invalidatable = { invalid?: boolean };

export function TextInput({
  invalid,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & Invalidatable) {
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      className={`${invalid ? invalidInputCls : inputCls} ${props.className ?? ''}`}
    />
  );
}

/**
 * „Enter saves" for a single-line input: `onKeyDown={onEnterKey(submit)}`.
 *
 * Per input, never on the dialog or the grid around it — a `RichTextEditor` reads Enter as a
 * paragraph, and `PillSelect`/`PillsField` re-implement the keyboard contract of the `<select>`
 * they replaced, Enter included (RTE-11). Neither may see it.
 *
 * **Never on `type="date"` or `type="time"`.** A native picker reports `value === ''` for
 * anything it considers incomplete, so Enter pressed halfway through typing a date submits the
 * empty string, not the digits on screen — in the event dialog that wrote „Datum offen" over a
 * stored date and dropped both clock times (WP-40).
 */
export function onEnterKey(run: () => void) {
  return (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    run();
  };
}

export function Select({
  children,
  invalid,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & Invalidatable & { children: ReactNode }) {
  return (
    <select
      {...props}
      aria-invalid={invalid || undefined}
      className={`${invalid ? invalidInputCls : inputCls} ${props.className ?? ''}`}
    >
      {children}
    </select>
  );
}

export type FieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'pills'
  | 'color'
  | 'date'
  | 'number'
  | 'email'
  | 'tel'
  | 'image';

/**
 * `type: 'pills'` — a one-click alternative to `'select'` for a short, coloured option list.
 * A `<select>` (and `PillSelect`, which is a popover too) costs two clicks to set a value and
 * throws the option's colour away on the way; a row of pills is one click and shows the palette
 * the list is grouped by. Clicking the selected pill again clears the field, which is why the
 * option list needs no "—" entry.
 *
 * Only worth it while the list is short enough to scan — a long one wants the popover back.
 */
function PillsField({
  value,
  options,
  onChange,
}: {
  value: string;
  options: NonNullable<FieldDef['options']>;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 pt-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            title={on ? `„${o.label}" entfernen` : `„${o.label}" wählen`}
            onClick={() => onChange(on ? '' : o.value)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
              on ? 'ring-2 ring-neutral-800' : 'text-neutral-600 ring-1 ring-neutral-300 hover:ring-neutral-500'
            }`}
            style={on && o.color ? { background: o.color, color: contrastText(o.color) } : undefined}
          >
            {/* The swatch carries the colour while the pill is unselected, so the fill can stay
                reserved for "this one is set" — two pastel fills apart is not a legible state. */}
            {!on && (
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: o.color ?? '#e5e5e5' }} />
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** File picker that stores a resized data URL, with a round preview + clear button. */
function ImageField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const report = useErrorToast();
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await resizeToDataUrl(file));
    } catch (err) {
      // `accept="image/*"` matches plenty the browser cannot decode — an iPhone .heic above
      // all. Without this the promise rejected, the avatar stayed the 🎭 placeholder, and the
      // only trace was the dev console: to the user the picker just did nothing (CCL-14).
      report(err, 'Bild konnte nicht gelesen werden.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };
  return (
    <div className="flex items-center gap-3">
      {value ? (
        <img src={value} alt="" className="h-14 w-14 rounded-full object-cover ring-1 ring-black/10" />
      ) : (
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-100 text-xl text-neutral-300">
          🎭
        </div>
      )}
      <div className="flex flex-col items-start gap-1">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
        <Btn variant="subtle" type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? 'Wird verarbeitet…' : value ? 'Bild ändern' : 'Bild wählen'}
        </Btn>
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-xs text-neutral-400 transition hover:text-red-600"
          >
            Entfernen
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Colour input for `type: 'color'`. When the field is empty but the entity still renders a
 * colour (a project inherits a shade of its artist's colour), `fallback` is that effective
 * colour — previewing it keeps the swatch honest, and the dashed border plus hint separate
 * "inherits" from "explicitly set". Without a `fallback` this behaves as it always did.
 */
function ColorField({
  value,
  onChange,
  fallback,
  hint,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  fallback?: string;
  hint?: string;
  placeholder?: string;
}) {
  const inherited = !value && !!fallback;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || fallback || '#888888'}
          onChange={(e) => onChange(e.target.value)}
          className={`h-9 w-12 cursor-pointer rounded border ${
            inherited ? 'border-dashed border-neutral-400' : 'border-neutral-300'
          }`}
        />
        <TextInput
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={(inherited ? fallback : null) ?? placeholder ?? '#RRGGBB'}
        />
      </div>
      {inherited && hint && <p className="text-xs text-neutral-400">{hint}</p>}
      {!inherited && fallback && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="self-start text-xs text-neutral-400 transition hover:text-neutral-700"
        >
          Zurücksetzen
        </button>
      )}
    </div>
  );
}

export interface FieldDef {
  name: string;
  label: string;
  type?: FieldType;
  /** `color` is read by `type: 'pills'` only; `'select'` has no way to render it. */
  options?: Array<{ value: string; label: string; color?: string }>;
  required?: boolean;
  placeholder?: string;
  span2?: boolean;
  /** For `type: 'color'`: the colour that actually renders when the field is left empty.
   *  Previewed as a dashed "inherited" swatch instead of a hardcoded grey. Omit when an
   *  empty value really does mean "no colour" (contacts, links) or when the column is
   *  NOT NULL and the DB default is the grey we already show (artists). */
  fallback?: string;
  /** Sentence shown under an inherited colour field, explaining where the colour comes from. */
  fallbackHint?: string;
}

type Values = Record<string, string>;

/** Generic create/edit modal driven by field definitions. Values are strings; '' → null on submit. */
export function RecordFormModal({
  title,
  fields,
  initial,
  submitLabel = 'Speichern',
  onSubmit,
  onClose,
}: {
  title: ReactNode;
  fields: FieldDef[];
  initial?: object;
  submitLabel?: string;
  onSubmit: (values: Record<string, string | null>) => void | Promise<void>;
  onClose: () => void;
}) {
  const initialVals = useMemo(() => {
    const src = initial as Record<string, unknown> | undefined;
    const v: Values = {};
    for (const f of fields) {
      const raw = src?.[f.name];
      v[f.name] = raw == null ? '' : String(raw);
    }
    return v;
  }, [fields, initial]);
  const [vals, setVals] = useState<Values>(initialVals);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const guard = useGuardedAction();
  const set = (k: string, val: string) => setVals((s) => ({ ...s, [k]: val }));
  // Compared by content, not identity: several call sites build `fields` per render.
  const dirty = fields.some((f) => (vals[f.name] ?? '') !== (initialVals[f.name] ?? ''));
  // `submit` used to bail on these before any state change, so a user who left Bezeichnung or
  // Name blank clicked Speichern over and over with nothing happening at all (TTU-27). The
  // button now says so, and a required field the user has visited and left empty is marked.
  const missing = fields.filter((f) => f.required && !vals[f.name]?.trim());

  const submit = async () => {
    if (missing.length) return;
    setBusy(true);
    const out: Record<string, string | null> = {};
    for (const f of fields) {
      const v = vals[f.name] ?? '';
      out[f.name] = v.trim() === '' ? null : v;
    }
    try {
      if (await guard(`${submitLabel} fehlgeschlagen.`, () => Promise.resolve(onSubmit(out)))) {
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };
  const invalid = (f: FieldDef) => !!f.required && !vals[f.name]?.trim() && !!touched[f.name];
  const markTouched = (name: string) => setTouched((t) => ({ ...t, [name]: true }));

  return (
    <Modal
      title={title}
      onClose={onClose}
      size="lg"
      dirty={dirty}
      footer={
        <>
          {missing.length > 0 && (
            <p className="mr-auto self-center text-xs text-neutral-500">
              Bitte ausfüllen: {missing.map((f) => f.label).join(', ')}
            </p>
          )}
          <Btn onClick={onClose}>Abbrechen</Btn>
          <Btn variant="primary" onClick={submit} disabled={busy || missing.length > 0}>
            {submitLabel}
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-3">
        {fields.map((f) => (
          <div
            key={f.name}
            className={
              f.span2 || f.type === 'textarea' || f.type === 'image' ? 'col-span-2' : 'col-span-2 sm:col-span-1'
            }
          >
            <Label>
              {f.label}
              {f.required && <span className="text-red-400"> *</span>}
            </Label>
            {f.type === 'image' ? (
              <ImageField value={vals[f.name] ?? ''} onChange={(v) => set(f.name, v)} />
            ) : f.type === 'textarea' ? (
              <RichTextEditor
                value={vals[f.name] ?? ''}
                onChange={(v) => set(f.name, v)}
                placeholder={f.placeholder}
                className={`${inputCls} min-h-40`}
              />
            ) : f.type === 'select' ? (
              <Select
                value={vals[f.name]}
                invalid={invalid(f)}
                onBlur={() => markTouched(f.name)}
                onChange={(e) => set(f.name, e.target.value)}
              >
                <option value="">—</option>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : f.type === 'pills' ? (
              <PillsField
                value={vals[f.name] ?? ''}
                options={f.options ?? []}
                onChange={(v) => set(f.name, v)}
              />
            ) : f.type === 'color' ? (
              <ColorField
                value={vals[f.name] ?? ''}
                onChange={(v) => set(f.name, v)}
                fallback={f.fallback}
                hint={f.fallbackHint}
                placeholder={f.placeholder}
              />
            ) : (
              <TextInput
                type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text'}
                value={vals[f.name]}
                invalid={invalid(f)}
                onBlur={() => markTouched(f.name)}
                // Every entity dialog gets the event dialog's Enter-to-save, from one place —
                // except on a `date` field, where a half-typed value reads as empty.
                onKeyDown={f.type === 'date' ? undefined : onEnterKey(submit)}
                onChange={(e) => set(f.name, e.target.value)}
                placeholder={f.placeholder}
              />
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
