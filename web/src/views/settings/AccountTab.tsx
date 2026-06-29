import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CloudOutlinedIcon from '@mui/icons-material/CloudOutlined';
import { ElevatedCard } from '../../components/ElevatedCard';
import { useAuth } from '../../lib/use-auth';
import { getSupabase } from '../../lib/supabase';
import { navigate } from '../../router';

export function AccountTab() {
  const auth = useAuth();
  const sb = getSupabase();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    if (!sb || signingOut) return;
    setSigningOut(true);
    try {
      await sb.auth.signOut({ scope: 'local' });
    } catch (e) {
      console.warn('sign-out failed:', e);
    } finally {
      navigate('/sign-in');
      setSigningOut(false);
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <ElevatedCard>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2.5 }}>
          <CloudOutlinedIcon sx={{ color: 'success.main', fontSize: 28 }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 500 }}>{auth.user?.email ?? 'Signed in'}</Typography>
            <Typography variant="caption" color="text.secondary">
              Synced across your devices
            </Typography>
          </Box>
          <Button variant="text" onClick={() => void signOut()} disabled={signingOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </Box>
      </ElevatedCard>

      <ElevatedCard>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2.5 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 500 }}>Password</Typography>
            <Typography variant="caption" color="text.secondary">
              Coming soon
            </Typography>
          </Box>
          <Button variant="text" disabled>Change password</Button>
        </Box>
      </ElevatedCard>
    </Box>
  );
}
