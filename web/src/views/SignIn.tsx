import { useState, type ReactNode, type FormEvent } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import { api } from '../api';
import { setSession } from '../lib/session';
import { navigate } from '../router';

function defaultDeviceName(): string {
  const ua = navigator.userAgent;
  if (/Tesla/i.test(ua)) return 'Tesla';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/Android/i.test(ua)) return 'Android';
  return 'Web';
}

export function SignIn() {
  const [label, setLabel] = useState('');
  const [password, setPassword] = useState('');
  const [deviceLabel, setDeviceLabel] = useState(defaultDeviceName());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.authLogin(
        label.trim(),
        password,
        deviceLabel.trim() || defaultDeviceName(),
      );
      setSession(res.bearer, res.user);
      if (!res.user.hasPassword) {
        navigate('/set-password');
      } else {
        navigate('/');
      }
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (msg.includes('401') || msg.toLowerCase().includes('invalid-credentials') || msg.toLowerCase().includes('invalid credentials')) {
        setError('Invalid username or password.');
      } else if (msg.includes('400') || msg.toLowerCase().includes('password-not-set') || msg.toLowerCase().includes('password not set')) {
        setError('This account does not have a password yet. Use a claim token or ask the admin to reset.');
      } else {
        setError(`Sign in failed: ${msg}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <SignInShell>
      <Paper sx={cardSx}>
        <Typography
          component="h1"
          sx={{
            fontSize: 40,
            fontWeight: 500,
            letterSpacing: '4px',
            lineHeight: 1,
            mb: 4,
            textAlign: 'center',
            color: 'text.primary',
          }}
        >
          <Box component="span" sx={{ color: 'primary.main' }}>&lt;</Box>
          canvas
          <Box component="span" sx={{ color: 'primary.main' }}>&gt;</Box>
        </Typography>

        <Box component="form" onSubmit={submit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Username"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            autoFocus
            disabled={busy}
            fullWidth
            autoComplete="username"
            inputProps={{ spellCheck: false, autoCapitalize: 'none', autoCorrect: 'off' }}
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={busy}
            fullWidth
            autoComplete="current-password"
          />
          <TextField
            label="Device name"
            value={deviceLabel}
            onChange={(e) => setDeviceLabel(e.target.value)}
            disabled={busy}
            fullWidth
            helperText="Helps identify this session in account settings"
          />
          {error && <Alert severity="error" sx={{ py: 0.5 }}>{error}</Alert>}
          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={busy || !label.trim() || !password}
            sx={{ py: 1.5, fontSize: 15, fontWeight: 600 }}
          >
            {busy ? <CircularProgress size={22} color="inherit" /> : 'Sign in'}
          </Button>
          <Button
            variant="text"
            size="small"
            disabled={busy}
            onClick={() => navigate('/claim')}
            sx={{ color: 'text.secondary' }}
          >
            I have a claim token
          </Button>
        </Box>
      </Paper>
    </SignInShell>
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

function SignInShell({ children }: { children: ReactNode }) {
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
