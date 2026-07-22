import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';

interface UpNextOverlayProps {
  open: boolean;
  /** Small uppercase label, e.g. "Up next" or "Up next · <show>". */
  eyebrow: string;
  title: string;
  poster?: string;
  /** Optional secondary line (episode synopsis, channel name, …). */
  detail?: string;
  /** Total countdown length in seconds. Default 10. */
  countdownSec?: number;
  onPlayNow(): void;
  onCancel(): void;
}

export function UpNextOverlay(p: UpNextOverlayProps) {
  const total = p.countdownSec ?? 10;
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!p.open) return;
    setElapsedMs(0);
    const start = performance.now();
    const interval = window.setInterval(() => {
      const e = performance.now() - start;
      setElapsedMs(e);
      if (e >= total * 1000) {
        clearInterval(interval);
        p.onPlayNow();
      }
    }, 100);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.open, total]);

  if (!p.open) return null;

  const remaining = Math.max(0, Math.ceil((total * 1000 - elapsedMs) / 1000));
  const progress = Math.min(100, (elapsedMs / (total * 1000)) * 100);

  return (
    <Box
      sx={{
        position: 'fixed', left: 0, right: 0, bottom: 0,
        px: 4, py: 3,
        background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.75) 60%, rgba(0,0,0,0.2) 100%)',
        backdropFilter: 'blur(4px)',
        zIndex: 15,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={3} sx={{ maxWidth: 1200, mx: 'auto' }}>
        {p.poster && (
          <Box
            component="img"
            src={p.poster}
            alt=""
            sx={{ width: 200, height: 112, objectFit: 'cover', borderRadius: 1, flexShrink: 0 }}
          />
        )}
        <Box sx={{ flex: 1, color: 'common.white' }}>
          <Typography variant="caption" sx={{ opacity: 0.7, letterSpacing: 1.5, textTransform: 'uppercase' }}>
            {p.eyebrow}
          </Typography>
          <Typography variant="h5" sx={{ mt: 0.5, fontWeight: 600 }}>
            {p.title}
          </Typography>
          {p.detail && (
            <Typography variant="body2" sx={{ mt: 0.75, opacity: 0.85, maxWidth: 700, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {p.detail}
            </Typography>
          )}
        </Box>
        <Box sx={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
          <CircularProgress
            variant="determinate"
            value={progress}
            size={64}
            thickness={4}
            sx={{ color: 'primary.main' }}
          />
          <Box
            sx={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'common.white', fontWeight: 600, fontSize: 20,
            }}
          >
            {remaining}
          </Box>
        </Box>
        <Stack spacing={1} sx={{ flexShrink: 0 }}>
          <Button variant="contained" onClick={p.onPlayNow}>Play now</Button>
          <Button variant="text" sx={{ color: 'common.white' }} onClick={p.onCancel}>Cancel</Button>
        </Stack>
      </Stack>
    </Box>
  );
}
