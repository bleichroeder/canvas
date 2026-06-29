import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';

export interface HeroAction {
  label: string;
  onClick: () => void;
}

export interface HeroProps {
  backdropUrl?: string;
  eyebrow?: string;
  title: string;
  meta?: ReactNode;
  primaryAction: HeroAction;
  secondaryAction?: HeroAction;
  onHeightChange?: (px: number) => void;
}

export function Hero({
  backdropUrl,
  eyebrow,
  title,
  meta,
  primaryAction,
  secondaryAction,
  onHeightChange,
}: HeroProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!onHeightChange) return;
    const el = ref.current;
    if (!el) return;
    const report = () => onHeightChange(el.getBoundingClientRect().height);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeightChange]);

  return (
    <Box
      ref={ref}
      sx={{
        position: 'relative',
        height: 'min(55vh, 720px)',
        minHeight: 360,
        mb: 3,
        overflow: 'hidden',
        backgroundColor: backdropUrl ? '#0e0f12' : 'transparent',
        backgroundImage: backdropUrl
          ? `url(${backdropUrl})`
          : 'radial-gradient(ellipse 80% 50% at 20% 0%, rgba(79, 142, 247, 0.12), transparent 60%)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Left-to-right readability overlay */}
      {backdropUrl && (
        <Box
          sx={{
            position: 'absolute', inset: 0,
            background:
              'linear-gradient(to right, rgba(14,15,18,0.95) 0%, rgba(14,15,18,0.7) 40%, rgba(14,15,18,0.2) 70%, transparent 100%)',
          }}
        />
      )}
      {/* Top fade so transparent AppShell stays legible */}
      <Box
        sx={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 80,
          background: 'linear-gradient(to bottom, rgba(14,15,18,0.6) 0%, transparent 100%)',
        }}
      />
      {/* Bottom feather into rails */}
      <Box
        sx={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 80,
          background: 'linear-gradient(to top, #0e0f12 0%, transparent 100%)',
        }}
      />
      {/* Content */}
      <Box
        sx={{
          position: 'absolute',
          left: { xs: 24, sm: 48 },
          top: 0, bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          maxWidth: 560,
          zIndex: 1,
        }}
      >
        {eyebrow && (
          <Typography
            variant="caption"
            sx={{
              color: 'text.secondary',
              letterSpacing: '1.5px',
              textTransform: 'uppercase',
              mb: 1,
            }}
          >
            {eyebrow}
          </Typography>
        )}
        <Typography sx={{ fontSize: 56, fontWeight: 600, lineHeight: 1.05, mb: 1.5 }}>
          {title}
        </Typography>
        {meta && (
          <Typography color="text.secondary" sx={{ mb: 2.5 }}>
            {meta}
          </Typography>
        )}
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Button
            variant="contained"
            size="large"
            startIcon={<PlayArrowIcon />}
            onClick={primaryAction.onClick}
            sx={{ py: 1.25, px: 3, fontSize: 15, fontWeight: 600 }}
          >
            {primaryAction.label}
          </Button>
          {secondaryAction && (
            <Button
              variant="text"
              size="large"
              onClick={secondaryAction.onClick}
              sx={{ py: 1.25, px: 2, fontSize: 14 }}
            >
              {secondaryAction.label}
            </Button>
          )}
        </Box>
      </Box>
    </Box>
  );
}
