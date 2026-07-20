import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Btn, IconButton } from './ui';
import { MarkdownTextarea } from './MarkdownTextarea';
import { resizeToDataUrl } from '../lib/image';

const MODAL_WIDTH = { md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-3xl' } as const;

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
      <div
        className={`w-full ${width} rounded-2xl bg-white text-neutral-800 shadow-xl`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-3">
          <h3 className="font-semibold text-neutral-800">{title}</h3>
          <IconButton onClick={onClose} title="Schließen" aria-label="Schließen" className="-mr-1">
            ✕
          </IconButton>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-neutral-100 px-5 py-3">{footer}</div>
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
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await resizeToDataUrl(file));
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

export interface FieldDef {
  name: string;
  label: string;
  type?: FieldType;
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  placeholder?: string;
  span2?: boolean;
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
              <MarkdownTextarea
                value={vals[f.name] ?? ''}
                onChange={(v) => set(f.name, v)}
                placeholder={f.placeholder}
                className={`${inputCls} min-h-20 resize-y`}
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
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={vals[f.name] || '#888888'}
                  onChange={(e) => set(f.name, e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border border-neutral-300"
                />
                <TextInput value={vals[f.name]} onChange={(e) => set(f.name, e.target.value)} placeholder="#RRGGBB" />
              </div>
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
