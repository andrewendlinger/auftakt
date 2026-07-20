import { useLayoutEffect, useRef, type FocusEventHandler, type KeyboardEventHandler } from 'react';
import { ListIcon } from './icons';

/** Inline markers for the wrap-selection toolbar buttons. */
const MARKERS: Record<'b' | 'i' | 'u', [string, string]> = {
  b: ['**', '**'],
  i: ['*', '*'],
  u: ['<u>', '</u>'],
};

type Action = 'b' | 'i' | 'u' | 'ul';

/**
 * A textarea with a small B / I / U / list toolbar that wraps the current selection
 * in Markdown (underline uses <u>, which the Markdown renderer allows). Controlled via
 * `value`/`onChange`; toolbar clicks keep the caret so an onBlur-to-save still works.
 */
const DEFAULT_TEXTAREA =
  'w-full min-h-20 resize-y rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-800 outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-900/5';

export function MarkdownTextarea({
  value,
  onChange,
  className = DEFAULT_TEXTAREA,
  autoFocus,
  onBlur,
  onKeyDown,
  placeholder,
  hint = true,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  autoFocus?: boolean;
  onBlur?: FocusEventHandler<HTMLTextAreaElement>;
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  placeholder?: string;
  hint?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingSel = useRef<[number, number] | null>(null);

  // Restore the selection after a toolbar edit re-renders the (controlled) textarea.
  useLayoutEffect(() => {
    if (pendingSel.current && ref.current) {
      const [s, e] = pendingSel.current;
      ref.current.focus();
      ref.current.setSelectionRange(s, e);
      pendingSel.current = null;
    }
  });

  const apply = (action: Action) => {
    const ta = ref.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    if (action === 'ul') {
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const block = value.slice(lineStart, e);
      const prefixed = block
        .split('\n')
        .map((l) => (l.startsWith('- ') ? l : `- ${l}`))
        .join('\n');
      onChange(value.slice(0, lineStart) + prefixed + value.slice(e));
      pendingSel.current = [lineStart, lineStart + prefixed.length];
    } else {
      const [before, after] = MARKERS[action];
      const selected = value.slice(s, e);
      onChange(value.slice(0, s) + before + selected + after + value.slice(e));
      pendingSel.current = [s + before.length, e + before.length];
    }
  };

  return (
    <div>
      <div className="mb-1 flex items-center gap-0.5">
        <ToolbarButton title="Fett" onClick={() => apply('b')}>
          <span className="font-bold">B</span>
        </ToolbarButton>
        <ToolbarButton title="Kursiv" onClick={() => apply('i')}>
          <span className="italic">I</span>
        </ToolbarButton>
        <ToolbarButton title="Unterstrichen" onClick={() => apply('u')}>
          <span className="underline">U</span>
        </ToolbarButton>
        <ToolbarButton title="Liste" onClick={() => apply('ul')}>
          <ListIcon className="h-4 w-4" />
        </ToolbarButton>
        {hint && <span className="ml-1 text-[11px] text-neutral-400">Markdown</span>}
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={className}
        autoFocus={autoFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
      />
    </div>
  );
}

function ToolbarButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      // Prevent the textarea from blurring (which would commit/close the editor) on click.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-lg text-sm text-neutral-600 transition hover:bg-neutral-200"
    >
      {children}
    </button>
  );
}
