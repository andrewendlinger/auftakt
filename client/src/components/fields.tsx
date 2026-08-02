import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Btn, IconButton } from './ui';
import { RichTextEditor } from './RichTextEditor';
import { resizeToDataUrl } from '../lib/image';
import { useErrorToast } from '../hooks';

// Viewport-relative, not a fixed rem cap: on a large window the old max-w-2xl left every
// entity dialog at 42rem no matter how much room there was. The upper bounds stop form
// fields drifting uncomfortably far from their labels on a very wide monitor.
const MODAL_WIDTH = {
  md: 'w-[min(34rem,92vw)]',
  lg: 'w-[min(64rem,92vw)]',
  xl: 'w-[min(76rem,92vw)]',
} as const;

export function Modal({
  title,
  children,
  onClose,
  footer,
  wide,
  size,
}: {
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  /** Deprecated shorthand for size="xl". */
  wide?: boolean;
  /** Modal max-width: md (default), lg, or xl. */
  size?: keyof typeof MODAL_WIDTH;
}) {
  const width = MODAL_WIDTH[size ?? (wide ? 'xl' : 'md')];
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4 py-10"
      onMouseDown={onClose}
    >
      {/* Column layout with a scrolling body: height used to be unbounded and the *overlay*
          scrolled, which pushed a long form's own footer off-screen. py-10 above = 5rem. */}
      <div
        className={`${width} flex max-h-[calc(100vh-5rem)] flex-col rounded-2xl bg-white text-neutral-800 shadow-xl`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-neutral-100 px-5 py-3">
          <h3 className="font-semibold text-neutral-800">{title}</h3>
          <IconButton onClick={onClose} title="Schließen" aria-label="Schließen" className="-mr-1">
            ✕
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-neutral-100 px-5 py-3">
            {footer}
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

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ''}`} />;
}

export function Select({
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select {...props} className={`${inputCls} ${props.className ?? ''}`}>
      {children}
    </select>
  );
}

export type FieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'color'
  | 'date'
  | 'number'
  | 'email'
  | 'tel'
  | 'image';

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
  options?: Array<{ value: string; label: string }>;
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
  const [vals, setVals] = useState<Values>(() => {
    const src = initial as Record<string, unknown> | undefined;
    const v: Values = {};
    for (const f of fields) {
      const raw = src?.[f.name];
      v[f.name] = raw == null ? '' : String(raw);
    }
    return v;
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string, val: string) => setVals((s) => ({ ...s, [k]: val }));

  const submit = async () => {
    for (const f of fields) {
      if (f.required && !vals[f.name]?.trim()) return;
    }
    setBusy(true);
    const out: Record<string, string | null> = {};
    for (const f of fields) {
      const v = vals[f.name] ?? '';
      out[f.name] = v.trim() === '' ? null : v;
    }
    try {
      await onSubmit(out);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Btn onClick={onClose}>Abbrechen</Btn>
          <Btn variant="primary" onClick={submit} disabled={busy}>
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
              <Select value={vals[f.name]} onChange={(e) => set(f.name, e.target.value)}>
                <option value="">—</option>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
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
