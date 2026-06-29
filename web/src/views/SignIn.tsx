import { useEffect, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import CircularProgress from '@mui/material/CircularProgress';
import GoogleIcon from '@mui/icons-material/Google';
import { getSupabase } from '../lib/supabase';
import { useAuth } from '../lib/use-auth';
import { navigate } from '../router';

type Mode = 'sign-in' | 'sign-up';

export function SignIn() {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const sb = getSupabase();

  useEffect(() => {
    if (auth.user) navigate('/');
  }, [auth.user]);
  if (auth.user) return null;

  if (!sb) {
    return (
      <SignInShell>
        <Paper sx={cardSx}>
          <Alert severity="error">
            Authentication is not configured for this build. Contact the administrator.
          </Alert>
        </Paper>
      </SignInShell>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sb) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === 'sign-in') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate('/');
      } else {
        const { error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        setInfo('Check your email for a confirmation link, then sign in.');
        setMode('sign-in');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    if (!sb) return;
    setBusy(true);
    setError(null);
    try {
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
      // Browser is redirecting to Google; leave busy=true so the form stays
      // disabled during the hand-off.
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  function toggleMode() {
    setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
    setError(null);
    setInfo(null);
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

        <Button
          fullWidth
          variant="outlined"
          size="large"
          startIcon={<GoogleIcon />}
          onClick={signInWithGoogle}
          disabled={busy}
          sx={{
            py: 1.5,
            fontSize: 15,
            borderColor: 'divider',
            color: 'text.primary',
            '&:hover': { borderColor: 'primary.main', backgroundColor: 'rgba(79,142,247,0.06)' },
          }}
        >
          Continue with Google
        </Button>

        <Divider sx={{ my: 2.5, fontSize: 12, color: 'text.secondary' }}>or</Divider>

        <Box component="form" onSubmit={submit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            autoFocus
            disabled={busy}
            fullWidth
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            disabled={busy}
            fullWidth
          />
          {error && <Alert severity="error" sx={{ py: 0.5 }}>{error}</Alert>}
          {info && <Alert severity="success" sx={{ py: 0.5 }}>{info}</Alert>}
          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={busy || !email || !password}
            sx={{ py: 1.5, fontSize: 15, fontWeight: 600 }}
          >
            {busy ? <CircularProgress size={22} color="inherit" /> : (mode === 'sign-in' ? 'Sign in' : 'Create account')}
          </Button>
        </Box>

        <Box sx={{ mt: 2.5, textAlign: 'center' }}>
          <Button
            variant="text"
            onClick={toggleMode}
            disabled={busy}
            sx={{ fontSize: 13, color: 'text.secondary', textTransform: 'none' }}
          >
            {mode === 'sign-in'
              ? "Don't have an account? Create one"
              : 'Already have an account? Sign in'}
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
