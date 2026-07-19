import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Slider from '@mui/material/Slider';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import Fade from '@mui/material/Fade';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import CloseIcon from '@mui/icons-material/Close';
import PictureInPictureAltIcon from '@mui/icons-material/PictureInPictureAlt';
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
import ClosedCaptionOutlinedIcon from '@mui/icons-material/ClosedCaptionOutlined';
import ClosedCaptionIcon from '@mui/icons-material/ClosedCaption';
import CheckIcon from '@mui/icons-material/Check';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import BugReportIcon from '@mui/icons-material/BugReport';
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious';
import SkipNextIcon from '@mui/icons-material/SkipNext';

export interface SubtitleTrackOption {
  id: string;
  label?: string;
  language?: string;
}

export interface QueueControlProps {
  canPrev: boolean;
  canNext: boolean;
  onPrev(): void;
  onNext(): void;
}

interface PlayerControlsProps {
  paused: boolean;
  posSec: number;
  durationSec: number;
  visible: boolean;
  thumbnailUrlTemplate?: string;
  volume: number;
  muted: boolean;
  fullscreen: boolean;
  subtitleTracks: SubtitleTrackOption[];
  selectedSubtitleId: string | null;
  captionsOffsetMs: number;
  onPlayPause(): void;
  onSeek(sec: number): void;
  onSeekRelative(deltaSec: number): void;
  onClose(): void;
  onMinimize(): void;
  onVolumeChange(v: number): void;
  onMuteToggle(): void;
  onFullscreenToggle(): void;
  onOpenDiagnostics(): void;
  queueContext: QueueControlProps | null;
  onSubtitleChange(id: string | null): void;
  onCaptionsOffsetChange(ms: number): void;
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

const scrubSliderSx = {
  color: 'primary.main',
  height: 6,
  py: 1.5,
  '& .MuiSlider-thumb': {
    width: 18, height: 18,
    transition: 'width 120ms ease, height 120ms ease, box-shadow 120ms ease',
    '&:hover, &.Mui-focusVisible': {
      boxShadow: '0 0 0 8px rgba(79, 142, 247, 0.16)',
    },
    '&.Mui-active': {
      width: 24, height: 24,
      boxShadow: '0 0 0 12px rgba(79, 142, 247, 0.24)',
    },
  },
  '& .MuiSlider-rail': {
    opacity: 0.28,
    backgroundColor: 'common.white',
  },
  '& .MuiSlider-track': {
    border: 'none',
    height: 6,
  },
};

const volumeSliderSx = {
  width: 110,
  color: 'primary.main',
  '& .MuiSlider-thumb': {
    width: 12, height: 12,
    '&:hover, &.Mui-focusVisible, &.Mui-active': {
      boxShadow: '0 0 0 6px rgba(79, 142, 247, 0.2)',
    },
  },
  '& .MuiSlider-rail': {
    opacity: 0.3,
    backgroundColor: 'common.white',
  },
};

export function PlayerControls(p: PlayerControlsProps) {
  const [previewPos, setPreviewPos] = useState<number | null>(null);
  const [previewBroken, setPreviewBroken] = useState(false);
  const [ccAnchor, setCcAnchor] = useState<HTMLElement | null>(null);
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const hasTracks = p.subtitleTracks.length > 0;
  const captionsOn = p.selectedSubtitleId !== null;

  useEffect(() => {
    if (!p.visible) {
      setPreviewPos(null);
      setMoreAnchor(null);
    }
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
        <Box sx={{ position: 'absolute', top: 20, right: 20, zIndex: 10, display: 'flex', gap: 1 }}>
          <Tooltip title="Minimize">
            <IconButton
              onClick={p.onMinimize}
              aria-label="minimize"
              sx={{
                color: 'text.primary', width: 48, height: 48,
                backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)',
                '&:hover': { backgroundColor: 'rgba(0,0,0,0.6)' },
              }}
            >
              <PictureInPictureAltIcon />
            </IconButton>
          </Tooltip>
          <IconButton
            onClick={p.onClose}
            aria-label="close"
            sx={{
              color: 'text.primary', width: 48, height: 48,
              backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)',
              '&:hover': { backgroundColor: 'rgba(0,0,0,0.6)' },
            }}
          >
            <CloseIcon />
          </IconButton>
        </Box>
      </Fade>

      {previewSrc && !previewBroken && (
        <Fade in={p.visible} timeout={100}>
          <Box
            component="img"
            src={previewSrc}
            alt=""
            onError={() => setPreviewBroken(true)}
            sx={{
              position: 'absolute', bottom: 130, left: '50%',
              transform: `translateX(calc(-50% + ${
                ((scrubPos / sliderMax) - 0.5) * Math.min(window.innerWidth - 40, 1400)
              }px))`,
              width: 200, height: 112, objectFit: 'cover',
              borderRadius: 1.5,
              boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
              border: '2px solid', borderColor: 'common.white',
              pointerEvents: 'none', zIndex: 11,
            }}
          />
        </Fade>
      )}

      <Fade in={p.visible} timeout={200}>
        <Box
          sx={{
            position: 'absolute', left: 0, right: 0, bottom: 0,
            px: 3, pt: 4, pb: 2.5,
            background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.65) 50%, transparent 100%)',
            backdropFilter: 'blur(2px)',
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
            sx={scrubSliderSx}
            aria-label="Seek"
          />
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', mt: 0.5 }}>
            {p.queueContext && (
              <Tooltip title="Previous episode">
                <span>
                  <IconButton
                    onClick={p.queueContext.onPrev}
                    disabled={!p.queueContext.canPrev}
                    aria-label="previous episode"
                    size="large"
                  >
                    <SkipPreviousIcon sx={{ fontSize: 32 }} />
                  </IconButton>
                </span>
              </Tooltip>
            )}
            <Tooltip title="Back 10 seconds">
              <IconButton onClick={() => p.onSeekRelative(-10)} aria-label="back 10s" size="large">
                <Replay10Icon sx={{ fontSize: 32 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title={p.paused ? 'Play' : 'Pause'}>
              <IconButton
                onClick={p.onPlayPause}
                aria-label="play pause"
                sx={{
                  width: 64, height: 64,
                  color: 'common.white',
                  backgroundColor: 'rgba(255,255,255,0.12)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  '&:hover': { backgroundColor: 'rgba(255,255,255,0.2)' },
                }}
              >
                {p.paused ? <PlayArrowIcon sx={{ fontSize: 38 }} /> : <PauseIcon sx={{ fontSize: 34 }} />}
              </IconButton>
            </Tooltip>
            <Tooltip title="Forward 10 seconds">
              <IconButton onClick={() => p.onSeekRelative(+10)} aria-label="forward 10s" size="large">
                <Forward10Icon sx={{ fontSize: 32 }} />
              </IconButton>
            </Tooltip>
            {p.queueContext && (
              <Tooltip title="Next episode">
                <span>
                  <IconButton
                    onClick={p.queueContext.onNext}
                    disabled={!p.queueContext.canNext}
                    aria-label="next episode"
                    size="large"
                  >
                    <SkipNextIcon sx={{ fontSize: 32 }} />
                  </IconButton>
                </span>
              </Tooltip>
            )}
            <Tooltip title={p.muted ? 'Unmute' : 'Mute'}>
              <IconButton onClick={p.onMuteToggle} aria-label="mute toggle" sx={{ ml: 3 }}>
                <SpeakerIcon volume={p.volume} muted={p.muted} />
              </IconButton>
            </Tooltip>
            <Slider
              value={Math.round(p.volume * 100)}
              min={0}
              max={100}
              step={1}
              onChange={(_, v) => p.onVolumeChange((typeof v === 'number' ? v : (v[0] ?? 0)) / 100)}
              sx={volumeSliderSx}
              aria-label="Volume"
            />
            <Typography
              variant="body2"
              sx={{
                ml: 'auto',
                color: 'common.white',
                fontFeatureSettings: '"tnum" 1',
                fontWeight: 500,
                letterSpacing: 0.5,
                textShadow: '0 1px 3px rgba(0,0,0,0.6)',
              }}
            >
              {fmt(scrubPos)} <Box component="span" sx={{ opacity: 0.6, mx: 0.5 }}>/</Box> {fmt(p.durationSec)}
            </Typography>
            {hasTracks && (
              <Tooltip title="Subtitles">
                <IconButton
                  onClick={(e) => setCcAnchor(e.currentTarget)}
                  aria-label="subtitles"
                  sx={{ ml: 1, color: captionsOn ? 'primary.main' : 'inherit' }}
                >
                  {captionsOn ? <ClosedCaptionIcon /> : <ClosedCaptionOutlinedIcon />}
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="More">
              <IconButton
                onClick={(e) => setMoreAnchor(e.currentTarget)}
                aria-label="more"
                sx={{ ml: 1 }}
              >
                <MoreVertIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Minimize">
              <IconButton onClick={p.onMinimize} aria-label="minimize" sx={{ ml: 1.5 }}>
                <PictureInPictureAltIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title={p.fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              <IconButton onClick={p.onFullscreenToggle} aria-label="fullscreen toggle" sx={{ ml: 1.5 }}>
                {p.fullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </Fade>

      <Menu
        anchorEl={ccAnchor}
        open={Boolean(ccAnchor)}
        onClose={() => setCcAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        slotProps={{ paper: { sx: { minWidth: 300, mb: 1 } } }}
      >
        <MenuItem
          onClick={() => { p.onSubtitleChange(null); setCcAnchor(null); }}
          selected={!captionsOn}
        >
          <ListItemIcon sx={{ minWidth: 36 }}>
            {!captionsOn ? <CheckIcon fontSize="small" /> : null}
          </ListItemIcon>
          <ListItemText primary="Off" />
        </MenuItem>
        {p.subtitleTracks.map((t) => (
          <MenuItem
            key={t.id}
            onClick={() => { p.onSubtitleChange(t.id); setCcAnchor(null); }}
            selected={p.selectedSubtitleId === t.id}
          >
            <ListItemIcon sx={{ minWidth: 36 }}>
              {p.selectedSubtitleId === t.id ? <CheckIcon fontSize="small" /> : null}
            </ListItemIcon>
            <ListItemText primary={t.label ?? t.language ?? t.id} />
          </MenuItem>
        ))}
        <Divider sx={{ my: 0.5 }} />
        <Box sx={{ px: 2, py: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">Timing offset</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontFeatureSettings: '"tnum" 1' }}>
              {p.captionsOffsetMs === 0 ? '0' : (p.captionsOffsetMs > 0 ? '+' : '') + (p.captionsOffsetMs / 1000).toFixed(1)}s
            </Typography>
          </Box>
          <Slider
            value={p.captionsOffsetMs}
            min={-5000}
            max={5000}
            step={100}
            marks={[
              { value: -5000, label: '-5s' },
              { value: 0, label: '0' },
              { value: 5000, label: '+5s' },
            ]}
            onChange={(_, v) => p.onCaptionsOffsetChange(typeof v === 'number' ? v : (v[0] ?? 0))}
            sx={{ color: 'primary.main' }}
          />
        </Box>
      </Menu>
      <Menu
        anchorEl={moreAnchor}
        open={Boolean(moreAnchor)}
        onClose={() => setMoreAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        slotProps={{ paper: { sx: { minWidth: 200, mb: 1 } } }}
      >
        <MenuItem
          onClick={() => { setMoreAnchor(null); p.onOpenDiagnostics(); }}
        >
          <ListItemIcon sx={{ minWidth: 36 }}>
            <BugReportIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Diagnostics" />
        </MenuItem>
      </Menu>
    </Box>
  );
}
