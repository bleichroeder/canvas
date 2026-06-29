import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import type { SxProps, Theme } from '@mui/material/styles';

interface ElevatedCardProps {
  children: ReactNode;
  variant?: 'static' | 'interactive';
  onClick?: () => void;
  sx?: SxProps<Theme>;
}

export function ElevatedCard({ children, variant = 'static', onClick, sx }: ElevatedCardProps) {
  if (variant === 'interactive') {
    return (
      <ButtonBase
        onClick={onClick}
        sx={[
          (theme: Theme) => ({
            display: 'block',
            width: '100%',
            backgroundColor: theme.palette.surface.elevated,
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 2,
            boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
            textAlign: 'left',
            color: 'inherit',
            transition: `transform ${theme.canvasMotion.med} ${theme.canvasMotion.easing}, box-shadow ${theme.canvasMotion.med} ${theme.canvasMotion.easing}`,
            '&:hover': {
              transform: 'scale(1.03)',
              boxShadow: '0 24px 56px rgba(0,0,0,0.55)',
            },
            '&:active': {
              transform: 'scale(0.97)',
              transition: `transform ${theme.canvasMotion.fast} ${theme.canvasMotion.easing}`,
            },
            '&.Mui-focusVisible': {
              outline: '2px solid #4f8ef7',
              outlineOffset: 4,
            },
          }),
          ...(Array.isArray(sx) ? sx : [sx]),
        ].filter(Boolean) as SxProps<Theme>}
      >
        {children}
      </ButtonBase>
    );
  }
  return (
    <Box
      sx={[
        (theme: Theme) => ({
          display: 'block',
          width: '100%',
          backgroundColor: theme.palette.surface.elevated,
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 2,
          boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ].filter(Boolean) as SxProps<Theme>}
    >
      {children}
    </Box>
  );
}
