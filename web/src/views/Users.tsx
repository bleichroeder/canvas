/**
 * Users admin screen — only accessible to users with role === 'admin'.
 * Displays the full user table with per-row "Manage" expanders for:
 *   - Per-source grant/revoke checkboxes (source pool from SourcesContext)
 *   - Delete user (with confirmation)
 *   - Regenerate claim token (shows new token prominently)
 */

import { Fragment, useEffect, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Table from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';
import TableBody from '@mui/material/TableBody';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import Collapse from '@mui/material/Collapse';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import AddIcon from '@mui/icons-material/Add';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import { AppShell } from '../components/AppShell';
import { api } from '../api';
import { getUser } from '../lib/session';
import { useSources } from '../lib/SourcesContext';
import { navigate } from '../router';

interface UserRow {
  id: number;
  label: string;
  role: 'admin' | 'member';
  deviceCount: number;
  sourceAccessCount: number | null;
  createdAt: number;
}

function fmtDate(secTs: number): string {
  return new Date(secTs * 1000).toLocaleDateString();
}

interface ManagePanelProps {
  user: UserRow;
  currentUserId: number;
  onDeleted: () => void;
}

function ManagePanel({ user, currentUserId, onDeleted }: ManagePanelProps) {
  const { sourceList, refresh: refreshSources } = useSources();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [regen, setRegen] = useState<string | null>(null);
  const [regenLoading, setRegenLoading] = useState(false);
  const [grantLoading, setGrantLoading] = useState<Record<number, boolean>>({});
  const [copiedToken, setCopiedToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPw, setResetPw] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);

  const isSelf = user.id === currentUserId;
  const isAdmin = user.role === 'admin';

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      await api.adminDeleteUser(user.id);
      onDeleted();
    } catch (e) {
      console.error('delete user failed:', e);
      setError((e as Error).message);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function handleRegenerateClaim() {
    setError(null);
    setRegenLoading(true);
    try {
      const { claimToken } = await api.adminRegenerateClaim(user.id);
      setRegen(claimToken);
    } catch (e) {
      console.error('regen claim failed:', e);
      setError((e as Error).message);
    } finally {
      setRegenLoading(false);
    }
  }

  async function handleGrantToggle(sourceId: number, currentlyGranted: boolean) {
    setError(null);
    setGrantLoading((prev) => ({ ...prev, [sourceId]: true }));
    try {
      if (currentlyGranted) {
        await api.adminRevokeSource(user.id, sourceId);
      } else {
        await api.adminGrantSource(user.id, sourceId);
      }
      await refreshSources();
    } catch (e) {
      console.error('grant toggle failed:', e);
      setError((e as Error).message);
    } finally {
      setGrantLoading((prev) => ({ ...prev, [sourceId]: false }));
    }
  }

  function copyToken(token: string) {
    void navigator.clipboard.writeText(token).then(() => {
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    });
  }

  function openResetDialog() {
    setResetPw('');
    setResetConfirm('');
    setResetError(null);
    setResetOpen(true);
  }

  async function handleResetPassword() {
    if (resetPw.length < 8) {
      setResetError('Password must be at least 8 characters.');
      return;
    }
    if (resetPw !== resetConfirm) {
      setResetError('Passwords do not match.');
      return;
    }
    setResetLoading(true);
    setResetError(null);
    try {
      await api.adminResetPassword(user.id, resetPw);
      setResetOpen(false);
      setResetPw('');
      setResetConfirm('');
      setResetSuccess(`Password reset for ${user.label}. Give the new password to them. All their signed-in devices have been signed out.`);
    } catch (e) {
      setResetError((e as Error).message);
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <Box sx={{ px: 2, pb: 2, pt: 1 }}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 1.5 }}>
          {error}
        </Alert>
      )}
      {resetSuccess && (
        <Alert severity="success" onClose={() => setResetSuccess(null)} sx={{ mb: 1.5 }}>
          {resetSuccess}
        </Alert>
      )}
      {/* Source access grid — admins get all sources implicitly, skip for them */}
      {!isAdmin && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Source access
          </Typography>
          {sourceList.length === 0 ? (
            <Typography variant="body2" color="text.secondary">No sources in pool yet.</Typography>
          ) : (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {sourceList.map((src) => {
                const granted = (src.usersWithAccess ?? []).includes(user.id);
                const loading = !!grantLoading[src.id];
                return (
                  <FormControlLabel
                    key={src.id}
                    control={
                      <Checkbox
                        checked={granted}
                        disabled={loading}
                        onChange={() => void handleGrantToggle(src.id, granted)}
                        size="small"
                      />
                    }
                    label={
                      <Typography variant="body2">
                        {src.label}
                        {loading && <CircularProgress size={10} sx={{ ml: 0.5 }} />}
                      </Typography>
                    }
                  />
                );
              })}
            </Box>
          )}
        </Box>
      )}
      {isAdmin && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Admins have implicit access to all sources.
        </Typography>
      )}

      {/* Regenerate claim token */}
      <Box sx={{ mb: 2 }}>
        <Button
          variant="outlined"
          size="small"
          onClick={() => void handleRegenerateClaim()}
          disabled={regenLoading}
          sx={{ mr: 1 }}
        >
          {regenLoading ? 'Generating…' : 'Regenerate claim token'}
        </Button>
        {regen && (
          <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography
              sx={{
                fontFamily: 'monospace',
                fontSize: 14,
                px: 1.5, py: 0.75,
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'divider',
                backgroundColor: 'background.paper',
                flex: 1,
                wordBreak: 'break-all',
              }}
            >
              {regen}
            </Typography>
            <Tooltip title={copiedToken ? 'Copied!' : 'Copy token'}>
              <IconButton size="small" onClick={() => copyToken(regen)}>
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>

      {/* Reset password */}
      <Box sx={{ mb: 2 }}>
        <Button
          variant="outlined"
          size="small"
          onClick={openResetDialog}
        >
          Reset password
        </Button>
      </Box>

      {/* Delete user */}
      {!isSelf && !isAdmin && (
        <Button
          variant="outlined"
          color="error"
          size="small"
          onClick={() => setConfirmDelete(true)}
        >
          Delete user
        </Button>
      )}
      {isSelf && (
        <Typography variant="caption" color="text.secondary">
          You cannot delete your own account.
        </Typography>
      )}

      {/* Reset password dialog */}
      <Dialog open={resetOpen} onClose={() => setResetOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Reset password for {user.label}</DialogTitle>
        <DialogContent>
          {resetError && <Alert severity="error" sx={{ mb: 2 }}>{resetError}</Alert>}
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="New password"
            type="password"
            autoComplete="new-password"
            value={resetPw}
            onChange={(e) => setResetPw(e.target.value)}
            disabled={resetLoading}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            size="small"
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={resetConfirm}
            onChange={(e) => setResetConfirm(e.target.value)}
            disabled={resetLoading}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetOpen(false)} disabled={resetLoading}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => void handleResetPassword()}
            disabled={resetLoading}
          >
            {resetLoading ? 'Resetting…' : 'Reset'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>Delete {user.label}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This permanently deletes the user, all their device sessions, and their claim tokens.
            Any sources they paired will remain in the pool but pairedByUserId will be cleared.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button color="error" onClick={() => void handleDelete()} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

interface AddUserModalProps {
  open: boolean;
  onClose: () => void;
  /** claimToken is defined when user was created without a password; undefined when created with a password */
  onCreated: (label: string, claimToken?: string) => void;
}

function AddUserModal({ open, onClose, onCreated }: AddUserModalProps) {
  const [label, setLabel] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    setLabel('');
    setPassword('');
    setError(null);
    onClose();
  }

  async function handleCreate() {
    if (!label.trim()) return;
    const trimmedLabel = label.trim();
    const usePassword = password.length > 0;
    if (usePassword && password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.adminCreateUser(trimmedLabel, usePassword ? password : undefined);
      setLabel('');
      setPassword('');
      onClose();
      onCreated(trimmedLabel, res.claimToken);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="xs">
      <DialogTitle>Add user</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Enter a display name and optionally set an initial password. Leave the password blank to generate a one-time claim token instead.
        </DialogContentText>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField
          autoFocus
          fullWidth
          size="small"
          label="Display name"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); }}
          disabled={loading}
          sx={{ mb: 2 }}
        />
        <TextField
          fullWidth
          size="small"
          label="Initial password (optional)"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); }}
          disabled={loading}
          helperText="Leave blank to send an invite via claim token instead."
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => void handleCreate()}
          disabled={!label.trim() || loading}
        >
          {loading ? 'Creating…' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function Users() {
  const sessionUser = getUser();

  // Guard: non-admins are bounced to home.
  useEffect(() => {
    if (sessionUser?.role !== 'admin') navigate('/');
  }, [sessionUser]);

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [newUserLabel, setNewUserLabel] = useState<string | null>(null);
  const [copiedNew, setCopiedNew] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.adminListUsers();
      setUsers(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadUsers(); }, [loadUsers]);

  function handleUserCreated(label: string, claimToken?: string) {
    setNewUserLabel(label);
    setNewToken(claimToken ?? null);
    void loadUsers();
  }

  function copyNewToken() {
    if (!newToken) return;
    void navigator.clipboard.writeText(newToken).then(() => {
      setCopiedNew(true);
      setTimeout(() => setCopiedNew(false), 2000);
    });
  }

  if (sessionUser?.role !== 'admin') return null;

  return (
    <AppShell>
      <Box sx={{ px: 2.5, pt: 2.5, pb: 6, maxWidth: 900, mx: 'auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
          <Typography variant="h1">Users</Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setAddOpen(true)}
          >
            Add user
          </Button>
        </Box>

        {newUserLabel && (
          <Alert
            severity="success"
            sx={{ mb: 3 }}
            onClose={() => { setNewUserLabel(null); setNewToken(null); }}
            action={
              newToken ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography sx={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' }}>
                    {newToken}
                  </Typography>
                  <Tooltip title={copiedNew ? 'Copied!' : 'Copy'}>
                    <IconButton size="small" onClick={copyNewToken}>
                      <ContentCopyIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              ) : undefined
            }
          >
            {newToken
              ? `User created. Share this claim token:`
              : `User created. Share the username "${newUserLabel}" and their password with them.`}
          </Alert>
        )}

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 40 }} />
                <TableCell>Name</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Devices</TableCell>
                <TableCell>Source access</TableCell>
                <TableCell>Created</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((u) => {
                const isExpanded = expandedId === u.id;
                return (
                  <Fragment key={u.id}>
                    <TableRow
                      sx={{
                        cursor: 'pointer',
                        '&:hover': { backgroundColor: 'action.hover' },
                        backgroundColor: isExpanded ? 'action.selected' : undefined,
                      }}
                      onClick={() => setExpandedId(isExpanded ? null : u.id)}
                    >
                      <TableCell sx={{ py: 1 }}>
                        <IconButton size="small">
                          {isExpanded ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                        </IconButton>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {u.label}
                          {u.id === sessionUser?.id && (
                            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>(you)</Typography>
                          )}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={u.role}
                          size="small"
                          color={u.role === 'admin' ? 'primary' : 'default'}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>{u.deviceCount}</TableCell>
                      <TableCell>
                        {u.role === 'admin' ? 'All (admin)' : (u.sourceAccessCount ?? 0)}
                      </TableCell>
                      <TableCell>{fmtDate(u.createdAt)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={6} sx={{ py: 0, borderBottom: isExpanded ? undefined : 'none' }}>
                        <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                          <ManagePanel
                            user={u}
                            currentUserId={sessionUser?.id ?? -1}
                            onDeleted={() => {
                              setExpandedId(null);
                              void loadUsers();
                            }}
                          />
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}

        <AddUserModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onCreated={handleUserCreated}
        />
      </Box>
    </AppShell>
  );
}
