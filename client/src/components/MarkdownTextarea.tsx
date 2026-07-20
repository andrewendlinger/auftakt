import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEventHandler,
  type FocusEvent,
  type FocusEventHandler,
  type KeyboardEvent,
  type KeyboardEventHandler,
} from 'react';
import { LinkIcon, ListIcon } from './icons';

/** Inline markers for the wrap-selection toolbar buttons. */
const MARKERS: Record<'b' | 'i' | 'u', [string, string]> = {
  b: ['**', '**'],
  i: ['*', '*'],
  u: ['<u>', '</u>'],
};

type Action = 'b' | 'i' | 'u' | 'ul';

/** A list line: indent, bullet or number, the space after it, and the content. */
const LIST_LINE = /^(\s*)(?:([-*+])|(\d+)([.)]))(\s+)(.*)$/;

/** A pasted string we should turn into a link rather than drop in as text. */
const BARE_URL = /^(?:https?:\/\/|mailto:)\S+$/i;

/** Auto-grow stops here so one long note can't crowd out the rest of a form. */
const MAX_AUTO_HEIGHT = () => Math.round(window.innerHeight * 0.5);

/**
 * A textarea with a small B / I / U / list / link toolbar that wraps the current selection
 * in Markdown (underline uses <u>, which the Markdown renderer allows). Controlled via
 * `value`/`onChange`; toolbar clicks keep the caret so an onBlur-to-save still works.
 *
 * Beyond the toolbar it does three things a plain textarea doesn't: Enter continues a list,
 * pasting a URL over a selection links it, and the box grows with its content until the
 * user drags it themselves.
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
  const root = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingSel = useRef<[number, number] | null>(null);
  const [link, setLink] = useState<{ text: string; url: string; sel: [number, number] } | null>(null);

  // Restore the selection after a toolbar edit re-renders the (controlled) textarea.
  useLayoutEffect(() => {
    if (pendingSel.current && ref.current) {
      const [s, e] = pendingSel.current;
      ref.current.focus();
      ref.current.setSelectionRange(s, e);
      pendingSel.current = null;
    }
  });

  // --- auto-grow -----------------------------------------------------------------
  // Height we last set ourselves, so the ResizeObserver below can tell our own writes
  // apart from the user dragging the resize handle.
  const autoHeight = useRef<number | null>(null);
  const dragged = useRef(false);

  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta || dragged.current) return;
    ta.style.height = 'auto';
    // scrollHeight excludes the border, but box-sizing is border-box (Tailwind preflight).
    const needed = ta.scrollHeight + (ta.offsetHeight - ta.clientHeight);
    const next = Math.min(needed, MAX_AUTO_HEIGHT());
    ta.style.height = `${next}px`;
    ta.style.overflowY = needed > next ? 'auto' : 'hidden';
    autoHeight.current = next;
  }, [value]);

  // Once the user drags the handle, stop fighting them — otherwise the next keystroke
  // snaps the box back and the handle looks broken.
  useEffect(() => {
    const ta = ref.current;
    if (!ta || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (dragged.current || !ta.offsetHeight) return;
      // Nothing measured yet, or the height is the one we set: not a drag.
      if (autoHeight.current === null) return;
      if (Math.abs(ta.offsetHeight - autoHeight.current) <= 1) return;
      dragged.current = true;
      ta.style.overflowY = 'auto';
    });
    ro.observe(ta);
    return () => ro.disconnect();
  }, []);

  // --- editing helpers -----------------------------------------------------------
  /** Replace [from,to) with `text` and leave the caret where `caret` says (default: after). */
  const splice = (from: number, to: number, text: string, caret?: [number, number]) => {
    onChange(value.slice(0, from) + text + value.slice(to));
    pendingSel.current = caret ?? [from + text.length, from + text.length];
  };

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
      splice(lineStart, e, prefixed, [lineStart, lineStart + prefixed.length]);
    } else {
      const [before, after] = MARKERS[action];
      splice(s, e, before + value.slice(s, e) + after, [s + before.length, e + before.length]);
    }
  };

  const openLink = () => {
    const ta = ref.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    const selected = value.slice(s, e);
    // A multi-line selection can't be link text, so don't pretend it is.
    setLink({ text: selected.includes('\n') ? '' : selected, url: '', sel: [s, e] });
  };

  const closeLink = () => {
    if (link) pendingSel.current = link.sel;
    setLink(null);
  };

  const insertLink = () => {
    if (!link) return;
    const url = link.url.trim();
    if (!url) return;
    const text = link.text.trim() || url;
    const [s, e] = link.sel;
    const md = `[${text}](${url})`;
    onChange(value.slice(0, s) + md + value.slice(e));
    pendingSel.current = [s + md.length, s + md.length];
    setLink(null);
  };

  /** Enter inside a list item continues the list; on an empty item it ends it. */
  const continueList = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = ref.current;
    if (!ta) return false;
    const { selectionStart: s, selectionEnd: end } = ta;
    if (s !== end) return false;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const nl = value.indexOf('\n', s);
    const lineEnd = nl === -1 ? value.length : nl;
    const m = LIST_LINE.exec(value.slice(lineStart, lineEnd));
    if (!m) return false;
    // `bullet` and `num`/`delim` are alternatives — exactly one of them matched.
    const [, indent = '', bullet, num, delim = '.', gap = ' ', content = ''] = m;
    e.preventDefault();
    if (content.trim() === '') {
      // Empty item: drop the marker and leave a blank line to keep typing on.
      splice(lineStart, lineEnd, '');
    } else {
      const marker = bullet ?? `${Number(num) + 1}${delim}`;
      splice(s, s, `\n${indent}${marker}${gap}`);
    }
    return true;
  };

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    // The caller's handler wins (Esc to cancel, ⌘↵ to save) — neither collides with Enter.
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) continueList(e);
  };

  const handlePaste: ClipboardEventHandler<HTMLTextAreaElement> = (e) => {
    const ta = ref.current;
    if (!ta) return;
    const pasted = e.clipboardData.getData('text/plain').trim();
    if (!BARE_URL.test(pasted)) return;
    const { selectionStart: s, selectionEnd: end } = ta;
    const selected = value.slice(s, end);
    if (!selected || selected.includes('\n')) return;
    e.preventDefault();
    splice(s, end, `[${selected}](${pasted})`);
  };

  // Focus moving into our own toolbar or link bar is not "left the editor" — without this,
  // the callers that save on blur (InlineNotes, the task comment cell) would commit and
  // unmount us the moment the link bar takes focus.
  const handleBlur = (e: FocusEvent<HTMLTextAreaElement>) => {
    if (root.current?.contains(e.relatedTarget as Node | null)) return;
    onBlur?.(e);
  };

  return (
    <div ref={root}>
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
        <ToolbarButton title="Link einfügen" onClick={openLink}>
          <LinkIcon className="h-4 w-4" />
        </ToolbarButton>
        {hint && <span className="ml-1 text-[11px] text-neutral-400">Markdown</span>}
      </div>

      {link && (
        <LinkBar
          text={link.text}
          url={link.url}
          onText={(text) => setLink({ ...link, text })}
          onUrl={(url) => setLink({ ...link, url })}
          onInsert={insertLink}
          onCancel={closeLink}
        />
      )}

      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={className}
        autoFocus={autoFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={placeholder}
      />
    </div>
  );
}

