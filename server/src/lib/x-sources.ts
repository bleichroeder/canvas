import type { SourceType } from '../sources/types';

const SUPPORTED: SourceType[] = ['plex', 'jellyfin', 'flixify', 'generic'];

export interface ParsedSource {
  type: SourceType;
  baseUrl: string;
  token: string;
}

export function parseXSources(req: Request): Record<string, ParsedSource> {
  const raw = req.headers.get('x-sources');
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) return {};
  const out: Record<string, ParsedSource> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const v = value as { type?: unknown; baseUrl?: unknown; token?: unknown };
    if (
      typeof v.type !== 'string' ||
      !SUPPORTED.includes(v.type as SourceType) ||
      typeof v.baseUrl !== 'string' ||
      typeof v.token !== 'string'
    ) {
      continue;
    }
    out[key] = { type: v.type as SourceType, baseUrl: v.baseUrl, token: v.token };
  }
  return out;
}
