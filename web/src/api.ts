import { API_BASE } from './config';
import { getSources } from './storage';
import type { StoredSource } from './storage';

function sourcesHeader(): Record<string, string> {
  const s = getSources();
  if (Object.keys(s).length === 0) return {};
  // Stripped down to only the fields the worker validates.
  const compact: Record<string, { type: StoredSource['type']; baseUrl: string; token: string }> = {};
  for (const [k, v] of Object.entries(s)) {
    compact[k] = { type: v.type, baseUrl: v.baseUrl, token: v.token };
  }
  return { 'x-sources': JSON.stringify(compact) };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(sourcesHeader())) headers.set(k, v);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} — ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

import type { HomeRow, Item, ItemDetail, BrowseResult, PlayResolution } from './types';

export const api = {
  home: () => request<{ rows: (HomeRow & { source: string })[]; errors: { source: string; status: number; message: string }[] }>('/api/home'),
  search: (q: string) => request<{ hits: (Item & { source: string })[]; errors: unknown[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  library: (srcKey: string, libId?: string, path?: string) => {
    const qs = path ? `?path=${encodeURIComponent(path)}` : '';
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
    request<{ status: 'pending' | 'approved' | 'expired'; source?: StoredSource }>('/api/pair/poll', {
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
};
