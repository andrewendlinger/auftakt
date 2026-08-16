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
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { api } from '../api/client';
import { useErrorToast } from '../hooks';
import { withSeasonPin, type ImageAlign } from '../lib/imageRef';
import { INDENT_UNIT, outdentWidth } from '../lib/indent';
import { resizeTextImage } from '../lib/image';
import { markdownExtensions } from '../lib/richtext';
import { getWindowSeason } from '../lib/season';
import { isParsableUrl, normalizeUrl } from '../lib/url';
import { EXTERNAL_LINK_CLASS } from './ui';
import { ImageIcon, IndentIcon, LinkIcon, ListIcon, OutdentIcon, QuoteIcon, SmileIcon, TableIcon, TrashIcon } from './icons';

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
 * `onKeyDown` that runs *before* the editor's own keymap so callers keep Esc-cancel.
 *
 * The editor owns two keys itself (WP-49): Tab/Shift-Tab indent rather than move focus, and ⌘↵
 * blurs and then calls `onSubmit` — with Tab no longer leaving the field, that is how „Speichern"
 * is reached from a notes field without the mouse.
 */
const DEFAULT_CONTENT =
  'w-full min-h-20 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-800 outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-900/5';

const linkTitleKey = new PluginKey<DecorationSet>('rteLinkTitle');

/** Where a click landed inside a box, in CSS px from its top-left border-box corner (WP-56). */
export type CaretPoint = { x: number; y: number };

/**
 * Read the click that is about to open an editor, so the caret can land where it pointed (WP-56).
 *
 * Relative to the reader's own border box rather than in viewport coordinates, because the editor
 * does not mount where the reader stood: its toolbar pushes the first line ~32 px down. Both
 * surfaces put their text at the same offset *inside* their box — that is what the matching border
 * and padding on the reading view are for — so the box corner is the one landmark they share, and
 * `RichTextEditor` translates the point back from the corner it mounts at.
 */
export function caretPointIn(
  el: HTMLElement | null,
  e: { clientX: number; clientY: number },
): CaretPoint | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

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

/**
 * Indent the text blocks the selection touches, or give one unit back.
 *
 * Blocks a container already indents are left alone: a list item nests through `sinkListItem` and
 * a table cell has its own Tab, and adding characters *inside* those would fight the container's
 * own indentation rather than add to it.
 */
function shiftBlocks(editor: Editor, dir: 1 | -1): boolean {
  return editor.commands.command(({ state, tr, dispatch }) => {
    const { from, to } = state.selection;
    const targets: { pos: number; text: string }[] = [];
    state.doc.nodesBetween(from, to, (node, pos, parent) => {
      if (!node.isTextblock) return true;
      const container = parent?.type.name;
      if (container !== 'listItem' && container !== 'tableCell' && container !== 'tableHeader') {
        targets.push({ pos, text: node.textBetween(0, Math.min(node.content.size, INDENT_UNIT.length)) });
      }
      return false; // a textblock's children are text — nothing below it to visit
    });
    const edits = targets
      .map(({ pos, text }) => ({ pos, width: dir === 1 ? 0 : outdentWidth(text) }))
      .filter(({ width }) => dir === 1 || width > 0);
    if (!edits.length) return false;
    if (dispatch) {
      // Back to front: an edit at the top of the document would move every position below it.
      for (const { pos, width } of edits.reverse()) {
        if (dir === 1) tr.insert(pos + 1, state.schema.text(INDENT_UNIT));
        else tr.delete(pos + 1, pos + 1 + width);
      }
    }
    return true;
  });
}

/**
 * Tab: nest a list item where that applies, indent the block where it doesn't (WP-49).
 *
 * The list branch is what `ListItem`'s own keymap does at a higher priority, so the keyboard
 * never reaches this for it — the toolbar does, and „Einrücken" has to mean the same thing as the
 * key it names.
 */
function indent(editor: Editor): boolean {
  return editor.chain().focus().sinkListItem('listItem').run() || shiftBlocks(editor, 1);
}

function outdent(editor: Editor): boolean {
  return editor.chain().focus().liftListItem('listItem').run() || shiftBlocks(editor, -1);
}

/**
 * Tab indents, Shift-Tab outdents, and neither moves focus (WP-49).
 *
 * `priority: 50` — below the default — so `ListItem`'s Tab (nest the item) and `Table`'s Tab (next
 * cell) are tried first and this sees only the keys they left alone. Both handlers return `true`
 * whatever they did: the reported bug is that Tab handed itself to the browser and focus left the
 * note, so „nothing to indent here" has to consume the key too. ⌘↵ is the keyboard way out.
 *
 * Lives here rather than in `lib/richtext.ts` for the same reason `LinkHoverTitle` does: that
 * module is the Markdown dialect, and a keymap is not part of it.
 */
