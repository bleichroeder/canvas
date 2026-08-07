import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

interface SectionHeadingProps {
  title: string;
  /** Optional element before the title (e.g. a channel avatar). */
  titlePrefix?: ReactNode;
  action?: ReactNode;
  sx?: SxProps<Theme>;
}

export function SectionHeading({ title, titlePrefix, action, sx }: SectionHeadingProps) {
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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
        {titlePrefix}
        <Typography variant="h2" sx={{ m: 0 }} noWrap>{title}</Typography>
      </Box>
      {action && <Box sx={{ flexShrink: 0, ml: 2 }}>{action}</Box>}
    </Box>
  );
}
