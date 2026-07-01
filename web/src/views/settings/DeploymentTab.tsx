import { useState, useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Card from '@mui/material/Card';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { ElevatedCard } from '../../components/ElevatedCard';
import { api } from '../../api';

type DeployMode = 'cf-quick' | 'domain' | 'cf-named' | 'local';

interface DeploymentInfo {
  mode: string;
  domain: string | null;
  adminEmail: string | null;
  publicUrl: string | null;
  status: string;
  statusMessage: string | null;
  certExpiresAt: number | null;
  lastAppliedAt: number | null;
  hasCfNamedToken: boolean;
  externallyManaged: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function formatDate(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString();
}

function certWarning(certExpiresAt: number | null): boolean {
  if (!certExpiresAt) return false;
  const nowSec = Date.now() / 1000;
  const daysLeft = (certExpiresAt - nowSec) / 86400;
  return daysLeft < 14;
}

function statusColor(status: string): 'success' | 'warning' | 'error' | 'default' {
  if (status === 'ready') return 'success';
  if (status === 'applying' || status === 'pending') return 'warning';
  if (status === 'failed') return 'error';
  return 'default';
}

interface ModeCardProps {
  value: string;
  selected: boolean;
  title: string;
  desc: string;
  badge?: string;
  disabled?: boolean;
}

function ModeCard({ value, selected, title, desc, badge, disabled }: ModeCardProps) {
  return (
    <Card
      sx={{
        p: 0,
        borderRadius: 2,
        border: '1px solid',
        borderColor: selected ? 'primary.main' : 'divider',
        backgroundColor: selected ? 'rgba(79, 142, 247, 0.06)' : 'background.paper',
        transition: 'border-color 150ms, background-color 150ms',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <FormControlLabel
        value={value}
        control={<Radio sx={{ ml: 1 }} disabled={disabled} />}
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

export function DeploymentTab() {
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<DeploymentInfo | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Editable fields (pre-filled from current config)
  const [mode, setMode] = useState<DeployMode>('cf-quick');
  const [domain, setDomain] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [cfNamedToken, setCfNamedToken] = useState('');

  // Save flow
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [pollStatus, setPollStatus] = useState<string>('');

  // URL copy
  const [copied, setCopied] = useState(false);

  const abortRef = useRef(false);
  useEffect(() => {
    return () => { abortRef.current = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError(null);
    api.adminGetDeployment().then((data) => {
      if (cancelled) return;
      setInfo(data);
      setMode((data.mode as DeployMode) || 'cf-quick');
      setDomain(data.domain ?? '');
      setAdminEmail(data.adminEmail ?? '');
      // Don't pre-fill token — we never return it; hasCfNamedToken signals presence
      setCfNamedToken('');
      setLoading(false);
    }).catch((e) => {
      if (cancelled) return;
      setFetchError((e as Error).message ?? 'Failed to load deployment info.');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  async function copyUrl() {
    if (!info?.publicUrl) return;
    try {
      await navigator.clipboard.writeText(info.publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available — silently ignore
    }
  }

  function validate(): string | null {
    if (mode === 'domain' && domain.trim().length < 3) {
      return 'Enter a valid domain (e.g. canvas.example.com).';
    }
    if (mode === 'cf-named') {
      // If hasCfNamedToken is true and token field is empty, that's OK — we keep existing token.
      if (!info?.hasCfNamedToken && cfNamedToken.trim().length < 20) {
        return 'Paste the full Cloudflare tunnel token from your dashboard.';
      }
    }
    return null;
  }

  function handleSaveClick() {
    setSaveError(null);
    const err = validate();
    if (err) { setSaveError(err); return; }
    setConfirmOpen(true);
  }

  async function handleConfirm() {
    setConfirmOpen(false);
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    setPollStatus('Saving configuration…');

    try {
      const payload: Parameters<typeof api.adminSetDeployment>[0] = { mode };
      if (mode === 'domain') {
        payload.domain = domain.trim();
        if (adminEmail.trim()) payload.adminEmail = adminEmail.trim();
      }
      if (mode === 'cf-named' && cfNamedToken.trim()) {
        payload.cfNamedToken = cfNamedToken.trim();
      }

      await api.adminSetDeployment(payload);
      setPollStatus('Applying… container may restart for ~10 seconds.');
      abortRef.current = false;
      await runPollLoop();
    } catch (e) {
      setSaveError((e as Error).message ?? 'Failed to save deployment config.');
      setSaving(false);
      setPollStatus('');
    }
  }

  async function runPollLoop() {
    const MAX_ATTEMPTS = 60;
    let connectionErrors = 0;

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      if (abortRef.current) return;

      try {
        const status = await api.deploymentStatus();

        if (status.status === 'ready') {
          // Refresh full admin info to get updated URL, certExpiresAt, etc.
          try {
            const fresh = await api.adminGetDeployment();
            setInfo(fresh);
          } catch {
            // Non-fatal — update publicUrl at minimum
            setInfo((prev) => prev ? { ...prev, status: 'ready', publicUrl: status.publicUrl } : prev);
          }
          setSaveSuccess(true);
          setSaving(false);
          setPollStatus('');
          return;
        }

        if (status.status === 'failed') {
          setSaveError('Deployment failed. Check container logs, then try again.');
          setSaving(false);
          setPollStatus('');
          // Refresh info to show failure state
          try {
            const fresh = await api.adminGetDeployment();
            setInfo(fresh);
          } catch { /* ignore */ }
          return;
        }

        connectionErrors = 0;
        if (status.status === 'applying') {
          setPollStatus('Issuing TLS certificate…');
        } else {
          setPollStatus('Container restarting…');
        }
      } catch {
        connectionErrors++;
        if (connectionErrors === 1) {
          setPollStatus('Container restarting — waiting for it to come back up…');
        }
        if (connectionErrors > 15 && i > 20) {
          setSaveError('Canvas did not come back up in time. Check that the container is running and try again.');
          setSaving(false);
          setPollStatus('');
          return;
        }
      }

      await sleep(2000);
    }

    setSaveError('Timed out waiting for deployment. Check container logs and try again.');
    setSaving(false);
    setPollStatus('');
  }

  const isBusy = saving;
  const isApplyingOrPending = info?.status === 'applying' || info?.status === 'pending';
  const saveDisabled = isBusy || isApplyingOrPending || !!info?.externallyManaged;

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (fetchError) {
    return <Alert severity="error">{fetchError}</Alert>;
  }

  const externallyManaged = info?.externallyManaged ?? false;
  const showCertWarning = info?.mode === 'domain' && certWarning(info?.certExpiresAt ?? null);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Externally managed banner */}
      {externallyManaged && (
        <Alert severity="info" icon={<WarningAmberIcon />}>
          Deployment is managed externally (CANVAS_EXTERNAL_PROXY=1). Change these settings by editing your
          reverse-proxy config, not here.
        </Alert>
      )}

      {/* Status card */}
      {info && (
        <ElevatedCard>
          <Box sx={{ p: 2.5 }}>
            <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
              Current deployment
            </Typography>
            <Stack spacing={1.5}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography variant="body2" color="text.secondary" sx={{ minWidth: 120 }}>Mode</Typography>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {info.mode === 'cf-quick' && 'Cloudflare Quick Tunnel'}
                  {info.mode === 'domain' && 'Custom domain + Let\'s Encrypt'}
                  {info.mode === 'cf-named' && 'Cloudflare Named Tunnel'}
                  {info.mode === 'local' && 'Local only'}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography variant="body2" color="text.secondary" sx={{ minWidth: 120 }}>Status</Typography>
                <Chip
                  label={info.status}
                  size="small"
                  color={statusColor(info.status)}
                  variant="outlined"
                />
              </Box>
              {info.statusMessage && (
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, flexWrap: 'wrap' }}>
                  <Typography variant="body2" color="text.secondary" sx={{ minWidth: 120 }}>Message</Typography>
                  <Typography variant="body2" color="error.main">{info.statusMessage}</Typography>
                </Box>
              )}
              {info.publicUrl && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                  <Typography variant="body2" color="text.secondary" sx={{ minWidth: 120 }}>Public URL</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                    <Box
                      component="a"
                      href={info.publicUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{
                        color: 'primary.main',
                        textDecoration: 'none',
                        fontFamily: 'monospace',
                        fontSize: 13,
                        wordBreak: 'break-all',
                        '&:hover': { textDecoration: 'underline' },
                      }}
                    >
                      {info.publicUrl}
                    </Box>
                    <IconButton size="small" onClick={() => void copyUrl()} aria-label="Copy URL" sx={{ flexShrink: 0 }}>
                      {copied
                        ? <CheckIcon fontSize="small" sx={{ color: 'success.main' }} />
                        : <ContentCopyIcon fontSize="small" />
                      }
                    </IconButton>
                  </Box>
                </Box>
              )}
              {info.lastAppliedAt && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                  <Typography variant="body2" color="text.secondary" sx={{ minWidth: 120 }}>Last applied</Typography>
                  <Typography variant="body2">{formatDate(info.lastAppliedAt)}</Typography>
                </Box>
              )}
              {info.mode === 'domain' && info.certExpiresAt && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                  <Typography variant="body2" color="text.secondary" sx={{ minWidth: 120 }}>Cert expires</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2">{formatDate(info.certExpiresAt)}</Typography>
                    {showCertWarning && (
                      <Chip
                        label="Expiring soon"
                        size="small"
                        color="warning"
                        icon={<WarningAmberIcon />}
                      />
                    )}
                  </Box>
                </Box>
              )}
            </Stack>
          </Box>
        </ElevatedCard>
      )}

      {/* Mode picker + fields — hidden when externally managed */}
      {!externallyManaged && (
        <ElevatedCard>
          <Box sx={{ p: 2.5 }}>
            <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
              Change deployment mode
            </Typography>

            {isApplyingOrPending && (
              <Alert severity="info" sx={{ mb: 2 }}>
                A deployment is already in progress. Wait for it to finish before changing the mode.
              </Alert>
            )}

            <RadioGroup value={mode} onChange={(e) => setMode(e.target.value as DeployMode)}>
              <Stack spacing={1.5}>
                <ModeCard
                  value="cf-quick"
                  selected={mode === 'cf-quick'}
                  title="Cloudflare Quick Tunnel"
                  badge="Recommended"
                  desc="Instantly get a public HTTPS URL — no signup, no domain, no port forwarding. URL may change on container restarts."
                  disabled={isBusy || isApplyingOrPending}
                />
                <ModeCard
                  value="domain"
                  selected={mode === 'domain'}
                  title="Custom domain + Let's Encrypt"
                  desc="Requires a domain pointing at this machine's public IP with ports 80 and 443 forwarded. Stable URL."
                  disabled={isBusy || isApplyingOrPending}
                />
                <ModeCard
                  value="cf-named"
                  selected={mode === 'cf-named'}
                  title="Cloudflare Named Tunnel"
                  desc="Bring your own tunnel token from the Cloudflare dashboard for a stable URL without port forwarding."
                  disabled={isBusy || isApplyingOrPending}
                />
                <ModeCard
                  value="local"
                  selected={mode === 'local'}
                  title="Local only"
                  desc="Accessible from this machine or LAN only (http://localhost:8787/). No public URL."
                  disabled={isBusy || isApplyingOrPending}
                />
              </Stack>
            </RadioGroup>

            {/* Mode-specific fields */}
            {mode === 'domain' && (
              <Stack spacing={2} sx={{ mt: 2 }}>
                <TextField
                  label="Domain (e.g. canvas.example.com)"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  disabled={isBusy || isApplyingOrPending}
                  fullWidth
                  size="small"
                  inputProps={{ spellCheck: false, autoCapitalize: 'none', autoCorrect: 'off' }}
                />
                <TextField
                  label="Admin email (optional — used for Let's Encrypt expiry notices)"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  disabled={isBusy || isApplyingOrPending}
                  fullWidth
                  size="small"
                  type="email"
                />
              </Stack>
            )}
            {mode === 'cf-named' && (
              <TextField
                label="Tunnel token"
                value={cfNamedToken}
                onChange={(e) => setCfNamedToken(e.target.value)}
                disabled={isBusy || isApplyingOrPending}
                fullWidth
                size="small"
                multiline
                rows={3}
                placeholder={
                  info?.hasCfNamedToken
                    ? 'Token already configured — leave blank to keep'
                    : 'Paste your Cloudflare tunnel token'
                }
                inputProps={{ spellCheck: false, autoCapitalize: 'none', autoCorrect: 'off', style: { fontFamily: 'monospace', fontSize: 13 } }}
                helperText="Paste the full token from Cloudflare dashboard → Zero Trust → Tunnels"
                sx={{ mt: 2 }}
              />
            )}

            {saveError && <Alert severity="error" sx={{ mt: 2 }}>{saveError}</Alert>}
            {saveSuccess && (
              <Alert severity="success" sx={{ mt: 2 }}>
                Deployment updated successfully.
              </Alert>
            )}

            {/* Polling status during apply */}
            {isBusy && pollStatus && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2 }}>
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary">{pollStatus}</Typography>
              </Box>
            )}

            <Button
              variant="contained"
              onClick={handleSaveClick}
              disabled={saveDisabled}
              sx={{ mt: 2.5, alignSelf: 'flex-start' }}
            >
              {isBusy ? 'Applying…' : 'Save and apply'}
            </Button>
          </Box>
        </ElevatedCard>
      )}

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onClose={() => !saving && setConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Apply deployment change?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            This will restart canvas for ~10 seconds; sessions will briefly disconnect. Continue?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={() => void handleConfirm()} disabled={saving}>
            {saving ? 'Applying…' : 'Continue'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