const Indent = Extension.create({
  name: 'rteIndent',
  priority: 50,
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        indent(this.editor);
        return true;
      },
      'Shift-Tab': () => {
        outdent(this.editor);
        return true;
      },
    };
  },
});

export function RichTextEditor({
  value,
  onChange,
  className = DEFAULT_CONTENT,
  autoFocus,
  onBlur,
  onKeyDown,
  onSubmit,
  placeholder,
  compact = false,
  images = false,
  caretAt,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  autoFocus?: boolean;
  /** Commit-on-blur. May be async — the editor fires it once and owns nothing after that, so
   *  the callee has to catch its own failure (see `InlineNotes.commit`). */
  onBlur?: () => void | Promise<void>;
  onKeyDown?: (e: KeyboardEvent) => void;
  /**
   * „Ich bin hier fertig" — ⌘/Strg+↵, after the editor has blurred (WP-49).
   *
   * Enter is a paragraph in here, so a form around the editor cannot save on it, and since Tab
   * now indents instead of moving focus this is the only way to „Speichern" without the mouse.
   * The blur happens either way, so a caller that commits on blur — `InlineNotes`, `CommentCell`
   * — needs nothing else; only the dialogs pass this, to submit as well.
   */
  onSubmit?: () => void;
  placeholder?: string;
  /**
   * Small surface — a table cell, a one-line note in a row. Trims the toolbar to what fits and
   * keeps paragraphs at the compact spacing. Everything else is a document-sized field: full
   * toolbar (headings, tables) and roomy paragraphs. The read-mode `Markdown` on the same
   * surface has to be given the matching `roomy`, or the text reflows the moment it saves.
   */
  compact?: boolean;
  /**
   * Offer „Bild einfügen" (WP-37). **Off by default, and that default is load-bearing.**
   *
   * The bytes go into the season database, so the button only belongs on a surface whose text
   * lives there too. `LandingCards` is the counter-example: its notes are stored in `seasons.json`,
   * which is shared across seasons, so an image inserted there would be written to whichever
   * season happened to be pinned and read as broken from every other one. Forgetting this flag
   * costs a missing button — visible, harmless; defaulting it on would cost that.
   *
   * The *dialect* carries images everywhere regardless (`lib/richtext.ts`), so a note that already
   * holds one still round-trips safely in an editor that offers no button.
   */
  images?: boolean;
  /**
   * Where the click that opened this editor landed, from `caretPointIn` (WP-56). Only meaningful
   * together with `autoFocus`, and only for a caller that mounts the editor *in place of* a
   * reading view: it is read once, at construction, because it describes that one gesture.
   *
   * Left out (or `null`) the editor autofocuses to the end of the text as it always did — which is
   * right for „+ Kommentar", „bearbeiten" and every dialog field, where there was no click on the
   * text to honour.
   */
  caretAt?: CaretPoint | null;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const showError = useErrorToast();
  // Keep the latest callbacks reachable from the editor's (stable) event hooks.
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  const onKeyDownRef = useRef(onKeyDown);
  const onSubmitRef = useRef(onSubmit);
  onChangeRef.current = onChange;
  onBlurRef.current = onBlur;
  onKeyDownRef.current = onKeyDown;
  onSubmitRef.current = onSubmit;
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
  // The click that opened the editor, frozen at construction like everything else `useEditor`
  // reads: it describes this mount, and a later render must not move a caret the user has since
  // put somewhere else.
  const openedAt = useRef(caretAt ?? null);
  // One commit per departure, whichever path notices it first (see the effect below).
  const blurFired = useRef(false);
  /**
   * „Bild einfügen" opens a **native** file panel, and that is not a departure (WP-37).
   *
   * The panel takes focus away from the whole window, so ProseMirror's own `onBlur` fires with
   * `relatedTarget: null` — nothing to test against `rootRef`, so the guard below read it as „the
   * user clicked somewhere else", committed, and `InlineNotes` unmounted the editor while the
   * Finder window was still open. From the user's side: the text field closes behind the dialog,
   * and the image they then pick has nowhere to go. Mounting the `<input>` inside `rootRef`
   * (RTE-02) only covers the DOM events; a window losing focus is not one of them.
   *
   * The flag is cleared by whichever of `change`, `cancel` or the window regaining focus comes
   * first, so a panel dismissed by any route re-arms the ordinary commit-on-blur.
   */
  const pickingImage = useRef(false);
  const fireBlur = () => {
    if (pickingImage.current || blurFired.current || !onBlurRef.current) return;
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
      // `resolveSrc` is display-only: it pins the window's season onto the app's own image URLs
      // so the browser's header-less <img> request reaches the right database. The stored Markdown
      // never sees it — the node's `parseHTML` strips it straight back off.
      ...markdownExtensions({
        linkClass: EXTERNAL_LINK_CLASS,
        resolveSrc: (src) => withSeasonPin(src, getWindowSeason()),
      }),
      Placeholder.configure({ placeholder: () => placeholderRef.current ?? '' }),
      LinkHoverTitle,
      Indent,
    ],
    content: value,
    contentType: 'markdown',
    // „End of the text" only when nothing better is known. With a click to honour we do the
    // focusing ourselves (see the effect below) — TipTap's own autofocus runs from a
    // `setTimeout(0)` in `Editor.mount`, i.e. *after* every effect, and would drag the caret
    // back to the end of the note a tick after it landed where the user clicked (WP-56).
    autofocus: autoFocus && !openedAt.current ? 'end' : false,
    editorProps: {
      attributes: { class: `prose-md ${compact ? '' : 'prose-md--roomy '}rte-content ${className}` },
      // ProseMirror-level: the caller peeks first; if it preventDefaults (Esc) we tell
      // ProseMirror we handled the key so its keymap doesn't also act.
      handleKeyDown: (view, event) => {
        onKeyDownRef.current?.(event);
        if (event.defaultPrevented) return true;
        // ⌘↵ leaves the field: blur first, so a caller that commits on blur has already stored
        // the draft by the time `onSubmit` closes the dialog around it. While an input method is
        // composing, Enter confirms the candidate and means nothing to the form (`onEnterKey`).
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) {
          event.preventDefault();
          view.dom.blur();
          onSubmitRef.current?.();
          return true;
        }
        return false;
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
   * Put the caret where the user clicked (WP-56).
   *
   * There was no click-to-position mapping at all: every in-place editor autofocused to the end of
   * the text, so clicking into the second paragraph of a note opened it with the caret in the last
   * line. `posAtCoords` is the mapping, and it works in viewport coordinates — which is why the
   * *geometry* has to be aligned first and the point arrives box-relative (see `caretPointIn`).
   * Same border, same padding, same width on both surfaces means the text wraps identically, so
   * one translation from the reader's corner to the editor's is the whole correction.
   *
   * A layout effect, so the caret is right in the first painted frame; `TextSelection.near`
   * because a click can resolve to a position between blocks (under a table, beside an image),
   * and a null hit — a click below the last line — falls back to the end, i.e. to the behaviour
   * every editor had before.
   */
  useLayoutEffect(() => {
    const at = openedAt.current;
    // `caretAt` is only meaningful together with `autoFocus` (see the prop's doc): without the
    // guard, a future caller passing a click point alone would get an editor that steals focus
    // on mount — the opposite of what omitting `autoFocus` asks for.
    if (!editor || !at || !autoFocus) return;
    const { view } = editor;
    const box = view.dom.getBoundingClientRect();
    const hit = view.posAtCoords({ left: box.left + at.x, top: box.top + at.y });
    const end = view.state.doc.content.size;
    const pos = hit ? Math.min(Math.max(hit.pos, 0), end) : end;
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))));
    view.focus();
  }, [editor]);

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

  /**
   * Re-arm commit-on-blur when the file panel is dismissed without a file.
   *
   * `change` covers the pick, this covers the cancel — and it is a native listener rather than a
   * React prop because `cancel` on `<input type="file">` is not in React's synthetic event set.
   * Without it the flag above would stay raised for the rest of the editor's life and the note
   * would stop saving on blur, which is a far worse bug than the one it guards.
   */
  useEffect(() => {
    const input = fileRef.current;
    if (!input) return;
    const rearm = () => {
      pickingImage.current = false;
    };
    input.addEventListener('cancel', rearm);
    return () => input.removeEventListener('cancel', rearm);
  }, [images]);

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

  /**
   * Resize, store, insert (WP-37).
   *
   * The upload resolves a tick after the click, and the caller commits on blur — so if focus
   * leaves in between, the note is stored without the image while its row exists: a harmless
   * orphan, but a lost picture. The button disables itself while `uploading` so the ordinary path
   * cannot race, the way `ImageField` does for the avatar.
   *
   * `image/*` matches plenty the browser cannot decode — the iPhone `.heic` of CCL-14 — so both
   * the decode and the upload report through the error toast rather than failing silently.
   */
  const insertImageFile = async (file: File) => {
    setUploading(true);
    try {
      const resized = await resizeTextImage(file);
      const stored = await api.uploadImage({
        data: resized.dataUrl,
        name: file.name,
        width: resized.width,
        height: resized.height,
      });
      // Focus may have left while the upload ran, and `InlineNotes` unmounts the editor on blur —
      // the optional chain does not catch that, because `editor` is then a live reference to a
      // torn-down instance and dispatching into it throws. The catch below would report „konnte
      // nicht gespeichert werden" for bytes the server did store (IMG-03); the row stays as the
      // harmless orphan the comment above describes, and the picture is simply not inserted,
      // which is what the user's own blur asked for.
      if (!editor || editor.isDestroyed) return;
      editor
        .chain()
        .focus()
        // The server's URL, stored verbatim: season-free, so it survives a season copy. A fresh
        // insert starts at „Mittel" — a 1200px plan at full column width shoves everything under
        // it out of view — unless the image is naturally smaller: a width attribute *upscales*,
        // so a 200px logo keeps its own size (null = natural, the „Original" preset).
        .insertContent({
          type: 'image',
          attrs: {
            src: stored.url,
            alt: file.name,
            width: resized.width > IMAGE_WIDTHS.mittel ? IMAGE_WIDTHS.mittel : null,
          },
        })
        .run();
    } catch (err) {
      showError(err, 'Bild konnte nicht gespeichert werden.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div ref={rootRef} className="rte-root">
      {editor && (
        <Toolbar
          editor={editor}
          compact={compact}
          onImage={
            images
              ? () => {
                  // Set *before* the click: the panel opens synchronously and the window's blur
                  // arrives before any of our handlers do.
                  pickingImage.current = true;
                  fileRef.current?.click();
                }
              : undefined
          }
          imageBusy={uploading}
        />
      )}
      {/* Inside `rootRef` on purpose. The blur guard below fires `fireBlur()` on any `focusin` or
          capture-phase `pointerdown` *outside* the root, and opening a file dialog moves focus —
          mounted anywhere else, picking an image would commit the note mid-insert (RTE-02). */}
      {images && (
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            pickingImage.current = false;
            const file = e.target.files?.[0];
            // Cleared before the await, so picking the same file twice in a row still fires.
            e.target.value = '';
            if (file) void insertImageFile(file);
          }}
        />
      )}
      <EditorContent editor={editor} />
      {/* Below the text, not above it: this strip appears and disappears as the caret enters and
          leaves a table, and above the editor that would shove the paragraph being edited up and
          down by a row's height every time. Shown even when `compact`, because a table stored in
          a note can be opened in a cell editor and these are the only controls that can fix it. */}
      {editor && <TableBar editor={editor} />}
      {/* Same reasoning, for a selected image — and not gated on `images`: inserting is limited
          to the season-safe fields, but an image round-trips through every editor, so wherever
          one can legitimately sit it can also be re-sized. */}
      {editor && <ImageBar editor={editor} />}
    </div>
  );
}

