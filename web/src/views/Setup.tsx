import { useState, useEffect, useRef, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Card from '@mui/material/Card';
import IconButton from '@mui/material/IconButton';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import { api } from '../api';
import { setSession } from '../lib/session';
import { navigate } from '../router';

type Step = 'admin' | 'mode' | 'applying' | 'done';
type Mode = 'cf-quick' | 'domain' | 'cf-named' | 'local';

function defaultDeviceName(): string {
  const ua = navigator.userAgent;
  if (/Tesla/i.test(ua)) return 'Tesla';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/Android/i.test(ua)) return 'Android';
  return 'Web';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function Setup() {
  const [step, setStep] = useState<Step>('admin');
  const [error, setError] = useState<string | null>(null);

  // Step 1 — admin account
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);

  // Step 2 — deployment mode
  const [mode, setMode] = useState<Mode>('cf-quick');
  const [domain, setDomain] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [cfNamedToken, setCfNamedToken] = useState('');

  // Step 3/4 — applying + done
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [pollStatus, setPollStatus] = useState<string>('Waiting for container…');
  const [copied, setCopied] = useState(false);

  // Abort flag for polling when component unmounts
  const abortRef = useRef(false);
  useEffect(() => {
    return () => { abortRef.current = true; };
  }, []);

  async function submitAdmin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (adminUsername.trim().length < 2) {
      setError('Username must be at least 2 characters.');
      return;
    }
    if (adminPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (adminPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.setup(adminUsername.trim(), adminPassword, defaultDeviceName());
      setSession(res.bearer, res.user);
      setStep('mode');
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('403') || msg.toLowerCase().includes('trusted host') || msg.toLowerCase().includes('loopback') || msg.toLowerCase().includes('lan')) {
        setError('Canvas can only be set up from the same machine or LAN. Open this page from the host running the Canvas container.');
      } else if (msg.includes('409') || msg.toLowerCase().includes('already complete')) {
        setError('Setup is already complete. Please sign in instead.');
      } else {
        setError(msg || 'Setup failed. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitMode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === 'domain' && domain.trim().length < 3) {
      setError('Enter a valid domain (e.g. canvas.example.com).');
      return;
    }
    if (mode === 'cf-named' && cfNamedToken.trim().length < 20) {
      setError('Paste the full Cloudflare tunnel token from your dashboard.');
      return;
    }
    setBusy(true);
    try {
      await api.adminSetDeployment({
        mode,
        ...(mode === 'domain' && { domain: domain.trim(), ...(adminEmail.trim() ? { adminEmail: adminEmail.trim() } : {}) }),
        ...(mode === 'cf-named' && { cfNamedToken: cfNamedToken.trim() }),
      });
      setStep('applying');
      startPolling();
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('409') || msg.toLowerCase().includes('externally managed')) {
        setError('Deployment is externally managed (CANVAS_EXTERNAL_PROXY is set). Skip this step.');
      } else {
        setError(msg || 'Failed to apply deployment config. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  function startPolling() {
    abortRef.current = false;
    void runPollLoop();
  }

  async function runPollLoop() {
    // local mode: no container restart is needed; publicUrl is always null.
    // The loop still polls to confirm status=ready.
    const MAX_ATTEMPTS = 60; // 60 × 2s = 2 minutes
    let connectionErrors = 0;

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      if (abortRef.current) return;

      try {
        const status = await api.deploymentStatus();

        if (status.status === 'ready') {
          setPublicUrl(status.publicUrl);
          setStep('done');
          return;
        }

        if (status.status === 'failed') {
          setError('Deployment failed. Check container logs, then choose a different mode or try again.');
          setStep('mode');
          return;
        }

        // status === 'pending' | 'applying' — keep waiting
        connectionErrors = 0;
        if (status.status === 'applying') {
          setPollStatus('Issuing TLS certificate…');
        } else {
          setPollStatus('Container is restarting…');
        }
      } catch {
        // Connection refused / timeout = container is mid-restart. This is
        // expected. We tolerate up to ~30s (15 consecutive errors × 2s) before
        // giving up; after that, if polling resumes, reset the counter.
        connectionErrors++;
        if (connectionErrors === 1) {
          setPollStatus('Container restarting — waiting for it to come back up…');
        }
        if (connectionErrors > 15 && i > 20) {
          // Only hard-fail on connection errors if we're past the initial
          // restart window AND still seeing errors.
          setError('Canvas did not come back up in time. Check that the container is running and try again.');
          setStep('mode');
          return;
        }
      }

      await sleep(2000);
    }

    // Timed out after 2 minutes.
    setError('Timed out waiting for deployment. Check container logs and try again.');
    setStep('mode');
  }

  async function copyUrl() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available — ignore silently
    }
  }

  return (
    <SetupShell>
      <Paper sx={cardSx}>
        {/* Wordmark — matches Claim.tsx / SignIn.tsx */}
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

        {/* Step 1 — Admin account creation */}
        {step === 'admin' && (
          <Box component="form" onSubmit={submitAdmin} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="h3" sx={{ mb: 0.5 }}>Create your admin account</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              This is the first and only time you can do this. Choose a strong password.
            </Typography>

            <TextField
              label="Username"
              value={adminUsername}
              onChange={(e) => setAdminUsername(e.target.value)}
              autoFocus
              required
              disabled={busy}
              fullWidth
              autoComplete="username"
              inputProps={{ spellCheck: false, autoCapitalize: 'none', autoCorrect: 'off' }}
            />
            <TextField
              label="Password"
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              required
              disabled={busy}
              fullWidth
              autoComplete="new-password"
              helperText="At least 8 characters"
            />
            <TextField
              label="Confirm password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
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
              disabled={busy || !adminUsername.trim() || !adminPassword || !confirmPassword}
              sx={{ py: 1.5, fontSize: 15, fontWeight: 600 }}
            >
              {busy ? <CircularProgress size={22} color="inherit" /> : 'Create account'}
            </Button>
          </Box>
        )}

        {/* Step 2 — Deployment mode picker */}
        {step === 'mode' && (
          <Box component="form" onSubmit={submitMode} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="h3" sx={{ mb: 0.5 }}>How will you access Canvas?</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Choose how Canvas publishes itself. You can change this later in Settings.
            </Typography>

            <RadioGroup value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <Stack spacing={1.5}>
                <ModeCard
                  value="cf-quick"
                  selected={mode === 'cf-quick'}
                  title="Cloudflare Quick Tunnel"
                  badge="Recommended"
                  desc="Instantly get a public HTTPS URL — no signup, no domain, no port forwarding. URL may change on container restarts."
                />
                <ModeCard
                  value="domain"
                  selected={mode === 'domain'}
                  title="Custom domain + Let's Encrypt"
                  desc="Requires a domain pointing at this machine's public IP with ports 80 and 443 forwarded. Stable URL."
                />
                <ModeCard
                  value="cf-named"
                  selected={mode === 'cf-named'}
                  title="Cloudflare Named Tunnel"
                  desc="Bring your own tunnel token from the Cloudflare dashboard for a stable URL without port forwarding."
                />
                <ModeCard
                  value="local"
                  selected={mode === 'local'}
                  title="Local only"
                  desc="Accessible from this machine or LAN only (http://localhost:8787/). No public URL."
                />
              </Stack>
            </RadioGroup>

            {/* Mode-specific fields */}
            {mode === 'domain' && (
              <Stack spacing={2} sx={{ mt: 1 }}>
                <TextField
                  label="Domain (e.g. canvas.example.com)"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  autoFocus
                  disabled={busy}
                  fullWidth
                  inputProps={{ spellCheck: false, autoCapitalize: 'none', autoCorrect: 'off' }}
                />
                <TextField
                  label="Admin email (optional — used for Let's Encrypt expiry notices)"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  disabled={busy}
                  fullWidth
                  type="email"
                />
              </Stack>
            )}
            {mode === 'cf-named' && (
              <TextField
                label="Tunnel token"
                value={cfNamedToken}
                onChange={(e) => setCfNamedToken(e.target.value)}
                autoFocus
                disabled={busy}
                fullWidth
                multiline
                rows={3}
                inputProps={{ spellCheck: false, autoCapitalize: 'none', autoCorrect: 'off', style: { fontFamily: 'monospace', fontSize: 13 } }}
                helperText="Paste the full token from Cloudflare dashboard → Zero Trust → Tunnels"
                sx={{ mt: 1 }}
              />
            )}

            {error && <Alert severity="error" sx={{ py: 0.5 }}>{error}</Alert>}

            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={busy}
              sx={{ py: 1.5, fontSize: 15, fontWeight: 600 }}
            >
              {busy ? <CircularProgress size={22} color="inherit" /> : 'Apply and continue'}
            </Button>
          </Box>
        )}

        {/* Step 3 — Applying / container restarting */}
        {step === 'applying' && (
          <Stack spacing={3} alignItems="center" sx={{ py: 2 }}>
            <CircularProgress size={48} />
            <Typography variant="body1" sx={{ textAlign: 'center' }}>
              Applying deployment configuration…
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
              {pollStatus}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center', maxWidth: 360 }}>
              The container will restart. This takes a few seconds for most modes; up to 30 seconds if a TLS certificate is being issued.
            </Typography>
          </Stack>
        )}

        {/* Step 4 — Done */}
        {step === 'done' && (
          <Stack spacing={2}>
            <Typography variant="h3">Canvas is ready.</Typography>

            {publicUrl ? (
              <>
                <Typography variant="body2" color="text.secondary">
                  Your Canvas instance is accessible at:
                </Typography>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    p: 2,
                    bgcolor: 'surface.elevated',
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: 'divider',
                    wordBreak: 'break-all',
                  }}
                >
                  <Box
                    component="a"
                    href={publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{
                      flex: 1,
                      color: 'primary.main',
                      textDecoration: 'none',
                      fontFamily: 'monospace',
                      fontSize: 14,
                      '&:hover': { textDecoration: 'underline' },
                    }}
                  >
                    {publicUrl}
                  </Box>
                  <IconButton
                    size="small"
                    onClick={() => void copyUrl()}
                    aria-label="Copy URL"
                    sx={{ flexShrink: 0 }}
                  >
                    {copied ? <CheckIcon fontSize="small" sx={{ color: 'success.main' }} /> : <ContentCopyIcon fontSize="small" />}
                  </IconButton>
                </Box>
              </>
            ) : (
              <>
                <Typography variant="body2" color="text.secondary">
                  Canvas is running in local mode. It's accessible from this machine and your LAN at:
                </Typography>
                <Box
                  sx={{
                    p: 2,
                    bgcolor: 'surface.elevated',
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  <Box
                    component="a"
                    href="http://localhost:8787/"
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{
                      color: 'primary.main',
                      textDecoration: 'none',
                      fontFamily: 'monospace',
                      fontSize: 14,
                      '&:hover': { textDecoration: 'underline' },
                    }}
                  >
                    http://localhost:8787/
                  </Box>
                </Box>
              </>
            )}

            <Button
              variant="contained"
              size="large"
              // Wizard's step 1 already called setSession(bearer, user), so the
              // user is signed in — send them straight to Home, not /sign-in.
              onClick={() => navigate('/')}
              sx={{ py: 1.5, fontSize: 15, fontWeight: 600, mt: 1 }}
            >
              Continue to canvas
            </Button>
          </Stack>
        )}
      </Paper>
    </SetupShell>
  );
}

