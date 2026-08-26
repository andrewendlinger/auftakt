import { Component, type ErrorInfo, type ReactNode } from 'react';
import { signalFailed } from '../boot';
import { errorParts, logAppEvent } from '../lib/logEvent';

/**
 * How much of React's component stack rides along with the error's own.
 *
 * The two travel as one `stack` field, and `electron/appLog.ts` caps that field at 3000
 * characters *from the front* — so an uncut component stack, which is one line per element down
 * to the root, would push the trace naming the actual throw off the end. The error's stack is
 * the part a bug is found from; the component stack says where in the tree it sat, which the
 * first dozen frames already answer.
 */
const COMPONENT_STACK_MAX = 1500;

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
      (stack ?? '') + (info.componentStack ?? '').slice(0, COMPONENT_STACK_MAX),
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
