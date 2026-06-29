import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

interface SettingRowProps {
  label: string;
  secondary?: string;
  control?: ReactNode;
  divider?: boolean;
}

export function SettingRow({ label, secondary, control, divider = true }: SettingRowProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
        minHeight: 56,
        py: 2.25,
        px: 2.5,
        borderBottom: divider ? '1px solid rgba(255,255,255,0.06)' : 'none',
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontWeight: 500, fontSize: 15 }}>{label}</Typography>
        {secondary && (
          <Typography sx={{ mt: 0.25, fontSize: 12, color: 'text.secondary' }}>{secondary}</Typography>
        )}
      </Box>
      {control && <Box sx={{ flexShrink: 0 }}>{control}</Box>}
    </Box>
  );
}
