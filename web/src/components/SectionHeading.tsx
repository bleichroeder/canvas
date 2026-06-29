import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

interface SectionHeadingProps {
  title: string;
  action?: ReactNode;
  sx?: SxProps<Theme>;
}

export function SectionHeading({ title, action, sx }: SectionHeadingProps) {
  return (
    <Box
      sx={[
        {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2.5,
          mt: 4,
          mb: 2,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ].filter(Boolean) as SxProps<Theme>}
    >
      <Typography variant="h2" sx={{ m: 0 }}>{title}</Typography>
      {action && <Box>{action}</Box>}
    </Box>
  );
}
