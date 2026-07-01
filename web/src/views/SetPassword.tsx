import { useState, type ReactNode, type FormEvent } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import { api } from '../api';
import { getUser, getBearer, setSession } from '../lib/session';
import { navigate } from '../router';

export function SetPassword() {
  const user = getUser();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) {
    navigate('/sign-in');
    return null;
  }
  if (user.hasPassword) {
    navigate('/');
    return null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.authSetPassword(password);
      const bearer = getBearer()!;
      setSession(bearer, { ...user!, hasPassword: true });
      navigate('/');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SetPasswordShell>
      <Paper sx={cardSx}>
        <Typography
          component="h1"
          sx={{
            fontSize: 40,
            fontWeight: 500,
            letterSpacing: '4px',
            lineHeight: 1,
            mb: 3,
            textAlign: 'center',
            color: 'text.primary',
          }}
        >
          <Box component="span" sx={{ color: 'primary.main' }}>&lt;</Box>
          canvas
          <Box component="span" sx={{ color: 'primary.main' }}>&gt;</Box>
        </Typography>

        <Typography variant="h6" sx={{ mb: 0.5, fontWeight: 600 }}>
          Set your password
        </Typography>
        <Typography variant="body2" sx={{ mb: 3, color: 'text.secondary' }}>
          Welcome, {user.label}. Choose a password to use for future sign-ins on any device.
        </Typography>

        <Box component="form" onSubmit={submit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="New password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
            disabled={busy}
            fullWidth
            autoComplete="new-password"
          />
          <TextField
            label="Confirm password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            disabled={busy}
            fullWidth
            autoComplete="new-password"
          />
          {error && <Alert severity="error" sx={{ py: 0.5 }}>{error}</Alert>}
          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={busy || !password || !confirm}
            sx={{ py: 1.5, fontSize: 15, fontWeight: 600 }}
          >
            {busy ? <CircularProgress size={22} color="inherit" /> : 'Save password'}
          </Button>
        </Box>
      </Paper>
    </SetPasswordShell>
  );
}

const cardSx = {
  width: '100%',
  maxWidth: 440,
  p: { xs: 3.5, sm: 5 },
  backgroundColor: 'background.paper',
  borderRadius: 3,
  border: '1px solid',
  borderColor: 'divider',
  boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
} as const;

function SetPasswordShell({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        width: '100%',
        backgroundColor: 'background.default',
        backgroundImage: `
          radial-gradient(ellipse 80% 50% at 20% 0%, rgba(79, 142, 247, 0.12), transparent 60%),
          radial-gradient(ellipse 60% 50% at 85% 100%, rgba(245, 166, 35, 0.06), transparent 60%)
        `,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        p: 3,
      }}
    >
      {children}
    </Box>
  );
}
