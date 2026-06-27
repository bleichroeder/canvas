import { useEffect, useState } from 'preact/hooks';
import { api } from '../api';
import { Chrome } from '../components/Chrome';
import { addSource, makeSourceKey } from '../storage';
import { navigate } from '../router';
import type { StoredSource } from '../storage';

type SourceType = StoredSource['type'];

type State =
  | { kind: 'choose' }
  | { kind: 'pairing'; type: SourceType; code: string; expiresAt: number }
  | { kind: 'paired'; label: string }
  | { kind: 'error'; message: string };

const SOURCE_TYPES: Array<{ type: SourceType; label: string; available: boolean }> = [
  { type: 'plex', label: 'Plex Media Server', available: true },
  { type: 'jellyfin', label: 'Jellyfin', available: false }, // wired in Plan B
  { type: 'flixify', label: 'thecalm.site (Flixify)', available: false }, // wired in Plan B
  { type: 'generic', label: 'Direct URL', available: false }, // wired in Plan B
];

export function Pair() {
  const [state, setState] = useState<State>({ kind: 'choose' });

  async function startPair(type: SourceType) {
    try {
      const { code, expiresAt } = await api.pairStart(type);
      setState({ kind: 'pairing', type, code, expiresAt });
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message });
    }
  }

  useEffect(() => {
    if (state.kind !== 'pairing') return;
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await api.pairPoll(state.code);
        if (cancelled) return;
        if (res.status === 'approved' && res.source) {
          const key = makeSourceKey(res.source.label || res.source.baseUrl);
          addSource(key, res.source);
          await api.pairDelete(state.code).catch(() => {});
          setState({ kind: 'paired', label: res.source.label });
          setTimeout(() => navigate('/settings'), 1200);
          return;
        }
        if (res.status === 'expired') {
          setState({ kind: 'error', message: 'Pair code expired. Try again.' });
          return;
        }
        setTimeout(poll, 3000);
      } catch (e) {
        if (!cancelled) setState({ kind: 'error', message: (e as Error).message });
      }
    };
    void poll();
    return () => { cancelled = true; };
  }, [state.kind === 'pairing' ? state.code : null]);

  return (
    <Chrome>
      <div style={{ padding: 40, maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
        {state.kind === 'choose' && (
          <div>
            <h2>Pair a new source</h2>
            <p class="muted" style={{ marginBottom: 24 }}>Choose what kind of source you want to add.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {SOURCE_TYPES.map((s) => (
                <button
                  key={s.type}
                  disabled={!s.available}
                  onClick={() => startPair(s.type)}
                  style={{ padding: '16px 20px', textAlign: 'left' }}
                >
                  {s.label} {!s.available && <span class="muted" style={{ fontSize: 13 }}>(coming soon)</span>}
                </button>
              ))}
            </div>
          </div>
        )}
        {state.kind === 'pairing' && (
          <div>
            <h2>On your phone, go to:</h2>
            <p style={{ fontSize: 20, margin: '16px 0' }}>passenger-v2.pages.dev/#/pair</p>
            <p>Enter this code:</p>
            <div style={{
              fontSize: 56, fontWeight: 700, letterSpacing: 4,
              background: 'var(--row)', padding: '24px 32px', borderRadius: 12,
              display: 'inline-block', margin: '16px 0',
            }}>{state.code}</div>
            <p class="muted">Waiting for approval…</p>
            <p class="muted" style={{ fontSize: 13, marginTop: 16 }}>
              Code expires {new Date(state.expiresAt).toLocaleTimeString()}.
            </p>
          </div>
        )}
        {state.kind === 'paired' && (
          <div>
            <h2 style={{ color: 'var(--accent)' }}>✓ Paired</h2>
            <p>{state.label} is now linked. Redirecting…</p>
          </div>
        )}
        {state.kind === 'error' && (
          <div>
            <h2 style={{ color: 'var(--danger)' }}>Pair failed</h2>
            <p>{state.message}</p>
            <button onClick={() => setState({ kind: 'choose' })} style={{ marginTop: 16 }}>Try again</button>
          </div>
        )}
      </div>
    </Chrome>
  );
}
