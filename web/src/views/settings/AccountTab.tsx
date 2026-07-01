import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import PersonOutlinedIcon from '@mui/icons-material/PersonOutlined';
import { ElevatedCard } from '../../components/ElevatedCard';
import { getUser, clearSession } from '../../lib/session';
import { api } from '../../api';
import { navigate } from '../../router';

export function AccountTab() {
  const user = getUser();
  const [signingOut, setSigningOut] = useState(false);

  // Change password state
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await api.authLogout();
    } catch (e) {
      console.warn('sign-out failed:', e);
    } finally {
      clearSession();
      navigate('/sign-in');
      setSigningOut(false);
    }
  }

  async function handleChangePassword() {
    setPwError(null);
    setPwSuccess(false);
    if (!currentPw) {
      setPwError('Current password is required.');
      return;
    }
    if (newPw.length < 8) {
      setPwError('New password must be at least 8 characters.');
      return;
    }
    if (newPw !== confirmPw) {
      setPwError('New passwords do not match.');
      return;
    }
    setPwBusy(true);
    try {
      await api.authChangePassword(currentPw, newPw);
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      setPwSuccess(true);
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (msg.includes('401')) {
        setPwError('Current password is incorrect.');
      } else if (msg.includes('409')) {
        setPwError("You haven't set a password yet — use the initial setup flow.");
      } else {
        setPwError('Failed to change password. Please try again.');
      }
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <ElevatedCard>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2.5 }}>
          <PersonOutlinedIcon sx={{ color: 'primary.main', fontSize: 28 }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 500 }}>{user?.label ?? 'Signed in'}</Typography>
            <Typography variant="caption" color="text.secondary">
              {user?.role === 'admin' ? 'Administrator' : 'Member'}
            </Typography>
          </Box>
          <Button variant="text" onClick={() => void signOut()} disabled={signingOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </Box>
      </ElevatedCard>

      <ElevatedCard>
        <Box sx={{ p: 2.5 }}>
          <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
            Change password
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              fullWidth
              size="small"
              label="Current password"
              type="password"
              autoComplete="current-password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              disabled={pwBusy}
            />
            <TextField
              fullWidth
              size="small"
              label="New password"
              type="password"
              autoComplete="new-password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              disabled={pwBusy}
            />
            <TextField
              fullWidth
              size="small"
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              disabled={pwBusy}
            />
            {pwError && <Alert severity="error">{pwError}</Alert>}
            {pwSuccess && (
              <Alert severity="success">Password changed. Other devices have been signed out.</Alert>
            )}
            <Button
              variant="contained"
              onClick={() => void handleChangePassword()}
              disabled={pwBusy}
              sx={{ alignSelf: 'flex-start' }}
            >
              {pwBusy ? 'Changing…' : 'Change password'}
            </Button>
          </Box>
        </Box>
      </ElevatedCard>
    </Box>
  );
}
