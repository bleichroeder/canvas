import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import PersonOutlinedIcon from '@mui/icons-material/PersonOutlined';
import { ElevatedCard } from '../../components/ElevatedCard';
import { getUser, clearSession } from '../../lib/session';
import { api } from '../../api';
import { navigate } from '../../router';

export function AccountTab() {
  const user = getUser();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await api.authLogout();
    } catch (e) {
      console.warn('sign-out failed:', e);
    } finally {
      clearSession();
      navigate('/claim');
      setSigningOut(false);
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
    </Box>
  );
}
