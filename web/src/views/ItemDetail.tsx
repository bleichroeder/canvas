import { useEffect, useState } from 'preact/hooks';
import { api } from '../api';
import { Chrome } from '../components/Chrome';
import { Link, navigate } from '../router';
import type { ItemDetail } from '../types';

interface Props { source: string; id: string }

function formatRuntime(sec?: number): string {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatPos(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ItemDetailView({ source, id }: Props) {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ok'; item: ItemDetail }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' });

  useEffect(() => {
    setState({ kind: 'loading' });
    api.item(source, id).then(
      (item) => setState({ kind: 'ok', item }),
      (e: Error) => setState({ kind: 'error', message: e.message }),
    );
  }, [source, id]);

  if (state.kind === 'loading') return <Chrome><p style={{ padding: 20 }} class="muted">Loading…</p></Chrome>;
  if (state.kind === 'error') return <Chrome><p style={{ padding: 20, color: 'var(--danger)' }}>{state.message}</p></Chrome>;

  const { item } = state;
  const resume = (item.viewOffsetSec ?? 0) > 60;

  return (
    <Chrome>
      {item.backdrop && (
        <div style={{
          height: 320, backgroundImage: `url(${item.backdrop})`,
          backgroundSize: 'cover', backgroundPosition: 'center',
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to bottom, transparent 50%, var(--bg) 100%)',
          }} />
        </div>
      )}
      <div style={{ padding: '0 20px', marginTop: item.backdrop ? -80 : 20, position: 'relative' }}>
        <div style={{ display: 'flex', gap: 24 }}>
          {item.poster && (
            <img src={item.poster} style={{ width: 200, height: 300, borderRadius: 8, objectFit: 'cover' }} alt="" />
          )}
          <div style={{ flex: 1, paddingTop: item.backdrop ? 60 : 0 }}>
            <h1 style={{ margin: '0 0 8px', fontSize: 32 }}>{item.title}</h1>
            <div class="muted" style={{ marginBottom: 16 }}>
              {[item.year, formatRuntime(item.durationSec), item.rating ? `★ ${item.rating}` : null]
                .filter(Boolean).join(' · ')}
            </div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <button
                style={{ padding: '14px 28px', fontSize: 16, background: 'var(--accent)', border: 'none' }}
                onClick={() => navigate(`/play/${source}/${item.id}`)}
              >
                ▶ {resume ? `Resume ${formatPos(item.viewOffsetSec!)}` : 'Play'}
              </button>
              {resume && (
                <button onClick={() => navigate(`/play/${source}/${item.id}?from=0`)}>
                  Start over
                </button>
              )}
            </div>
            {item.synopsis && <p style={{ maxWidth: 700, lineHeight: 1.5 }}>{item.synopsis}</p>}
          </div>
        </div>

        {item.episodes && item.episodes.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <h2 style={{ fontSize: 20, marginBottom: 12 }}>Episodes</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {item.episodes.map((ep) => (
                <Link
                  key={ep.id}
                  to={`/play/${source}/${ep.id}`}
                  style={{
                    display: 'flex', gap: 16, padding: 12,
                    background: 'var(--row)', borderRadius: 8, color: 'var(--fg)',
                  }}
                >
                  {ep.poster && (
                    <img src={ep.poster} style={{ width: 160, height: 90, borderRadius: 4, objectFit: 'cover' }} alt="" />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>S{ep.season}·E{ep.episode} · {ep.title}</div>
                    {ep.synopsis && <div class="muted" style={{ marginTop: 4, fontSize: 14 }}>{ep.synopsis}</div>}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </Chrome>
  );
}
