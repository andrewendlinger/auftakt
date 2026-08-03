import { useRef, useState } from 'react';
import { useCommitOnUnmount, useGuardedAction } from '../hooks';

/**
 * What an empty commit means. The three answers are all deliberate and all in use, which is
 * why this is a parameter rather than a default: four copies of this input had drifted into
 * three different behaviours with nothing naming the difference (RTE-17).
 *
 * - `ignore` — an empty value is a no-op (`EditableText`: a heading may not lose its name).
 * - `clear`  — commits `null` (`EditableFallbackText`: clearing restores the automatic text).
 * - `raw`    — commits `''` verbatim (`EditableLabel`, the task table's text cells: the
 *              consumer turns an empty string back into its own default).
 */
export type EmptyPolicy = 'ignore' | 'clear' | 'raw';

interface Base {
  /** The committed value: the draft's seed, the Escape target and the changed-or-not baseline. */
  value: string;
  /** Leave edit mode. Called when the write lands, on Escape, and on an unchanged commit. */
  onDone: () => void;
  className?: string;
  title?: string;
  placeholder?: string;
  /** German, names what failed: „Der Titel konnte nicht gespeichert werden." */
  errorMessage?: string;
  /** Keep the click off a clickable ancestor — headings sit inside clickable cards. */
  stopClicks?: boolean;
}

type Props =
  | (Base & { empty?: 'ignore' | 'raw'; onCommit: (v: string) => void | Promise<void> })
  | (Base & { empty: 'clear'; onCommit: (v: string | null) => void | Promise<void> });

/**
 * The click-to-edit input behind `EditableText`, `EditableFallbackText`, `EditableLabel` and
 * the task table's text cells: autofocus, a local draft, commit-if-changed on blur, Enter to
 * commit, Escape to cancel.
 *
 * Only the *input* is shared. The four display shells around it differ materially — pencil
 * versus click-anywhere trigger, truncation, a fallback placeholder, a wrapper that stays
 * mounted — and folding those together would be a different, worse component.
 *
 * Three things it gets right that the copies did not, in one place instead of four:
 * Escape `stopPropagation`s so it can be used inside a `Modal` without closing it; a rejected
 * write is reported and keeps the draft open (RTE-01); and an unmount mid-edit still commits
 * (TTU-38), which only the task table's copy did.
 */
export function InlineInput(props: Props) {
  const { value, onDone, className = '', title, placeholder, errorMessage, stopClicks } = props;
  const empty: EmptyPolicy = props.empty ?? 'ignore';
  const [text, setText] = useState(value);
  const guard = useGuardedAction();
  // Blur → commit → the shell unmounts us, and the unmount path must not write a second time.
  // Reset on failure so a retry (or the unmount) can still get the text out.
  const settled = useRef(false);

  /** The value to write, or `undefined` when there is nothing to commit. */
  const pending = (): string | null | undefined => {
    if (empty === 'raw') return text === value ? undefined : text;
    const trimmed = text.trim();
    if (empty === 'clear') {
      const next = trimmed === '' ? null : text;
      return next === (value.trim() === '' ? null : value) ? undefined : next;
    }
    return trimmed === '' || trimmed === value ? undefined : trimmed;
  };

  const write = async (next: string | null) => {
    const call = props.empty === 'clear' ? props.onCommit(next) : props.onCommit(next as string);
    return guard(errorMessage ?? 'Die Änderung konnte nicht gespeichert werden.', () =>
      Promise.resolve(call),
    );
  };

  const commit = async () => {
    if (settled.current) return;
    settled.current = true;
    const next = pending();
    if (next === undefined) {
      onDone();
      return;
    }
    if (await write(next)) onDone();
    else settled.current = false;
  };

  const cancel = () => {
    settled.current = true;
    setText(value);
    onDone();
  };

  /**
   * The unmount arm writes but never calls `onDone`.
   *
   * Leaving edit mode is the *parent's* state, and by the time we are unmounting it has either
   * changed already or is about to go away with us — but under StrictMode the mount-time
   * cleanup runs while the editor is still very much open, and an `onDone()` there closed the
   * input the instant it appeared. Restricting this arm to the write keeps it inert whenever
   * there is nothing to save, which is exactly the state a spurious cleanup finds.
   */
  useCommitOnUnmount(true, () => {
    if (settled.current) return;
    const next = pending();
    if (next === undefined) return;
    settled.current = true;
    void write(next);
  });

  return (
    <input
      autoFocus
      className={className}
      value={text}
      title={title}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onClick={stopClicks ? (e) => e.stopPropagation() : undefined}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === 'Escape') {
          // A `Modal` listens for Escape on window; without this, cancelling an inline rename
          // inside a dialog would close the dialog too.
          e.preventDefault();
          e.stopPropagation();
          cancel();
        }
      }}
    />
  );
}
