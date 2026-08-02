import { Component, type ErrorInfo, type ReactNode } from 'react';

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

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unbehandelter Render-Fehler', error, info.componentStack);
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
