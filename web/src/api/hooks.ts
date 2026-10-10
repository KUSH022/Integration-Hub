import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './client';

/** Loads data from the API with loading/error state and an explicit reload. */
export function useApi<T>(loader: (signal: AbortSignal) => Promise<T>, deps: unknown[], opts: { pollMs?: number; enabled?: boolean } = {}) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | Error | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const enabled = opts.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    setLoading((prev) => (data === undefined ? true : prev));
    loaderRef
      .current(ctrl.signal)
      .then((d) => {
        setData(d);
        setError(undefined);
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled]);

  useEffect(() => {
    if (!opts.pollMs || !enabled) return;
    const id = setInterval(reload, opts.pollMs);
    return () => clearInterval(id);
  }, [opts.pollMs, reload, enabled]);

  return { data, error, loading, reload, setData };
}
