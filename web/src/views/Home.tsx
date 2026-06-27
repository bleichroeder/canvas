import { useEffect, useState } from 'preact/hooks';
import { api } from '../api';
import { getSources } from '../storage';
import { Chrome } from '../components/Chrome';
import { Rail } from '../components/Rail';
import { Link } from '../router';
import type { HomeRow, Item } from '../types';

interface PerSourceError { source: string; status: number; message: string }

type State =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'ok'; rows: (HomeRow & { source: string })[]; errors: PerSourceError[] }
  | { kind: 'error'; message: string };

export function Home() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const sources = getSources();
    if (Object.keys(sources).length === 0) {
      setState({ kind: 'empty' });
      return;
    }
    api.home().then(
      ({ rows, errors }) => setState({ kind: 'ok', rows, errors }),
      (e: Error) => setState({ kind: 'error', message: e.message }),
    );
  }, []);

  return (
    <Chrome>
      <div style={{ padding: '20px 0' }}>
        {state.kind === 'loading' && <p style={{ padding: '0 20px' }} class="muted">Loading…</p>}
        {state.kind === 'empty' && (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <p style={{ fontSize: 18, marginBottom: 16 }}>No sources paired yet.</p>
            <Link to="/settings/pair">
              <button>+ Pair your first source</button>
            </Link>
          </div>
        )}
        {state.kind === 'error' && (
          <p style={{ padding: '0 20px', color: 'var(--danger)' }}>Error: {state.message}</p>
        )}
        {state.kind === 'ok' && state.errors.length > 0 && (
          <div style={{ padding: '0 20px 16px' }}>
            {state.errors.map((err) => (
              <p key={err.source} style={{ color: 'var(--danger)', margin: '4px 0' }}>
                {err.source}: {err.message}
              </p>
            ))}
          </div>
        )}
        {state.kind === 'ok' && state.rows.map((row) => (
          <Rail
            key={`${row.source}:${row.kind}:${row.title}`}
            title={row.source ? `${row.title} · ${row.source}` : row.title}
            items={row.items.map((i: Item) => ({ ...i, source: row.source }))}
            cardWidth={row.items[0]?.type === 'episode' ? 260 : 180}
          />
        ))}
        {state.kind === 'ok' && state.rows.length === 0 && state.errors.length === 0 && (
          <p style={{ padding: '0 20px' }} class="muted">Your sources are paired but returned nothing yet.</p>
        )}
      </div>
    </Chrome>
  );
}