/**
 * The "insert link" fields. Deliberately an inline row rather than a floating popover:
 * a popover would be clipped by the edit dialog's scrolling body, and it would have to
 * float over an editor that saves on blur.
 */
function LinkBar({
  text,
  url,
  onText,
  onUrl,
  onInsert,
  onCancel,
}: {
  text: string;
  url: string;
  onText: (v: string) => void;
  onUrl: (v: string) => void;
  onInsert: () => void;
  onCancel: () => void;
}) {
  const field =
    'min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-800 outline-none transition focus:border-neutral-500';

  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    // Modal listens for Escape on window — without stopPropagation, closing the link bar
    // would close the whole dialog.
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      onInsert();
    }
  };

  return (
    <div className="mb-1 flex flex-wrap items-center gap-1 rounded-lg bg-neutral-100 p-1.5">
      <input
        autoFocus={!text}
        value={text}
        onChange={(e) => onText(e.target.value)}
        onKeyDown={keys}
        placeholder="Text"
        aria-label="Link-Text"
        className={field}
      />
      <input
        autoFocus={!!text}
        value={url}
        onChange={(e) => onUrl(e.target.value)}
        onKeyDown={keys}
        placeholder="https://…"
        aria-label="Link-Adresse"
        className={`${field} flex-[2]`}
      />
      {/* Keep focus off the buttons so the textarea's blur-to-save never fires mid-insert. */}
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onInsert}
        disabled={!url.trim()}
        className="rounded-md bg-neutral-800 px-2 py-1 text-xs font-medium text-white transition hover:bg-neutral-700 disabled:opacity-40"
      >
        Einfügen
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onCancel}
        className="rounded-md px-2 py-1 text-xs text-neutral-500 transition hover:text-neutral-800"
      >
        Abbrechen
      </button>
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
