import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../api';
import { Chrome } from '../components/Chrome';
import { PosterCard } from '../components/PosterCard';
import type { Item } from '../types';

export function SearchView() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<(Item & { source: string })[]>([]);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (q.trim().length < 2) { setResults([]); return; }
    debounce.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        const { hits } = await api.search(q.trim());
        setResults(hits);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [q]);

  return (
    <Chrome>
      <div style={{ padding: 20 }}>
        <input
          type="search"
          placeholder="Search…"
          value={q}
          onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
          autoFocus
          style={{ fontSize: 18, padding: 14 }}
        />
        {loading && <p class="muted" style={{ marginTop: 16 }}>Searching…</p>}
        {!loading && results.length === 0 && q.trim().length >= 2 && (
          <p class="muted" style={{ marginTop: 16 }}>No results.</p>
        )}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, 180px)',
          gap: 20, marginTop: 20,
        }}>
          {results.map((it) => (
            <PosterCard key={`${it.source}:${it.id}`} item={it} source={it.source} />
          ))}
        </div>
      </div>
    </Chrome>
  );
}
