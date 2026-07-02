import { API_BASE } from './config';
import { getBearer, clearSession } from './lib/session';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const bearer = getBearer();
  if (bearer) headers.set('authorization', `Bearer ${bearer}`);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status === 401) {
    clearSession();
    if (location.hash !== '#/sign-in') location.hash = '#/sign-in';
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} — ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

import type { HomeRow, Item, ItemDetail, BrowseResult, PlayResolution, SourceHomeResponse } from './types';
import type { StoredSource } from './storage';
import type { SessionUser } from './lib/session';

export const api = {
  home: () => request<{ rows: (HomeRow & { source: string })[]; errors: { source: string; status: number; message: string }[]; libraryCounts: Record<string, number> }>('/api/home'),
  search: (q: string) => request<{ hits: (Item & { source: string })[]; errors: unknown[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  library: (srcKey: string, libId?: string, path?: string, page?: { offset: number; limit: number }) => {
    const params = new URLSearchParams();
    if (path) params.set('path', path);
    if (page) {
      params.set('offset', String(page.offset));
      params.set('limit', String(page.limit));
    }
    const qs = params.toString() ? `?${params.toString()}` : '';
    const lib = libId ? `/${encodeURIComponent(libId)}` : '';
    return request<BrowseResult>(`/api/library/${encodeURIComponent(srcKey)}${lib}${qs}`);
  },
  item: (srcKey: string, id: string) =>
    request<ItemDetail>(`/api/item/${encodeURIComponent(srcKey)}/${encodeURIComponent(id)}`),
  play: (srcKey: string, id: string, fromSec?: number) => {
    const qs = typeof fromSec === 'number' && fromSec > 0 ? `?fromSec=${Math.floor(fromSec)}` : '';
    return request<PlayResolution>(
      `/api/play/${encodeURIComponent(srcKey)}/${encodeURIComponent(id)}${qs}`,
      { method: 'POST' },
    );
  },
  progress: (srcKey: string, id: string, posSec: number, completed = false) =>
    request<void>(`/api/progress/${encodeURIComponent(srcKey)}/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify({ posSec, completed }),
    }),
  pairStart: (sourceType: StoredSource['type']) =>
    request<{ code: string; expiresAt: number }>('/api/pair/start', {
      method: 'POST',
      body: JSON.stringify({ sourceType }),
    }),
  pairPoll: (code: string) =>
    request<{ status: 'pending' | 'approved' | 'expired'; source?: StoredSource; sourceType?: StoredSource['type'] }>('/api/pair/poll', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  pairApprove: (payload: { code: string; type: StoredSource['type']; baseUrl: string; token: string; label: string }) =>
    request<void>('/api/pair/approve', { method: 'POST', body: JSON.stringify(payload) }),
  pairDelete: (code: string) => request<void>(`/api/pair/${encodeURIComponent(code)}`, { method: 'DELETE' }),
  pairPlexServers: (authToken: string, clientId: string) =>
    request<{
      servers: {
        name: string;
        clientIdentifier: string;
        baseUrl: string;
        accessToken: string;
        publiclyReachable: boolean;
      }[];
    }>('/api/pair/plex-servers', {
      method: 'POST',
      body: JSON.stringify({ authToken, clientId }),
    }),
  sourceHome: (srcKey: string) =>
    request<SourceHomeResponse>(`/api/source-home?key=${encodeURIComponent(srcKey)}`),
  sourceStatus: (srcKey: string) =>
    request<{ status: 'ok' | 'degraded' | 'unreachable' | 'lan-only'; lastSeenAt: number | null }>(
      `/api/source-status?key=${encodeURIComponent(srcKey)}`,
    ),

  flixifyPairStart: (code: string, mirror?: string) =>
    request<{ pin: string; pinRaw: string; mirror: string; pinUrl: string }>('/api/pair/flixify-start', {
      method: 'POST',
      body: JSON.stringify({ code, ...(mirror ? { mirror } : {}) }),
    }),
  flixifyPairPoll: (code: string) =>
    request<{ status: 'waiting' | 'approved' | 'expired' }>('/api/pair/flixify-poll', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  // Fetch a VTT subtitle file by relative worker path. Bearer auth is added
  // automatically by request(), so this now goes through the same auth flow.
  fetchSubtitlesText: async (relativeUrl: string): Promise<string> => {
    const headers = new Headers();
    const bearer = getBearer();
    if (bearer) headers.set('authorization', `Bearer ${bearer}`);
    const res = await fetch(`${API_BASE}${relativeUrl}`, { headers });
    if (res.status === 401) {
      clearSession();
      if (location.hash !== '#/sign-in') location.hash = '#/sign-in';
      throw new Error('unauthorized');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} — ${text.slice(0, 200)}`);
    }
    return res.text();
  },

  // Auth endpoints
  authClaim: (token: string, deviceLabel: string) =>
    request<{ bearer: string; user: SessionUser }>('/api/auth/claim', {
      method: 'POST', body: JSON.stringify({ token, deviceLabel }),
    }),
  authMe: () => request<{ user: SessionUser; devices: { id: string; label: string; lastSeenAt: number; current: boolean }[] }>('/api/auth/me'),
  authLogout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  authRevokeDevice: (id: string) => request<void>(`/api/auth/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  authLogin: (label: string, password: string, deviceLabel: string) =>
    request<{ bearer: string; user: SessionUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ label, password, deviceLabel }),
    }),
  authSetPassword: (newPassword: string) =>
    request<void>('/api/auth/set-password', {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    }),
  authChangePassword: (currentPassword: string, newPassword: string) =>
    request<void>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  // Admin endpoints
  adminListUsers: () => request<{ id: number; label: string; role: 'admin' | 'member'; deviceCount: number; sourceAccessCount: number | null; createdAt: number }[]>('/api/admin/users'),
  adminCreateUser: (label: string, password?: string) =>
    request<{ user: SessionUser; claimToken?: string }>('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(password ? { label, password } : { label }),
    }),
  adminDeleteUser: (id: number) => request<void>(`/api/admin/users/${id}`, { method: 'DELETE' }),
  adminRegenerateClaim: (userId: number) => request<{ claimToken: string }>(`/api/admin/users/${userId}/claim-token`, { method: 'POST' }),
  adminResetPassword: (userId: number, newPassword: string) =>
    request<void>(`/api/admin/users/${userId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    }),
  adminGrantSource: (userId: number, sourceId: number) => request<void>(`/api/admin/users/${userId}/sources/${sourceId}`, { method: 'POST' }),
  adminRevokeSource: (userId: number, sourceId: number) => request<void>(`/api/admin/users/${userId}/sources/${sourceId}`, { method: 'DELETE' }),

  // Source management
  listSources: () => request<{ id: number; type: 'plex' | 'flixify'; baseUrl: string; label: string; pairedByUserId: number | null; createdAt: number; usersWithAccess?: number[] }[]>('/api/sources'),
  deleteSource: (id: number) => request<void>(`/api/sources/${id}`, { method: 'DELETE' }),

  // Setup (first-run wizard)
  setupProbe: () =>
    request<{ setupRequired: boolean }>('/api/setup/probe'),
  setup: (adminUsername: string, adminPassword: string, deviceLabel: string) =>
    request<{ bearer: string; user: SessionUser }>('/api/setup', {
      method: 'POST',
      body: JSON.stringify({ adminUsername, adminPassword, deviceLabel }),
    }),

  // Deployment status + admin config
  deploymentStatus: () =>
    request<{ mode: string; status: string; publicUrl: string | null; statusMessage: string | null; externallyManaged: boolean }>(
      '/api/deployment/status',
    ),
  adminGetDeployment: () =>
    request<{
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
    }>('/api/admin/deployment'),
  adminSetDeployment: (payload: {
    mode: string;
    domain?: string;
    adminEmail?: string;
    cfNamedToken?: string;
  }) =>
    request<void>('/api/admin/deployment', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  adminApplyDeployment: () =>
    request<void>('/api/admin/deployment/apply', { method: 'POST' }),

  adminTelemetry: {
    list: (opts: { cursor?: string; kind?: string; since?: number } = {}) => {
      const p = new URLSearchParams();
      if (opts.cursor) p.set('cursor', opts.cursor);
      if (opts.kind) p.set('kind', opts.kind);
      if (opts.since != null) p.set('since', String(opts.since));
      const q = p.toString();
      return request<{
        rows: Array<{
          id: string;
          created_at: number;
          error_kind: string | null;
          error_message: string | null;
          source_type: string | null;
          canvas_version: string | null;
          user_agent: string | null;
        }>;
        nextCursor: string | null;
      }>(`/api/admin/telemetry/errors${q ? '?' + q : ''}`);
    },
    get: (id: string) =>
      request<{
        id: string;
        created_at: number;
        user_id: number | null;
        canvas_version: string | null;
        user_agent: string | null;
        error_message: string | null;
        error_kind: string | null;
        source_type: string | null;
        report_json: string;
      }>(`/api/admin/telemetry/errors/${encodeURIComponent(id)}`),
    delete: (id: string) =>
      request<void>(`/api/admin/telemetry/errors/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
};
