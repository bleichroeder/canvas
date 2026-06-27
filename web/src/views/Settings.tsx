import { useEffect, useState } from 'preact/hooks';
import { Chrome } from '../components/Chrome';
import { Link } from '../router';
import { getSources, removeSource, getPrefs, setPrefs } from '../storage';
import type { StoredSource, Prefs } from '../storage';

export function Settings() {
  const [sources, setLocalSources] = useState<Record<string, StoredSource>>({});
  const [prefs, setLocalPrefs] = useState<Prefs>(getPrefs());

  useEffect(() => {
    setLocalSources(getSources());
  }, []);

  function unpair(key: string) {
    removeSource(key);
    setLocalSources({ ...getSources() });
  }

  function update<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    const next: Prefs = { ...prefs, [key]: value };
    setLocalPrefs(next);
    setPrefs(next);
  }

  const entries = Object.entries(sources);

  return (
    <Chrome>
      <div style={{ padding: 20, maxWidth: 700 }}>
        <h2>Sources</h2>
        {entries.length === 0 && <p class="muted">No sources paired yet.</p>}
        {entries.map(([key, src]) => (
          <div key={key} style={{
            display: 'flex', alignItems: 'center', padding: 12,
            background: 'var(--row)', borderRadius: 8, marginBottom: 8,
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{src.label}</div>
              <div class="muted" style={{ fontSize: 13 }}>{src.type} · {src.baseUrl}</div>
            </div>
            <button onClick={() => unpair(key)}>Unpair</button>
          </div>
        ))}
        <Link to="/settings/pair"><button style={{ marginTop: 12 }}>+ Pair new source</button></Link>

        <h2 style={{ marginTop: 32 }}>Preferences</h2>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={prefs.autoplayNext}
            onChange={(e) => update('autoplayNext', (e.currentTarget as HTMLInputElement).checked)}
          />
          Autoplay next episode
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={prefs.skipIntro}
            onChange={(e) => update('skipIntro', (e.currentTarget as HTMLInputElement).checked)}
          />
          Skip intro automatically
        </label>

        <h2 style={{ marginTop: 32 }}>About</h2>
        <p class="muted">passenger v2.0 · canvas/WebCodecs player</p>
      </div>
    </Chrome>
  );
}
