/**
 * SourcesContext — app-level cache of the server's source list.
 *
 * Wraps `api.listSources()` in a React context so every view gets the same
 * data without redundant fetches. Refreshes on mount, on window focus, and
 * whenever a caller invokes `refresh()` after a mutation (pair, delete, grant).
 */

import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { api } from '../api';

export interface ApiSource {
  id: number;
  type: 'plex' | 'flixify' | 'youtube';
  baseUrl: string;
  label: string;
  pairedByUserId: number | null;
  createdAt: number;
  /** Admin-only: list of userId values that have explicit grants to this source. */
  usersWithAccess?: number[];
}

/** The key used across the app for source maps: String(source.id). */
export type SourceKey = string;

export interface SourcesContextValue {
  /** Sources as a keyed record (String(id) → ApiSource). */
  sources: Record<SourceKey, ApiSource>;
  /** Ordered array — same data, convenient for rendering lists. */
  sourceList: ApiSource[];
  loading: boolean;
  error: string | null;
  /** Call after any mutation to re-fetch from the server. */
  refresh: () => Promise<void>;
}

const SourcesContext = createContext<SourcesContextValue>({
  sources: {},
  sourceList: [],
  loading: false,
  error: null,
  refresh: () => Promise.resolve(),
});

export function SourcesProvider({ children }: { children: ReactNode }) {
  const [sourceList, setSourceList] = useState<ApiSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchRef = useRef(0);

  const fetchSources = useCallback(async () => {
    const seq = ++fetchRef.current;
    setLoading(true);
    try {
      const list = await api.listSources();
      if (fetchRef.current !== seq) return; // stale
      setSourceList(list);
      setError(null);
    } catch (e) {
      if (fetchRef.current !== seq) return;
      setError((e as Error).message);
    } finally {
      if (fetchRef.current === seq) setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => { void fetchSources(); }, [fetchSources]);

  // Refetch on window focus (e.g. user switches back from phone-pair tab)
  useEffect(() => {
    const onFocus = () => { void fetchSources(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchSources]);

  const sources: Record<SourceKey, ApiSource> = {};
  for (const s of sourceList) sources[String(s.id)] = s;

  return (
    <SourcesContext.Provider value={{ sources, sourceList, loading, error, refresh: fetchSources }}>
      {children}
    </SourcesContext.Provider>
  );
}

export function useSources(): SourcesContextValue {
  return useContext(SourcesContext);
}
