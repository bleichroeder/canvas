import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Slider from '@mui/material/Slider';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import Fade from '@mui/material/Fade';
import CloseIcon from '@mui/icons-material/Close';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import Replay10Icon from '@mui/icons-material/Replay10';
import Forward10Icon from '@mui/icons-material/Forward10';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import VolumeMuteIcon from '@mui/icons-material/VolumeMute';
import VolumeDownIcon from '@mui/icons-material/VolumeDown';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';

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

function SpeakerIcon({ volume, muted }: { volume: number; muted: boolean }) {
  if (muted || volume === 0) return <VolumeOffIcon />;
  if (volume < 0.34) return <VolumeMuteIcon />;
  if (volume < 0.67) return <VolumeDownIcon />;
  return <VolumeUpIcon />;
}

export function PlayerControls(p: PlayerControlsProps) {
  const [previewPos, setPreviewPos] = useState<number | null>(null);
  const [previewBroken, setPreviewBroken] = useState(false);

  useEffect(() => {
    if (!p.visible) setPreviewPos(null);
  }, [p.visible]);

  useEffect(() => {
    setPreviewBroken(false);
  }, [p.thumbnailUrlTemplate]);

  const scrubPos = previewPos ?? p.posSec;
  const sliderMax = Math.max(1, p.durationSec);
  const previewMs = previewPos !== null ? Math.floor(previewPos * 100) * 100 : null;
  const previewBucketMs = previewMs !== null ? Math.floor(previewMs / 10000) * 10000 : null;
  const previewSrc = p.thumbnailUrlTemplate && previewBucketMs !== null
    ? p.thumbnailUrlTemplate.replace('{ms}', String(previewBucketMs))
    : null;

  return (
    <Box onClick={(e) => e.stopPropagation()}>
      <Fade in={p.visible} timeout={200}>
        <IconButton
          onClick={p.onClose}
          aria-label="close"
          sx={{ position: 'fixed', top: 16, right: 16, zIndex: 10, color: 'text.primary' }}
        >
          <CloseIcon />
        </IconButton>
      </Fade>

      {previewSrc && !previewBroken && (
        <Fade in={p.visible} timeout={100}>
          <Box
            component="img"
            src={previewSrc}
            alt=""
            onError={() => setPreviewBroken(true)}
            sx={{
              position: 'fixed', bottom: 110, left: '50%',
              transform: `translateX(calc(-50% + ${
                ((scrubPos / sliderMax) - 0.5) * Math.min(window.innerWidth - 40, 1400)
              }px))`,
              width: 160, height: 90, objectFit: 'cover',
              borderRadius: 1, boxShadow: 4,
              border: '2px solid', borderColor: 'common.white',
              pointerEvents: 'none', zIndex: 11,
            }}
          />
        </Fade>
      )}

      <Fade in={p.visible} timeout={200}>
        <Box
          sx={{
            position: 'fixed', left: 0, right: 0, bottom: 0,
            px: 2.5, pt: 3, pb: 2,
            background: 'linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0))',
            zIndex: 10,
          }}
        >
          <Slider
            value={Math.min(scrubPos, sliderMax)}
            min={0}
            max={sliderMax}
            step={1}
            onChange={(_, v) => setPreviewPos(typeof v === 'number' ? v : v[0] ?? 0)}
            onChangeCommitted={(_, v) => {
              const value = typeof v === 'number' ? v : (v[0] ?? 0);
              setPreviewPos(null);
              p.onSeek(value);
            }}
            sx={{ color: 'primary.main', height: 4 }}
            aria-label="Seek"
          />
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1 }}>
            <Tooltip title="Back 10 seconds">
              <IconButton onClick={() => p.onSeekRelative(-10)} aria-label="back 10s">
                <Replay10Icon />
              </IconButton>
            </Tooltip>
            <Tooltip title={p.paused ? 'Play' : 'Pause'}>
              <IconButton onClick={p.onPlayPause} aria-label="play pause">
                {p.paused ? <PlayArrowIcon /> : <PauseIcon />}
              </IconButton>
            </Tooltip>
            <Tooltip title="Forward 10 seconds">
              <IconButton onClick={() => p.onSeekRelative(+10)} aria-label="forward 10s">
                <Forward10Icon />
              </IconButton>
            </Tooltip>
            <Tooltip title={p.muted ? 'Unmute' : 'Mute'}>
              <IconButton onClick={p.onMuteToggle} aria-label="mute toggle" sx={{ ml: 2 }}>
                <SpeakerIcon volume={p.volume} muted={p.muted} />
              </IconButton>
            </Tooltip>
            <Slider
              value={Math.round(p.volume * 100)}
              min={0}
              max={100}
              step={1}
              onChange={(_, v) => p.onVolumeChange((typeof v === 'number' ? v : (v[0] ?? 0)) / 100)}
              sx={{ width: 100, color: 'primary.main' }}
              aria-label="Volume"
            />
            <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
              {fmt(scrubPos)} / {fmt(p.durationSec)}
            </Typography>
            <Tooltip title={p.fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              <IconButton onClick={p.onFullscreenToggle} aria-label="fullscreen toggle">
                {p.fullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </Fade>
    </Box>
  );
}
