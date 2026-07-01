/**
 * Devices screen — shows all devices that have authenticated as the current
 * user, with per-row revoke buttons. Revoking the current device clears the
 * session and bounces to /claim.
 */

import { useEffect, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Chip from '@mui/material/Chip';
import Table from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';
import TableBody from '@mui/material/TableBody';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import DevicesOutlinedIcon from '@mui/icons-material/DevicesOutlined';
import { AppShell } from '../components/AppShell';
import { api } from '../api';
import { clearSession } from '../lib/session';
import { navigate } from '../router';

interface DeviceEntry {
  id: string;
  label: string;
  lastSeenAt: number;
  current: boolean;
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function Devices() {
  const [devices, setDevices] = useState<DeviceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { devices: list } = await api.authMe();
      setDevices(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function revoke(device: DeviceEntry) {
    setRevoking(device.id);
    try {
      await api.authRevokeDevice(device.id);
      if (device.current) {
        clearSession();
        navigate('/sign-in');
        return;
      }
      setDevices((prev) => prev.filter((d) => d.id !== device.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRevoking(null);
    }
  }

  return (
    <AppShell>
      <Box sx={{ px: 2.5, pt: 2.5, pb: 6, maxWidth: 760, mx: 'auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
          <DevicesOutlinedIcon sx={{ fontSize: 28, color: 'primary.main' }} />
          <Typography variant="h1">Devices</Typography>
        </Box>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          These are all devices signed in to your canvas account. Revoking this device signs you out immediately.
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : devices.length === 0 ? (
          <Typography color="text.secondary">No devices found.</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Device</TableCell>
                <TableCell>Last seen</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {devices.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>{d.label}</Typography>
                      {d.current && (
                        <Chip label="this device" size="small" color="primary" variant="outlined" />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {timeAgo(d.lastSeenAt * 1000)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      variant="outlined"
                      color={d.current ? 'error' : 'inherit'}
                      size="small"
                      onClick={() => void revoke(d)}
                      disabled={revoking === d.id}
                      sx={{ textTransform: 'none' }}
                    >
                      {revoking === d.id ? 'Revoking…' : d.current ? 'Sign out' : 'Revoke'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Box>
    </AppShell>
  );
}
