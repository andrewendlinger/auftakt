import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useEditor, EditorContent, useEditorState, type Editor } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import { Placeholder } from '@tiptap/extensions';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { markdownExtensions } from '../lib/richtext';
import { isParsableUrl, normalizeUrl } from '../lib/url';
import { EXTERNAL_LINK_CLASS } from './ui';
import { LinkIcon, ListIcon, TrashIcon } from './icons';

// Loaded on demand so the emoji dataset stays out of the main bundle.
const EmojiPickerLazy = lazy(() => import('./EmojiPickerLazy'));

/**
 * WYSIWYG replacement for the old `MarkdownTextarea`. Users see formatted text, never raw
 * `**syntax**`; the value in/out is still a **Markdown string** so `Markdown.tsx`, both PDF
 * routes and all stored content are untouched (WP-Q). Round-trip fidelity to that renderer is
 * pinned in `../lib/richtext.ts` and guarded by `npm run check:markdown`.
 *
 * Drop-in for the four call sites: same `value`/`onChange` (Markdown), an `onBlur` that fires
 * once when focus truly leaves (toolbar / link bar / emoji picker don't count), and an
 * `onKeyDown` that runs *before* the editor's own keymap so callers keep Esc-cancel / ⌘↵-save.
 */
const DEFAULT_CONTENT =
  'w-full min-h-20 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-800 outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-900/5';

const linkTitleKey = new PluginKey<DecorationSet>('rteLinkTitle');

/**
 * Hover a link while editing and see where it actually goes (WP-29d).
 *
 * A **decoration**, not a rendered `title=` attribute, and that distinction is the whole point:
 * the link mark has a real `title` in its schema with the default `parseHTML`, so an attribute
 * would be read back on any HTML re-parse — copy a link, paste it, and the note now stores
 * `[text](href "href")`. Decorations never enter the document and never reach the clipboard,
 * which serializes from the doc rather than from the rendered DOM.
 *
 * Lives here rather than in `lib/richtext.ts`, which is deliberately free of DOM-only
 * extensions so the headless round-trip check exercises exactly what the app serializes.
 */
const LinkHoverTitle = Extension.create({
  name: 'rteLinkTitle',
  addProseMirrorPlugins() {
    const build = (doc: PMNode) => {
      const decos: Decoration[] = [];
      doc.descendants((node, pos) => {
        if (!node.isText) return;
        const href = node.marks.find((m) => m.type.name === 'link')?.attrs.href;
        if (href) decos.push(Decoration.inline(pos, pos + node.nodeSize, { title: href }));
      });
      return DecorationSet.create(doc, decos);
    };
    return [
      new Plugin({
        key: linkTitleKey,
        // Rebuilt only when the document actually changed — moving the caret must not walk the
        // whole doc on every keystroke's selection update.
        state: {
          init: (_, state) => build(state.doc),
          apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
        },
        props: { decorations: (state) => linkTitleKey.getState(state) },
      }),
    ];
  },
});

