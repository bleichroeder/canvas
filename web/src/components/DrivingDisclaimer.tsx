import { useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import DirectionsCarFilledOutlinedIcon from '@mui/icons-material/DirectionsCarFilledOutlined';
import Box from '@mui/material/Box';
import { useAuth } from '../lib/use-auth';

interface DrivingDisclaimerProps {
  /**
   * Whether the current route is a public (non-auth-gated) route. Phone-side
   * /pair and /sign-in surfaces don't need a driving disclaimer — they're
   * not the in-vehicle app surface.
   */
  isPublicRoute: boolean;
}

/**
 * Blocking modal shown once per cold app load, the first time the
 * authenticated user lands on an app screen. Dismisses with an explicit
 * "I understand" tap. In-memory state — page reload re-prompts.
 *
 * Resets on sign-out so a fresh sign-in re-prompts.
 */
export function DrivingDisclaimer({ isPublicRoute }: DrivingDisclaimerProps) {
  const auth = useAuth();
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!auth.user) setAcknowledged(false);
  }, [auth.user]);

  const open = !!auth.user && !isPublicRoute && !acknowledged;

  return (
    <Dialog
      open={open}
      onClose={undefined}
      maxWidth="xs"
      fullWidth
      disableEscapeKeyDown
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1 }}>
        <Box
          sx={{
            width: 40, height: 40, borderRadius: '50%',
            backgroundColor: 'rgba(245, 166, 35, 0.15)',
            color: 'secondary.main',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <DirectionsCarFilledOutlinedIcon />
        </Box>
        Drive safe
      </DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ color: 'text.primary' }}>
          canvas is for parked passengers only. Don't use it while driving. You're
          responsible for the safe operation of your vehicle.
        </DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button
          fullWidth
          variant="contained"
          size="large"
          onClick={() => setAcknowledged(true)}
          sx={{ py: 1.5, fontSize: 15, fontWeight: 600 }}
        >
          I understand
        </Button>
      </DialogActions>
    </Dialog>
  );
}
