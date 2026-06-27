interface PlayerControlsProps {
  paused: boolean;
  posSec: number;
  durationSec: number;
  visible: boolean;
  onPlayPause(): void;
  onSeek(sec: number): void;
  onSeekRelative(deltaSec: number): void;
  onClose(): void;
  onToggleSubs?: () => void;
  subsOn?: boolean;
}

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m}:${s.toString().padStart(2, '0')}`;
}

export function PlayerControls(p: PlayerControlsProps) {
  return (
    <div>
      <button
        onClick={p.onClose}
        style={{
          position: 'fixed', top: 16, right: 16, zIndex: 10,
          opacity: p.visible ? 1 : 0, transition: 'opacity 200ms',
          pointerEvents: p.visible ? 'auto' : 'none',
        }}
      >✕</button>
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0,
        padding: '24px 20px 16px',
        background: 'linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0))',
        opacity: p.visible ? 1 : 0, transition: 'opacity 200ms',
        pointerEvents: p.visible ? 'auto' : 'none',
        zIndex: 10,
      }}>
        <input
          type="range"
          min={0}
          max={Math.max(1, p.durationSec)}
          step={1}
          value={Math.min(p.posSec, p.durationSec)}
          onChange={(e) => p.onSeek(Number((e.currentTarget as HTMLInputElement).value))}
          style={{ width: '100%' }}
        />
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
          <button onClick={() => p.onSeekRelative(-10)}>◀ 10s</button>
          <button onClick={p.onPlayPause}>{p.paused ? '▶' : '⏸'}</button>
          <button onClick={() => p.onSeekRelative(+10)}>10s ▶</button>
          <span class="muted" style={{ marginLeft: 'auto' }}>
            {fmt(p.posSec)} / {fmt(p.durationSec)}
          </span>
          {p.onToggleSubs && (
            <button onClick={p.onToggleSubs}>{p.subsOn ? 'CC ✓' : 'CC'}</button>
          )}
        </div>
      </div>
    </div>
  );
}
