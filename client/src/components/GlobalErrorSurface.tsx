import { useEffect } from 'react';
import { reportError, setErrorReporter } from '../lib/errors';
import { useToast } from './Toast';

/**
 * The catch-all error surface: renders nothing, wires the two places an error can appear with
 * nobody watching to the toast.
 *
 * There was no `unhandledrejection` listener and no QueryCache `onError` anywhere in the
 * client, so a rejected promise nobody caught — a `void`-invoked handler, a background refetch
 * — surfaced only in the dev console. In the packaged app there is no console to look at.
 *
 * This is the last resort, not the first: a write reports through `useGuardedAction`, and a
 * failed first load is the page's own story (it renders an `ErrorState`). Hence the
 * `data !== undefined` test below.
 */
export function GlobalErrorSurface() {
  const toast = useToast();

  useEffect(() => {
    setErrorReporter((message) => toast.show({ message }));
    const onRejection = (e: PromiseRejectionEvent) =>
      reportError(e.reason, 'Ein Fehler ist aufgetreten.');
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      setErrorReporter(null);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [toast]);

  return null;
}
