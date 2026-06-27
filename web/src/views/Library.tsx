import { useEffect, useState } from 'preact/hooks';
import { api } from '../api';
import { Chrome } from '../components/Chrome';
import { Link } from '../router';
import { PosterCard } from '../components/PosterCard';
import type { BrowseResult } from '../types';

interface Props {
  source: string;
  libraryId?: string;
}

export function Library({ source, libraryId }: Props) {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ok'; data: BrowseResult }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' });

  useEffect(() => {
    setState({ kind: 'loading' });
    api.library(source, libraryId).then(
      (data) => setState({ kind: 'ok', data }),
      (e: Error) => setState({ kind: 'error', message: e.message }),
    );
  }, [source, libraryId]);

  return (
    <Chrome>
      <div style={{ padding: 20 }}>
        {state.kind === 'ok' && (
          <div style={{ marginBottom: 16, color: 'var(--muted)' }}>
            {state.data.breadcrumbs.map((b, i) => (
              <span key={i}>
                {b.libraryId
                  ? <Link to={`/lib/${source}/${b.libraryId}`}>{b.name}</Link>
                  : <Link to={`/lib/${source}`}>{b.name}</Link>}
                {i < state.data.breadcrumbs.length - 1 ? ' › ' : null}
              </span>
            ))}
          </div>
        )}
        {state.kind === 'loading' && <p class="muted">Loading…</p>}
        {state.kind === 'error' && <p style={{ color: 'var(--danger)' }}>Error: {state.message}</p>}
        {state.kind === 'ok' && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, 180px)',
            gap: 20,
          }}>
            {state.data.items.map((it) => (
              <PosterCard key={it.id} item={it} source={source} />
            ))}
          </div>
        )}
      </div>
    </Chrome>
  );
}