// --- toolbar --------------------------------------------------------------------------------

function Toolbar({
  editor,
  compact,
  onImage,
  imageBusy,
}: {
  editor: Editor;
  compact: boolean;
  /** Present only where images belong — see `RichTextEditor`'s `images` prop. */
  onImage?: () => void;
  imageBusy?: boolean;
}) {
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
            <Btn title="Einrücken" onClick={() => indent(editor)}>
              <IndentIcon className="h-4 w-4" />
            </Btn>
            <Btn title="Ausrücken" onClick={() => outdent(editor)}>
              <OutdentIcon className="h-4 w-4" />
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
              <QuoteIcon className="h-4 w-4" />
            </Btn>
            <Btn
              title="Tabelle einfügen"
              onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
            >
              <TableIcon className="h-4 w-4" />
            </Btn>
            {/* Document-sized, so it sits behind the same `compact` gate as tables and headings:
                a one-line task-comment cell is not where a Saalplan goes. */}
            {onImage && (
              <Btn
                title={imageBusy ? 'Bild wird gespeichert…' : 'Bild einfügen'}
                onClick={onImage}
                disabled={imageBusy}
              >
                <ImageIcon className="h-4 w-4" />
              </Btn>
            )}
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
          <SmileIcon className="h-4 w-4" />
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

/**
 * The three widths the size buttons write, in CSS px — stored as `?w=` (lib/imageRef.ts).
 *
 * A doubling scale against the 1200px capture cap (lib/image.ts): „Mittel" is the insert default —
 * about a third of a header note's column, ~10cm on the print sheet, and with >3× the master's
 * pixels in reserve, so „Groß" and „Original" stay sharp on a 2× display. „Original" is the
 * absence of a width: natural size, still bounded by the column and 60vh (`.prose-md img`).
 */
const IMAGE_WIDTHS = { klein: 192, mittel: 384, gross: 768 } as const;

/**
 * Size controls, visible only while an image node is selected — `TableBar`'s pattern exactly,
 * `Btn` included (it cancels `mousedown`; a plain button here would blur the view and fire the
 * caller's commit-on-blur mid-edit, RTE-02). `updateAttributes` is one transaction, so one ⌘Z
 * undoes a re-size, and the width lands in the stored text as `?w=` on serialization.
 */
function ImageBar({ editor }: { editor: Editor }) {
  // `null` = no image selected (hide the bar); inside, `width`/`align` null = the default state.
  const img = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor.isActive('image')
        ? {
            width: (editor.getAttributes('image').width as number | null) ?? null,
            align: (editor.getAttributes('image').align as ImageAlign | null) ?? null,
          }
        : null,
  });
  if (!img) return null;
  // Re-select the node in the same chain: `updateAttributes` replaces it and the NodeSelection
  // does not survive, so without this the bar vanishes on the first click and comparing two
  // sizes means re-selecting the image between every try. Attrs-only, so the position is stable.
  const set = (attrs: { width?: number | null; align?: ImageAlign | null }) => {
    const pos = editor.state.selection.from;
    editor.chain().focus().updateAttributes('image', attrs).setNodeSelection(pos).run();
  };
  // Alignment toggles like the toolbar's marks: clicking the active one returns to text flow.
  const toggleAlign = (align: ImageAlign) => set({ align: img.align === align ? null : align });
  return (
    <div className="mt-1 flex flex-wrap items-center gap-0.5">
      <span className="mr-1 text-[11px] text-neutral-400">Bildgröße</span>
      <Btn title={`Klein (${IMAGE_WIDTHS.klein} px)`} on={img.width === IMAGE_WIDTHS.klein} onClick={() => set({ width: IMAGE_WIDTHS.klein })}>
        <span className="text-[11px] font-semibold">Klein</span>
      </Btn>
      <Btn title={`Mittel (${IMAGE_WIDTHS.mittel} px)`} on={img.width === IMAGE_WIDTHS.mittel} onClick={() => set({ width: IMAGE_WIDTHS.mittel })}>
        <span className="text-[11px] font-semibold">Mittel</span>
      </Btn>
      <Btn title={`Groß (${IMAGE_WIDTHS.gross} px)`} on={img.width === IMAGE_WIDTHS.gross} onClick={() => set({ width: IMAGE_WIDTHS.gross })}>
        <span className="text-[11px] font-semibold">Groß</span>
      </Btn>
      <Sep />
      <Btn title="Originalgröße (an die Spalte angepasst)" on={img.width === null} onClick={() => set({ width: null })}>
        <span className="text-[11px] font-semibold">Original</span>
      </Btn>
      <Sep />
      <span className="mx-1 text-[11px] text-neutral-400">Ausrichtung</span>
      <Btn title="Links, vom Text umflossen (erneut klicken: zurücksetzen)" on={img.align === 'left'} onClick={() => toggleAlign('left')}>
        <span className="text-[11px] font-semibold">Links</span>
      </Btn>
      <Btn title="Zentriert (erneut klicken: zurücksetzen)" on={img.align === 'center'} onClick={() => toggleAlign('center')}>
        <span className="text-[11px] font-semibold">Mitte</span>
      </Btn>
      <Btn title="Rechts, vom Text umflossen (erneut klicken: zurücksetzen)" on={img.align === 'right'} onClick={() => toggleAlign('right')}>
        <span className="text-[11px] font-semibold">Rechts</span>
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
  disabled,
}: {
  title: string;
  on?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** Only „Bild einfügen" uses this today, while its upload is in flight. */
  disabled?: boolean;
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
      disabled={disabled}
      // `min-w-7` rather than `w-7`: the single-glyph buttons stay square, the table strip's
      // word labels get to be as wide as they need.
      className={`flex h-7 min-w-7 items-center justify-center rounded-lg px-1 text-sm transition disabled:opacity-40 ${
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
