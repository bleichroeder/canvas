import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { ElevatedCard } from '../../components/ElevatedCard';
import { SettingRow } from '../../components/SettingRow';
import { getUser } from '../../lib/session';
import { getCrashLog, clearCrashLog } from '../../lib/crash-telemetry';
import { api } from '../../api';
import type { CrashRecord } from '../../lib/crash-telemetry';

// Configure marked once at module load.
marked.setOptions({
  gfm: true,
  breaks: true,
});

function renderReleaseNotes(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(html);
}

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

function formatTimestamp(ms: number): string {
  try { return new Date(ms).toLocaleString(); } catch { return String(ms); }
}

function CrashRow({ record }: { record: CrashRecord }) {
  const durationSec = Math.max(0, Math.round((record.crashedAt - record.startedAt) / 1000));
  const durationMin = Math.floor(durationSec / 60);
  const durationLabel = durationMin > 0 ? `${durationMin}m ${durationSec % 60}s` : `${durationSec}s`;
  return (
    <Box sx={{ py: 1, borderBottom: '1px solid rgba(255,255,255,0.06)', '&:last-child': { borderBottom: 'none' } }}>
      <Typography sx={{ fontSize: 13, fontWeight: 500 }}>
        {record.source} / {record.id}
      </Typography>
      <Typography sx={{ fontSize: 11, color: 'text.secondary', fontFamily: 'monospace' }}>
        {formatTimestamp(record.crashedAt)} · played {durationLabel}
        {` · pos ${record.posSec}s`}
        {record.heapMB !== undefined && ` · heap ${record.heapMB} MB`}
        {record.droppedFrames !== undefined && record.droppedFrames > 0 && ` · ${record.droppedFrames} frames dropped`}
      </Typography>
    </Box>
  );
}

