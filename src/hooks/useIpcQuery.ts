// Genel sorgu hook'u — IPC cagrisini loading/error/data state'ine baglar.
//
// Hafif (TanStack Query yok): IPC yerel+hizli, ince renderer. `deps` degisince
// yeniden cagrilir; eski-cagri yarisini `active` bayragiyla yutar (stale yanit yok).

import { useCallback, useEffect, useState, type DependencyList } from "react";

export interface QueryResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useIpcQuery<T>(
  fetcher: () => Promise<T>,
  deps: DependencyList,
): QueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetcher()
      .then((result) => {
        if (active) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (active) {
          setError(String(e));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
    // fetcher kasten deps disinda: cagri tetikleyicisi `deps` + manuel `tick`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, loading, error, refetch };
}
