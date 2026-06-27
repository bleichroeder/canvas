import { useEffect, useState } from 'preact/hooks';

interface PlayerControlsProps {
  paused: boolean;
  posSec: number;
  durationSec: number;
  visible: boolean;
  thumbnailUrlTemplate?: string;
  volume: number;
  muted: boolean;
  fullscreen: boolean;
  onPlayPause(): void;
  onSeek(sec: number): void;
  onSeekRelative(deltaSec: number): void;
  onClose(): void;
  onVolumeChange(v: number): void;
  onMuteToggle(): void;
  onFullscreenToggle(): void;
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

function speakerGlyph(v: number, muted: boolean): string {
  if (muted || v === 0) return '🔇';
  if (v < 0.34) return '🔈';
  if (v < 0.67) return '🔉';
  return '🔊';
}

export function PlayerControls(p: PlayerControlsProps) {
  const [previewPos, setPreviewPos] = useState<number | null>(null);

  // Reset preview when not actively dragging.
  useEffect(() => {
    if (!p.visible) setPreviewPos(null);
  }, [p.visible]);

  const scrubPos = previewPos ?? p.posSec;
  const sliderMax = Math.max(1, p.durationSec);
  const previewMs = previewPos !== null
    ? Math.floor(previewPos * 100) * 100  // round down to nearest 100ms first
    : null;
  // BIF bucket = 10s.
  const previewBucketMs = previewMs !== null ? Math.floor(previewMs / 10000) * 10000 : null;
  const previewSrc = p.thumbnailUrlTemplate && previewBucketMs !== null
    ? p.thumbnailUrlTemplate.replace('{ms}', String(previewBucketMs))
    : null;

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <button
        onClick={p.onClose}
        style={{
          position: 'fixed', top: 16, right: 16, zIndex: 10,
          opacity: p.visible ? 1 : 0, transition: 'opacity 200ms',
          pointerEvents: p.visible ? 'auto' : 'none',
        }}
      >✕</button>

      {previewSrc && (
        <img
          src={previewSrc}
          alt=""
          style={{
            position: 'fixed', bottom: 110, left: '50%',
            transform: `translateX(calc(-50% + ${
              ((scrubPos / sliderMax) - 0.5) * Math.min(window.innerWidth - 40, 1400)
            }px))`,
            width: 160, height: 90, objectFit: 'cover',
            borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            border: '2px solid #fff',
            opacity: p.visible ? 1 : 0, transition: 'opacity 100ms',
            pointerEvents: 'none', zIndex: 11,
          }}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      )}

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
          max={sliderMax}
          step={1}
          value={Math.min(scrubPos, sliderMax)}
          onInput={(e) => setPreviewPos(Number((e.currentTarget as HTMLInputElement).value))}
          onChange={(e) => {
            const v = Number((e.currentTarget as HTMLInputElement).value);
            setPreviewPos(null);
            p.onSeek(v);
          }}
          style={{ width: '100%' }}
        />
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
          <button onClick={() => p.onSeekRelative(-10)}>◀ 10s</button>
          <button onClick={p.onPlayPause}>{p.paused ? '▶' : '⏸'}</button>
          <button onClick={() => p.onSeekRelative(+10)}>10s ▶</button>

          <button onClick={p.onMuteToggle} title="Mute" style={{ marginLeft: 16 }}>
            {speakerGlyph(p.volume, p.muted)}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(p.volume * 100)}
            onInput={(e) => p.onVolumeChange(Number((e.currentTarget as HTMLInputElement).value) / 100)}
            style={{ width: 100 }}
            aria-label="Volume"
          />

          <span class="muted" style={{ marginLeft: 'auto' }}>
            {fmt(scrubPos)} / {fmt(p.durationSec)}
          </span>

          <button onClick={p.onFullscreenToggle} title={p.fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {p.fullscreen ? '⤓' : '⤢'}
          </button>
        </div>
      </div>
    </div>
  );
}
