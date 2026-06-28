import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import CircularProgress from '@mui/material/CircularProgress';
import GoogleIcon from '@mui/icons-material/Google';
import { AppShell } from '../components/AppShell';
import { getSupabase, isSupabaseConfigured } from '../lib/supabase';
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

  // If we're already signed in, the page is meaningless — kick back to home.
  if (auth.user) {
    navigate('/');
    return null;
  }

  if (!isSupabaseConfigured() || !sb) {
    return (
      <AppShell>
        <Box sx={{ p: 4, maxWidth: 480, mx: 'auto' }}>
          <Alert severity="warning">
            Cloud sync is not configured in this build. Sources stay local to this browser.
          </Alert>
        </Box>
      </AppShell>
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
        setInfo('Check your email for a confirmation link.');
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
      // Browser will redirect to Google; no further action here.
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <Box sx={{ p: 4, maxWidth: 480, mx: 'auto' }}>
        <Typography variant="h1" sx={{ mb: 1 }}>
          {mode === 'sign-in' ? 'Sign in' : 'Create account'}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          {mode === 'sign-in'
            ? 'Sign in to sync your sources across devices.'
            : 'Create a canvas account to sync your sources across devices.'}
        </Typography>

        <Button
          fullWidth
          variant="outlined"
          size="large"
          startIcon={<GoogleIcon />}
          onClick={signInWithGoogle}
          disabled={busy}
          sx={{ mb: 2 }}
        >
          Continue with Google
        </Button>

        <Divider sx={{ my: 2 }}>or</Divider>

        <Box component="form" onSubmit={submit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            disabled={busy}
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            disabled={busy}
          />
          {error && <Alert severity="error">{error}</Alert>}
          {info && <Alert severity="info">{info}</Alert>}
          <Button type="submit" variant="contained" size="large" disabled={busy || !email || !password}>
            {busy ? <CircularProgress size={20} /> : (mode === 'sign-in' ? 'Sign in' : 'Create account')}
          </Button>
        </Box>

        <Box sx={{ mt: 3, textAlign: 'center' }}>
          <Button
            variant="text"
            onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setError(null); setInfo(null); }}
            disabled={busy}
          >
            {mode === 'sign-in'
              ? "Don't have an account? Create one"
              : 'Already have an account? Sign in'}
          </Button>
        </Box>
      </Box>
    </AppShell>
  );
}