export function RichTextEditor({
  value,
  onChange,
  className = DEFAULT_CONTENT,
  autoFocus,
  onBlur,
  onKeyDown,
  placeholder,
  compact = false,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  autoFocus?: boolean;
  /** Commit-on-blur. May be async — the editor fires it once and owns nothing after that, so
   *  the callee has to catch its own failure (see `InlineNotes.commit`). */
  onBlur?: () => void | Promise<void>;
  onKeyDown?: (e: KeyboardEvent) => void;
  placeholder?: string;
  /**
   * Small surface — a table cell, a one-line note in a row. Trims the toolbar to what fits and
   * keeps paragraphs at the compact spacing. Everything else is a document-sized field: full
   * toolbar (headings, tables) and roomy paragraphs. The read-mode `Markdown` on the same
   * surface has to be given the matching `roomy`, or the text reflows the moment it saves.
   */
  compact?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  // Keep the latest callbacks reachable from the editor's (stable) event hooks.
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  const onKeyDownRef = useRef(onKeyDown);
  onChangeRef.current = onChange;
  onBlurRef.current = onBlur;
  onKeyDownRef.current = onKeyDown;
  // The last Markdown we emitted, so an echoed `value` prop doesn't reset the doc mid-typing.
  const lastEmitted = useRef(value);
  // Suppress the blur that TipTap fires while destroying the view on unmount. A plain textarea
  // never blurred on removal, so callers that commit on blur (InlineNotes, CommentCell) relied
  // on that: Esc sets `editing=false` to *cancel*, and the unmount must not commit the draft.
  // This layout-effect cleanup runs before useEditor's own (destroy) cleanup.
  const alive = useRef(true);
  // `useEditor` defaults its deps to `[]`, so anything baked into an extension's `configure`
  // is frozen at construction. Reading the placeholder through a ref keeps it a real prop
  // without re-creating the editor, which a deps array would do on every className change
  // (RTE-19). `setOptions` is no help here: it never rebuilds the extension manager.
  const placeholderRef = useRef(placeholder);
  placeholderRef.current = placeholder;
  // One commit per departure, whichever path notices it first (see the effect below).
  const blurFired = useRef(false);
  const fireBlur = () => {
    if (blurFired.current || !onBlurRef.current) return;
    blurFired.current = true;
    void onBlurRef.current();
  };
  useLayoutEffect(() => {
    // Re-arm on (re)mount — StrictMode runs setup→cleanup→setup, so a cleanup-only ref would
    // stay stuck `false` and silently swallow every real blur-commit.
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const editor = useEditor({
    extensions: [
      ...markdownExtensions({ linkClass: EXTERNAL_LINK_CLASS }),
      Placeholder.configure({ placeholder: () => placeholderRef.current ?? '' }),
      LinkHoverTitle,
    ],
    content: value,
    contentType: 'markdown',
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: { class: `prose-md ${compact ? '' : 'prose-md--roomy '}rte-content ${className}` },
      // ProseMirror-level: the caller peeks first; if it preventDefaults (Esc, ⌘↵) we tell
      // ProseMirror we handled the key so its keymap doesn't also act.
      handleKeyDown: (_view, event) => {
        onKeyDownRef.current?.(event);
        return event.defaultPrevented;
      },
    },
    onUpdate: ({ editor }) => {
      const md = editor.getMarkdown();
      lastEmitted.current = md;
      onChangeRef.current(md);
    },
    // Focus moving into our own toolbar / link bar / emoji picker is not "left the editor",
    // and neither is the view being torn down on unmount (see `alive`).
    onBlur: ({ event }) => {
      if (!alive.current) return;
      if (rootRef.current?.contains(event.relatedTarget as Node | null)) return;
      fireBlur();
    },
  });

  /**
   * Commit-on-blur fallback for the case ProseMirror cannot see.
   *
   * The editor's own `onBlur` only fires on the view, and focus moving into the link bar or
   * the emoji picker is deliberately skipped (both live inside `rootRef`). Once focus sat on
   * the link field or the picker's autofocused search input, clicking anywhere else moved
   * focus off *that* element, not off the view — so `onBlur` never fired again, the caller's
   * save was silently dropped and the typed note died with the next navigation (RTE-02).
   *
   * `focusin` catches focus landing outside us; the capture-phase `pointerdown` catches a
   * click on something unfocusable, which moves no focus at all. `blurFired` keeps the two of
   * them and ProseMirror's own blur to a single commit, and re-arms when focus comes back.
   */
  useEffect(() => {
    const outside = (target: EventTarget | null) =>
      !!rootRef.current && !rootRef.current.contains(target as Node | null);
    const onFocusIn = (e: FocusEvent) => {
      if (outside(e.target)) fireBlur();
      else blurFired.current = false;
    };
    const onPointerDown = (e: Event) => {
      if (outside(e.target)) fireBlur();
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
    // Reads only refs, so it registers once and never needs to re-bind.
  }, []);

  // The placeholder decoration is only recomputed when the editor state moves, so nudge it
  // when the prop changes; without this the ref above would be read once and never again.
  useEffect(() => {
    if (!editor) return;
    editor.view.dispatch(editor.state.tr);
  }, [placeholder, editor]);

  // Reflect an *external* value change (undo, a form reset) without clobbering the caret on
  // our own echo. Skip when the incoming Markdown already matches what we emitted or hold.
  useEffect(() => {
    if (!editor) return;
    if (value === lastEmitted.current) return;
    if (value === editor.getMarkdown()) return;
    lastEmitted.current = value;
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
  }, [value, editor]);

  return (
    <div ref={rootRef} className="rte-root">
      {editor && <Toolbar editor={editor} compact={compact} />}
      <EditorContent editor={editor} />
      {/* Below the text, not above it: this strip appears and disappears as the caret enters and
          leaves a table, and above the editor that would shove the paragraph being edited up and
          down by a row's height every time. Shown even when `compact`, because a table stored in
          a note can be opened in a cell editor and these are the only controls that can fix it. */}
      {editor && <TableBar editor={editor} />}
    </div>
  );
}

// --- toolbar --------------------------------------------------------------------------------

function Toolbar({ editor, compact }: { editor: Editor; compact: boolean }) {
  // `origin` is the text the bar opened with, so `insertLink` can tell "only the address
  // changed" from "the label changed". Note `setLink` here is this state setter, *not* TipTap's
  // command of the same name — the editor commands are reached through `chain()`.
  const [link, setLink] = useState<{
    text: string;
    url: string;
    origin: string;
    existing: boolean;
  } | null>(null);
  const [emoji, setEmoji] = useState(false);

  // Re-render the toolbar on selection/content change so active states stay in sync.
  const active = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      underline: editor.isActive('underline'),
      bullet: editor.isActive('bulletList'),
      ordered: editor.isActive('orderedList'),
      h1: editor.isActive('heading', { level: 1 }),
      h2: editor.isActive('heading', { level: 2 }),
      h3: editor.isActive('heading', { level: 3 }),
      quote: editor.isActive('blockquote'),
      link: editor.isActive('link'),
    }),
  });

  const chain = () => editor.chain().focus();

  /**
   * Open the bar on the link the caret is already in, not next to it.
   *
   * It used to seed `url: ''` unconditionally and never read the existing `href`, so clicking
   * the button inside a link offered an empty field and „Einfügen" appended a *second* link
   * beside the first — existing links were effectively uneditable (WP-29c). Extending the
   * selection over the whole mark first is what makes editing and inserting the same path:
   * both then act on a selection that is exactly the link.
   */
  const openLink = () => {
    setEmoji(false);
    if (editor.isActive('link')) chain().extendMarkRange('link').run();
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to, ' ');
    const href = (editor.getAttributes('link').href as string | undefined) ?? '';
    const text = selected.includes('\n') ? '' : selected;
    setLink({ text, url: href, origin: text, existing: !!href });
  };
  const insertLink = () => {
    if (!link) return;
    // Stored verbatim, a schemeless `www.beispiel.de` survives the markdown sanitizer, renders
    // as a normal link, and then alerts „nicht unterstütztes Format" on every click because
    // `new URL()` cannot parse it. Normalise before it is written, not on read (RTE-09).
    if (!isParsableUrl(link.url)) return;
    const url = normalizeUrl(link.url);
    const text = link.text.trim() || url;
    if (text !== '' && text === link.origin) {
      // Label untouched — re-mark the range instead of replacing it, so anything *inside* the
      // link survives a change of address. `insertContent` writes one flat text node, which
      // silently drops the bold in `[**fett**](…)` (and did the same to a bold word you
      // selected before pressing the link button). `title: null` because `setMark` merges over
      // the existing attributes, and a stored `[t](u "Titel")` would otherwise keep a title
      // that no longer belongs to the new address.
      chain().setMark('link', { href: url, title: null }).run();
    } else {
      chain()
        .insertContent({ type: 'text', text, marks: [{ type: 'link', attrs: { href: url } }] })
        .run();
    }
    setLink(null);
  };
  /** `unsetLink` extends an empty selection over the mark itself, so a caret inside is enough. */
  const removeLink = () => {
    chain().unsetLink().run();
    setLink(null);
  };

  const insertEmoji = (ch: string) => {
    chain().insertContent(ch).run();
    setEmoji(false);
  };
  /**
   * Dismiss an overlay and put the caret back — `chain()` focuses before it runs.
   *
   * `insertLink`/`insertEmoji` always did this; the *cancel* paths did not, so closing the
   * link bar or toggling the picker shut left focus on `document.body` and the editor unable
   * to re-arm its blur-commit until the user clicked back into the text (RTE-02).
   */
  const closeEmoji = () => {
    setEmoji(false);
    chain().run();
  };
  const closeLink = () => {
    setLink(null);
    chain().run();
  };

  return (
    <div className="mb-1">
      <div className="flex flex-wrap items-center gap-0.5">
        <Btn title="Fett" on={active?.bold} onClick={() => chain().toggleBold().run()}>
          <span className="font-bold">B</span>
        </Btn>
        <Btn title="Kursiv" on={active?.italic} onClick={() => chain().toggleItalic().run()}>
          <span className="italic">I</span>
        </Btn>
        <Btn title="Unterstrichen" on={active?.underline} onClick={() => chain().toggleUnderline().run()}>
          <span className="underline">U</span>
        </Btn>
        <Sep />
        <Btn title="Aufzählung" on={active?.bullet} onClick={() => chain().toggleBulletList().run()}>
          <ListIcon className="h-4 w-4" />
        </Btn>
        {!compact && (
          <>
            <Btn title="Nummerierte Liste" on={active?.ordered} onClick={() => chain().toggleOrderedList().run()}>
              <span className="text-[11px] font-semibold">1.</span>
            </Btn>
            <Btn title="Einrücken" onClick={() => chain().sinkListItem('listItem').run()}>
              <span className="text-sm">⇥</span>
            </Btn>
            <Btn title="Ausrücken" onClick={() => chain().liftListItem('listItem').run()}>
              <span className="text-sm">⇤</span>
            </Btn>
          </>
        )}
        <Btn title={active?.link ? 'Link bearbeiten' : 'Link einfügen'} on={active?.link} onClick={openLink}>
          <LinkIcon className="h-4 w-4" />
        </Btn>
        {!compact && (
          <>
            <Sep />
            <Btn title="Überschrift 1" on={active?.h1} onClick={() => chain().toggleHeading({ level: 1 }).run()}>
              <span className="text-[11px] font-semibold">H1</span>
            </Btn>
            <Btn title="Überschrift 2" on={active?.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()}>
              <span className="text-[11px] font-semibold">H2</span>
            </Btn>
            <Btn title="Überschrift 3" on={active?.h3} onClick={() => chain().toggleHeading({ level: 3 }).run()}>
              <span className="text-[11px] font-semibold">H3</span>
            </Btn>
            <Btn title="Zitat" on={active?.quote} onClick={() => chain().toggleBlockquote().run()}>
              <span className="text-sm">❝</span>
            </Btn>
            <Btn
              title="Tabelle einfügen"
              onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
            >
              <span className="text-sm">▦</span>
            </Btn>
          </>
        )}
        <Sep />
        <Btn
          title="Emoji"
          on={emoji}
          onClick={() => {
            setLink(null);
            if (emoji) closeEmoji();
            else setEmoji(true);
          }}
        >
          <span className="text-sm">🙂</span>
        </Btn>
      </div>

      {link && (
        <LinkBar
          text={link.text}
          url={link.url}
          onText={(text) => setLink({ ...link, text })}
          onUrl={(url) => setLink({ ...link, url })}
          onInsert={insertLink}
          onCancel={closeLink}
          onRemove={link.existing ? removeLink : undefined}
        />
      )}

      {emoji && (
        // Inside rootRef so the blur guard treats picker focus as "still in the editor", and
        // absolutely positioned so WP-K's scrolling dialog body doesn't reflow around it.
        <div className="relative">
          <div
            className="absolute left-0 z-50 mt-1"
            // Keeps the caret in the editor while the user clicks around the picker — except
            // on its search field, which cannot be focused at all if the default is cancelled
            // anywhere along the dispatch (RTE-15). Scoped to `input` on purpose: letting the
            // emoji buttons take focus would open a blur-commit path that does not exist today.
            onMouseDown={(e) => {
              if (!(e.target as HTMLElement).closest('input')) e.preventDefault();
            }}
            // The same guard LinkBar has. emoji-picker-react autofocuses its own search input,
            // so the key never reaches the editor's `handleKeyDown` (and therefore never
            // reaches a caller `onKeyDown`); it bubbled straight to Modal's window listener,
            // which closed the whole „Neuer Termin" dialog and discarded every field (RTE-05).
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              e.preventDefault();
              e.stopPropagation();
              closeEmoji();
            }}
          >
            <Suspense fallback={<div className="rounded-lg bg-neutral-100 p-3 text-xs text-neutral-400">Emoji lädt…</div>}>
              <EmojiPickerLazy onPick={insertEmoji} />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Row and column controls, visible only while the caret sits in a table.
 *
 * Its own `useEditorState` rather than a `table:` entry in the main toolbar's selector, so
 * entering a table re-renders this strip and not the whole button row. The buttons are `Btn`s
 * for one load-bearing reason: `Btn` cancels `mousedown`, and without that a click here blurs
 * the view and fires the caller's commit-on-blur mid-edit (RTE-02).
 */
function TableBar({ editor }: { editor: Editor }) {
  const inTable = useEditorState({ editor, selector: ({ editor }) => editor.isActive('table') });
  if (!inTable) return null;
  const chain = () => editor.chain().focus();
  return (
    <div className="mt-1 flex flex-wrap items-center gap-0.5">
      <span className="mr-1 text-[11px] text-neutral-400">Tabelle</span>
      <Btn title="Zeile darunter einfügen" onClick={() => chain().addRowAfter().run()}>
        <span className="text-[11px] font-semibold">Zeile +</span>
      </Btn>
      <Btn title="Zeile löschen" onClick={() => chain().deleteRow().run()}>
        <span className="text-[11px] font-semibold">Zeile −</span>
      </Btn>
      <Sep />
      <Btn title="Spalte rechts einfügen" onClick={() => chain().addColumnAfter().run()}>
        <span className="text-[11px] font-semibold">Spalte +</span>
      </Btn>
      <Btn title="Spalte löschen" onClick={() => chain().deleteColumn().run()}>
        <span className="text-[11px] font-semibold">Spalte −</span>
      </Btn>
      <Sep />
      <Btn title="Tabelle löschen" onClick={() => chain().deleteTable().run()}>
        <TrashIcon className="h-4 w-4" />
      </Btn>
    </div>
  );
}

function Sep() {
  return <span className="mx-0.5 h-4 w-px bg-neutral-200" aria-hidden />;
}

function Btn({
  title,
  on,
  onClick,
  children,
}: {
  title: string;
  on?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={on}
      // Out of the tab order: Tab through „Neuer Termin" used to stop at every one of these
      // (B, I, U, list, link, headings, table, emoji — a dozen in the roomy toolbar) between the
      // Typ field and the Notizen text itself, so reaching the field you were tabbing towards
      // meant pressing Tab a dozen more times. The buttons stay clickable, and the formatting
      // that has a keyboard route keeps it — ⌘B/⌘I/⌘U are the editor's own shortcuts, handled
      // inside the text where the caret already is.
      tabIndex={-1}
      // Keep focus in the editor so an onBlur-to-save never fires on a toolbar click.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      // `min-w-7` rather than `w-7`: the single-glyph buttons stay square, the table strip's
      // word labels get to be as wide as they need.
      className={`flex h-7 min-w-7 items-center justify-center rounded-lg px-1 text-sm transition ${
        on ? 'bg-neutral-800 text-white' : 'text-neutral-600 hover:bg-neutral-200'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The "insert link" fields — an inline row rather than a floating popover, for the same
 * reasons as the old editor: a popover would be clipped by the edit dialog's scrolling body
 * and would float over an editor that saves on blur.
 */
function LinkBar({
  text,
  url,
  onText,
  onUrl,
  onInsert,
  onCancel,
  onRemove,
}: {
  text: string;
  url: string;
  onText: (v: string) => void;
  onUrl: (v: string) => void;
  onInsert: () => void;
  onCancel: () => void;
  /** Only passed when the bar opened on an existing link — otherwise there is nothing to strip. */
  onRemove?: () => void;
}) {
  const field =
    'min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-800 outline-none transition focus:border-neutral-500';
  // Immediate feedback beats a bad save the user only discovers days later, on a link that
  // looked fine when they created it.
  const usable = isParsableUrl(url);
  const badUrl = url.trim() !== '' && !usable;
  // Swapped, not appended: two `border-*` utilities are resolved by stylesheet order.
  const urlField = badUrl ? field.replace('border-neutral-300', 'border-red-400') : field;

  const keys = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    // Modal listens for Escape on window — stopPropagation so closing the link bar doesn't
    // close the whole dialog.
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
    <div className="mt-1 flex flex-wrap items-center gap-1 rounded-lg bg-neutral-100 p-1.5">
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
        aria-invalid={badUrl}
        className={`${urlField} flex-[2]`}
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onInsert}
        disabled={!usable}
        className="rounded-md bg-neutral-800 px-2 py-1 text-xs font-medium text-white transition hover:bg-neutral-700 disabled:opacity-40"
      >
        Einfügen
      </button>
      {onRemove && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onRemove}
          className="rounded-md px-2 py-1 text-xs text-neutral-500 transition hover:text-red-600"
        >
          Entfernen
        </button>
      )}
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
