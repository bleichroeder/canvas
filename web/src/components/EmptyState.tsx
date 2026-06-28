import { type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';

export interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, body, actionLabel, onAction }: EmptyStateProps) {
  return (
    <Box
      sx={{
        p: 5, textAlign: 'center',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      }}
    >
      <Box sx={{ '& svg': { fontSize: 64, color: 'text.secondary' } }}>{icon}</Box>
      <Typography variant="h3">{title}</Typography>
      {body && <Typography color="text.secondary">{body}</Typography>}
      {actionLabel && onAction && (
        <Button variant="contained" onClick={onAction}>{actionLabel}</Button>
      )}
    </Box>
  );
}
