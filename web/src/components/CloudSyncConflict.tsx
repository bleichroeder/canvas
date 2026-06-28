import { useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import {
  getCloudSyncState,
  resolveConflictUseCloud,
  resolveConflictUseLocal,
  CLOUD_SYNC_EVENT,
} from '../lib/cloud-sync';

/**
 * Modal shown the first time a signed-in device discovers BOTH local sources
 * AND cloud sources exist. Forces an explicit choice rather than silently
 * dropping one set.
 */
export function CloudSyncConflict() {
  const [conflict, setConflict] = useState(getCloudSyncState().conflict);
  useEffect(() => {
    const onChange = () => setConflict(getCloudSyncState().conflict);
    window.addEventListener(CLOUD_SYNC_EVENT, onChange);
    return () => window.removeEventListener(CLOUD_SYNC_EVENT, onChange);
  }, []);

  if (!conflict) return null;
  const localCount = Object.keys(conflict.local).length;
  const cloudCount = Object.keys(conflict.cloud).length;

  return (
    <Dialog open onClose={undefined} maxWidth="xs" fullWidth>
      <DialogTitle>Merge sources?</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          You have sources both on this device and in your canvas account.
          Pick which set to keep — the other will be replaced.
        </DialogContentText>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Box sx={{ flex: 1, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1, textAlign: 'center' }}>
            <Box sx={{ fontSize: 32, fontWeight: 700 }}>{localCount}</Box>
            <Box sx={{ fontSize: 13, color: 'text.secondary' }}>on this device</Box>
          </Box>
          <Box sx={{ flex: 1, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1, textAlign: 'center' }}>
            <Box sx={{ fontSize: 32, fontWeight: 700 }}>{cloudCount}</Box>
            <Box sx={{ fontSize: 13, color: 'text.secondary' }}>in your account</Box>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ flexDirection: 'column', gap: 1, p: 2.5 }}>
        <Button fullWidth variant="contained" onClick={() => void resolveConflictUseCloud()}>
          Use account sources ({cloudCount})
        </Button>
        <Button fullWidth variant="outlined" onClick={() => void resolveConflictUseLocal()}>
          Use this device's sources ({localCount})
        </Button>
      </DialogActions>
    </Dialog>
  );
}
