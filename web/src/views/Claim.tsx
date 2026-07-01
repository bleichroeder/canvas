import { useState, type ReactNode } from 'react';
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

export function Claim() {
  const [token, setToken] = useState('');
  const [deviceLabel, setDeviceLabel] = useState(defaultDeviceName());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.authClaim(token.trim(), deviceLabel.trim() || defaultDeviceName());
      setSession(res.bearer, res.user);
      if (!res.user.hasPassword) {
        navigate('/set-password');
      } else {
        navigate('/');
      }
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('unauthorized') || msg.includes('410') || msg.includes('invalid or expired')) {
        setError('Invalid or expired claim token. Ask the admin to regenerate it.');
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <ClaimShell>
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
            label="Claim token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
            autoFocus
            disabled={busy}
            fullWidth
            placeholder="Paste token from admin"
            inputProps={{ spellCheck: false, autoCapitalize: 'none', autoCorrect: 'off' }}
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
            disabled={busy || !token.trim()}
            sx={{ py: 1.5, fontSize: 15, fontWeight: 600 }}
          >
            {busy ? <CircularProgress size={22} color="inherit" /> : 'Sign in'}
          </Button>
        </Box>
      </Paper>
    </ClaimShell>
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

function ClaimShell({ children }: { children: ReactNode }) {
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