const cardSx = {
  width: '100%',
  maxWidth: 500,
  p: { xs: 3.5, sm: 5 },
  backgroundColor: 'background.paper',
  borderRadius: 3,
  border: '1px solid',
  borderColor: 'divider',
  boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
} as const;

function SetupShell({ children }: { children: ReactNode }) {
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

interface ModeCardProps {
  value: string;
  selected: boolean;
  title: string;
  desc: string;
  badge?: string;
}

function ModeCard({ value, selected, title, desc, badge }: ModeCardProps) {
  return (
    <Card
      sx={{
        p: 0,
        borderRadius: 2,
        border: '1px solid',
        borderColor: selected ? 'primary.main' : 'divider',
        backgroundColor: selected ? 'rgba(79, 142, 247, 0.06)' : 'background.paper',
        transition: 'border-color 150ms, background-color 150ms',
        cursor: 'pointer',
      }}
    >
      <FormControlLabel
        value={value}
        control={<Radio sx={{ ml: 1 }} />}
        label={
          <Box sx={{ py: 1.5, pr: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body1" sx={{ fontWeight: 600 }}>{title}</Typography>
              {badge && (
                <Box
                  component="span"
                  sx={{
                    px: 1,
                    py: 0.25,
                    borderRadius: 1,
                    bgcolor: 'primary.main',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.5px',
                    lineHeight: 1.6,
                  }}
                >
                  {badge}
                </Box>
              )}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {desc}
            </Typography>
          </Box>
        }
        sx={{ width: '100%', m: 0, alignItems: 'flex-start' }}
      />
    </Card>
  );
}
