import { Component, type ErrorInfo, type ReactNode } from 'react';
import { signalFailed } from '../boot';
import { errorParts, logAppEvent } from '../lib/logEvent';

/**
 * How the 3000 characters `electron/appLog.ts` keeps of a `stack` field are shared between the
 * error's own trace and React's component stack.
 *
 * The two travel as one field and the cap keeps the *front* — so whichever half is first can
 * evict the other, and the error's trace comes first. Both halves are therefore budgeted: a
 * minified production stack of long asset URLs alone can exceed 3000 characters, and uncut it
 * would push the entire component stack off the end. The error's first frames name the throw;
 * the component stack's first dozen elements say where in the tree it sat — the tail of either
 * is the part that may be lost.
 */
const STACK_FIELD_MAX = 3000; // mirrors APP_LOG_FIELD_CAPS.stack, grep-coupled like external.ts
const COMPONENT_STACK_MAX = 1500;
const ERROR_STACK_MAX = STACK_FIELD_MAX - COMPONENT_STACK_MAX;

interface State {
  failed: boolean;
}

/**
 * Catches render-time exceptions so a single bad row can't take the app down.
 *
 * Without it React unmounts the *entire* tree on any throw during render, which in the browser
 * looks like a blank page and in the packaged Electron window is unrecoverable: the renderer
 * has no address bar and no reload affordance, so the only way out is quitting and relaunching
 * — and the same data throws again on the next launch (CCL-08). Reachable through malformed
 * column options or a bad `custom_values` blob (CCL-07), among others.
 *
 * Still a class: React has no hook equivalent of `getDerivedStateFromError`.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  // `unknown`, not the declared `Error`: React hands over the raw thrown value, so a render
  // that throws `null` reaches this with nothing to dereference — and a throw *here* runs
  // during commit, past the boundary, tearing down the very fallback below.
  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Unbehandelter Render-Fehler', error, info.componentStack);
    // …and into the runtime log, which is the only one of the two a packaged app keeps: the
    // window it prints to has no console anybody can open (WP-69e).
    const { msg, stack } = errorParts(error);
    logAppEvent(
      'render-error',
      msg,
      (stack ?? '').slice(0, ERROR_STACK_MAX) +
        (info.componentStack ?? '').slice(0, COMPONENT_STACK_MAX),
    );
    // The fallback below is the app now; there is nothing further to wait for. Without
    // this the boot screen would hold its still frame over a rendered error message
    // until the data budget expired. `signalFailed` rather than `signalReady` so it
    // reveals that message straight away instead of celebrating over it first.
    signalFailed();
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex min-h-full items-center justify-center p-8">
        <div className="max-w-md rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-black/5">
          <h1 className="text-lg font-semibold text-neutral-800">Da ist etwas schiefgelaufen</h1>
          <p className="mt-2 text-sm text-neutral-500">
            Die Seite konnte nicht angezeigt werden. Deine Daten sind nicht betroffen — ein Neuladen
            behebt das meistens.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-700"
            >
              Neu laden
            </button>
            {/* Not a <Link>: if the throw came from the current route, staying in the SPA would
                re-render it straight back into this boundary. Reload onto the start page. */}
            <button
              type="button"
              onClick={() => {
                window.location.hash = '#/';
                window.location.reload();
              }}
              className="rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-200"
            >
              Zur Startseite
            </button>
          </div>
        </div>
      </div>
    );
  }
}
