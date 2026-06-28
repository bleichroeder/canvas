import { useEffect, useState } from 'react';
import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Fade from '@mui/material/Fade';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CloseIcon from '@mui/icons-material/Close';
import { useRoute, navigate } from '../router';
import {
  getNowPlaying,
  clearNowPlaying,
  getSourceLabel,
  getSources,
  NOW_PLAYING_EVENT,
} from '../storage';
import { SOURCE_TYPE_COLOR, sourceGlyph } from '../lib/source-style';
import type { NowPlaying } from '../storage';

export function useNowPlaying(): NowPlaying | undefined {
  const [np, setNp] = useState<NowPlaying | undefined>(getNowPlaying);
  useEffect(() => {
    const onUpdate = () => setNp(getNowPlaying());
    window.addEventListener(NOW_PLAYING_EVENT, onUpdate);
    window.addEventListener('storage', onUpdate);
    return () => {
      window.removeEventListener(NOW_PLAYING_EVENT, onUpdate);
      window.removeEventListener('storage', onUpdate);
    };
  }, []);
  return np;
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

export function NowPlayingStrip() {
  const route = useRoute();
  const np = useNowPlaying();

  // Hide while the player itself is mounted, on the phone-pair page, or before
  // anything's ever been played.
  const isPlayer = route.path.startsWith('/play/');
  const isPhonePair = route.path === '/pair';
  if (!np || isPlayer || isPhonePair) return null;

  const pct = np.durationSec > 0
    ? Math.min(100, Math.max(0, (np.posSec / np.durationSec) * 100))
    : 0;
  const sourceType = getSources()[np.src]?.type;
  const sourceLabel = getSourceLabel(np.src) ?? np.src;
  const remaining = Math.max(0, np.durationSec - np.posSec);

  return (
    <Fade in timeout={300}>
      <Paper
        elevation={0}
        onClick={() => navigate(`/play/${np.src}/${np.id}?from=${Math.floor(np.posSec)}`)}
        sx={{
          position: 'fixed', left: 0, right: 0, bottom: 0,
          zIndex: 1100,
          p: 1.25,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          cursor: 'pointer',
          backgroundColor: 'rgba(24, 26, 31, 0.85)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderTop: '1px solid',
          borderColor: 'divider',
          borderRadius: 0,
          transition: 'background-color 150ms ease',
          '&:hover': {
            backgroundColor: 'rgba(24, 26, 31, 0.95)',
          },
        }}
      >
        {np.poster && (
          <Box
            component="img"
            src={np.poster}
            alt=""
            sx={{
              width: 56, height: 84, borderRadius: 0.75,
              objectFit: 'cover',
              flexShrink: 0,
              boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
            }}
          />
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: 600 }}>
              Continue
            </Typography>
            {sourceType && (
              <Box
                sx={{
                  width: 16, height: 14, borderRadius: 0.5,
                  backgroundColor: SOURCE_TYPE_COLOR[sourceType],
                  color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, fontWeight: 700,
                }}
              >
                {sourceGlyph(sourceLabel, 1)}
              </Box>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {sourceLabel}
            </Typography>
          </Box>
          <Typography
            sx={{
              fontWeight: 500, fontSize: 15,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {np.title}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 0.75 }}>
            <LinearProgress
              variant="determinate"
              value={pct}
              sx={{
                flex: 1,
                height: 3,
                borderRadius: 1,
                backgroundColor: 'rgba(255,255,255,0.08)',
                '& .MuiLinearProgress-bar': { backgroundColor: 'primary.main' },
              }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ fontFeatureSettings: '"tnum" 1' }}>
              {fmt(remaining)} left
            </Typography>
          </Box>
        </Box>
        <IconButton
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/play/${np.src}/${np.id}?from=${Math.floor(np.posSec)}`);
          }}
          aria-label="resume"
          sx={{
            backgroundColor: 'primary.main',
            color: '#fff',
            width: 44, height: 44,
            '&:hover': { backgroundColor: 'primary.dark' },
          }}
        >
          <PlayArrowIcon />
        </IconButton>
        <IconButton
          onClick={(e) => { e.stopPropagation(); clearNowPlaying(); }}
          aria-label="dismiss"
          size="small"
          sx={{ color: 'text.secondary' }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Paper>
    </Fade>
  );
}