export function AboutTab() {
  const user = getUser();
  const [diagOpen, setDiagOpen] = useState(false);
  const [crashes, setCrashes] = useState<CrashRecord[]>(() => getCrashLog());
  const buildSha = import.meta.env.VITE_BUILD_SHA ?? 'dev';
  const canvasVersion = import.meta.env.VITE_CANVAS_VERSION ?? 'dev';

  const [updates, setUpdates] = useState<Awaited<ReturnType<typeof api.adminUpdates.status>> | null>(null);
  const [updatesLoading, setUpdatesLoading] = useState(true);

  const [prefs, setPrefs] = useState<{ autoUpdate: boolean; lastAutoCheckAt: number | null; watchtowerReachable: boolean } | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.adminUpdates.status()
      .then((s) => { if (!cancelled) setUpdates(s); })
      .catch(() => { if (!cancelled) setUpdates(null); })
      .finally(() => { if (!cancelled) setUpdatesLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.adminUpdates.preferences()
      .then((p) => { if (!cancelled) setPrefs(p); })
      .catch(() => { if (!cancelled) setPrefs(null); });
    return () => { cancelled = true; };
  }, []);

  async function togglePref(next: boolean): Promise<void> {
    try {
      const updated = await api.adminUpdates.updatePreferences({ autoUpdate: next });
      setPrefs(updated);
    } catch (err) {
      // Best-effort revert on error
      console.error('failed to toggle auto-update:', err);
    }
  }

  async function applyUpdate(): Promise<void> {
    setApplying(true);
    setApplyError(null);
    try {
      await api.adminUpdates.apply();
      // Canvas will die within seconds; browser will lose connection.
      // Leave the dialog open with a "Restarting…" note.
    } catch (err) {
      setApplyError((err as Error).message);
      setApplying(false);
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <ElevatedCard>
        <SettingRow label="Version" control={<Typography color="text.secondary">{canvasVersion} · build {buildSha}</Typography>} />
        <SettingRow label="Player engine" control={<Typography color="text.secondary">canvas / WebCodecs</Typography>} />
        <SettingRow
          label="Signed in as"
          divider={false}
          control={
            <Typography color="text.secondary">
              {user ? `${user.label} (${user.role})` : 'Not signed in'}
            </Typography>
          }
        />
      </ElevatedCard>

      <ElevatedCard>
        <Box sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>Updates</Typography>

          {updatesLoading && (
            <Typography color="text.secondary">Checking for updates…</Typography>
          )}

          {!updatesLoading && updates?.error && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Update information unavailable — {updates.error}.
            </Alert>
          )}

          {!updatesLoading && updates && !updates.error && (
            <>
              <Typography variant="body2">
                Current: <strong>{updates.currentVersion}</strong>
              </Typography>
              {updates.latestVersion && (
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  Latest: <strong>{updates.latestVersion}</strong>
                  {updates.publishedAt && ` · published ${relativeTime(updates.publishedAt)}`}
                </Typography>
              )}

              {updates.updateAvailable && prefs && !prefs.watchtowerReachable && (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  Watchtower's HTTP API is unreachable. Update your compose per{' '}
                  <a href="https://github.com/bleichroeder/canvas/blob/main/docs/updates.md" target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>docs/updates.md</a>{' '}
                  to enable click-to-update.
                </Alert>
              )}
              {updates.updateAvailable && prefs?.watchtowerReachable && (
                <Alert severity="info" sx={{ mt: 2 }}>
                  {prefs.autoUpdate
                    ? 'Auto-update is on — canvas will restart within 15 minutes.'
                    : 'An update is available. Click below when you\'re ready.'}
                </Alert>
              )}
              {updates.updateAvailable && prefs?.watchtowerReachable && (
                <Button
                  variant="contained"
                  disabled={applying}
                  onClick={() => setApplyOpen(true)}
                  sx={{ mt: 2, mr: 1 }}
                >
                  Update now
                </Button>
              )}
              {!updates.updateAvailable && updates.latestVersion && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  You're on the latest version.
                </Typography>
              )}
              {prefs && (
                <Box sx={{ mt: 2 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={prefs.autoUpdate}
                        disabled={!prefs.watchtowerReachable}
                        onChange={(e) => void togglePref(e.target.checked)}
                      />
                    }
                    label="Auto-update"
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 5, mt: -0.5 }}>
                    Automatically install updates when available. Restarts canvas immediately;
                    your public URL will change if you're using Cloudflare Quick Tunnel.
                  </Typography>
                  {prefs.lastAutoCheckAt !== null && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 5, mt: 0.5 }}>
                      Last checked: {new Date(prefs.lastAutoCheckAt * 1000).toLocaleString()}
                    </Typography>
                  )}
                </Box>
              )}

              {updates.releaseNotes && (
                <>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>What's new</Typography>
                  <Box
                    sx={{
                      '& p': { my: 1 },
                      '& ul, & ol': { pl: 3 },
                      '& code': { bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5, fontSize: '0.875em' },
                      '& pre': { bgcolor: 'action.hover', p: 1, borderRadius: 1, overflowX: 'auto', fontSize: '0.875em' },
                      '& a': { color: 'primary.main' },
                      fontSize: '0.875rem',
                    }}
                    dangerouslySetInnerHTML={{ __html: renderReleaseNotes(updates.releaseNotes) }}
                  />
                </>
              )}

              {updates.htmlUrl && (
                <Button
                  size="small"
                  variant="text"
                  sx={{ mt: 2 }}
                  component="a"
                  href={updates.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on GitHub →
                </Button>
              )}
            </>
          )}
        </Box>
        <Dialog open={applyOpen} onClose={() => !applying && setApplyOpen(false)} fullWidth maxWidth="xs">
          <DialogTitle>Update to {updates?.latestVersion}?</DialogTitle>
          <DialogContent>
            <DialogContentText>
              Canvas will pull the new image and restart within ~10 seconds. Any active playback
              session will be interrupted. If you're using Cloudflare Quick Tunnel, your public
              URL will change — you'll see the new URL in Settings → Deployment once canvas is back.
            </DialogContentText>
            {applyError && (
              <Alert severity="error" sx={{ mt: 2 }}>{applyError}</Alert>
            )}
            {applying && !applyError && (
              <Alert severity="info" sx={{ mt: 2 }}>Restarting canvas…</Alert>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setApplyOpen(false)} disabled={applying}>Cancel</Button>
            <Button variant="contained" onClick={() => void applyUpdate()} disabled={applying}>Update</Button>
          </DialogActions>
        </Dialog>
      </ElevatedCard>

      {crashes.length > 0 && (
        <ElevatedCard>
          <Box sx={{ p: 2.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Box>
                <Typography sx={{ fontWeight: 500 }}>Recent player crashes</Typography>
                <Typography variant="caption" color="text.secondary">
                  The renderer was killed mid-playback. Most often caused by memory pressure on the Tesla browser.
                </Typography>
              </Box>
              <Button
                size="small"
                variant="text"
                onClick={() => { clearCrashLog(); setCrashes([]); }}
              >
                Clear
              </Button>
            </Box>
            <Box>
              {crashes.map((c, i) => <CrashRow key={`${c.crashedAt}-${i}`} record={c} />)}
            </Box>
          </Box>
        </ElevatedCard>
      )}

      <Accordion
        expanded={diagOpen}
        onChange={(_, expanded) => setDiagOpen(expanded)}
        sx={{
          backgroundColor: 'transparent',
          backgroundImage: 'none',
          boxShadow: 'none',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 1,
          '&::before': { display: 'none' },
        }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="body2" color="text.secondary">Diagnostics</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Box
            component="pre"
            sx={{
              m: 0, p: 1.5,
              fontFamily: 'monospace', fontSize: 12,
              backgroundColor: 'rgba(0,0,0,0.3)',
              borderRadius: 1,
              overflow: 'auto',
              color: 'text.secondary',
            }}
          >
{JSON.stringify(
  {
    BUILD_SHA: import.meta.env.VITE_BUILD_SHA ?? 'dev',
    CANVAS_API: import.meta.env.VITE_CANVAS_API ?? 'unset',
    USER_ID: user?.id ?? null,
    USER_ROLE: user?.role ?? null,
  },
  null,
  2,
)}
          </Box>
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}
