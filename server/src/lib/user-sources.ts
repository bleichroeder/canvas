import type { Db } from '../db';
import type { ParsedSource } from './x-sources';
import { listAllSources, listAccessibleSources } from '../storage/sources';
import type { AuthContext } from '../middleware/auth';

export function getUserSources(db: Db, auth: AuthContext): Record<string, ParsedSource> {
  const rows = auth.role === 'admin' ? listAllSources(db) : listAccessibleSources(db, auth.userId);
  const out: Record<string, ParsedSource> = {};
  for (const s of rows) {
    out[String(s.id)] = { type: s.type, baseUrl: s.baseUrl, token: s.token };
  }
  return out;
}
