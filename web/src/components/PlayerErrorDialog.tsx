import { useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import DialogContentText from '@mui/material/DialogContentText';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';

interface PlayerErrorDialogProps {
  open: boolean;
  message: string;
  sessionId: string;
  onRetry(): void;
  onShowDiagnostics(): void;
  onBackToBrowse(): void;
}

export function PlayerErrorDialog(p: PlayerErrorDialogProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  return (
    <Dialog
      open={p.open}
      onClose={() => { /* not dismissable — playback is broken; force a decision */ }}
      disableEscapeKeyDown
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>Playback error</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 1 }}>
          {p.message}
        </DialogContentText>
        <Box sx={{ mt: 2 }}>
          <IconButton
            size="small"
            onClick={() => setDetailsOpen((v) => !v)}
            sx={{ mr: 1 }}
            aria-label={detailsOpen ? 'Hide details' : 'Show details'}
          >
            {detailsOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
          <Typography
            component="span"
            variant="body2"
            color="text.secondary"
            sx={{ cursor: 'pointer' }}
            onClick={() => setDetailsOpen((v) => !v)}
          >
            {detailsOpen ? 'Hide details' : 'Show details'}
          </Typography>
          <Collapse in={detailsOpen}>
            <Box
              sx={{
                mt: 1.5, p: 1.5,
                fontFamily: 'monospace', fontSize: 12,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                backgroundColor: 'background.default',
                border: 1, borderColor: 'divider',
                borderRadius: 1,
              }}
            >
              {p.message}
              {'\n'}
              session: {p.sessionId}
            </Box>
          </Collapse>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={p.onBackToBrowse}>Back to browse</Button>
        <Button onClick={p.onShowDiagnostics}>Show diagnostics</Button>
        <Button onClick={p.onRetry} variant="contained">Retry</Button>
      </DialogActions>
    </Dialog>
  );
}
