import type { ParsedSource } from './x-sources';
import { logger } from '../log';

export interface PerSourceError {
  source: string;
  status: number;
  message: string;
}

export async function callPerSource<T>(
  sources: Record<string, ParsedSource>,
  fn: (key: string, src: ParsedSource) => Promise<T>,
): Promise<{ results: Record<string, T>; errors: PerSourceError[] }> {
  const entries = Object.entries(sources);
  const settled = await Promise.allSettled(entries.map(([k, s]) => fn(k, s)));
  const results: Record<string, T> = {};
  const errors: PerSourceError[] = [];
  settled.forEach((r, i) => {
    const [key] = entries[i]!;
    if (r.status === 'fulfilled') {
      results[key] = r.value;
    } else {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      logger.warn({ source: key, err: msg }, 'source failed');
      errors.push({ source: key, status: 502, message: msg });
    }
  });
  return { results, errors };
}

export function callOneSource<T>(
  sources: Record<string, ParsedSource>,
  key: string,
  fn: (src: ParsedSource) => Promise<T>,
): Promise<T> {
  const src = sources[key];
  if (!src) throw new Error(`source not paired: ${key}`);
  return fn(src);
}

export function explain(e: unknown): { status: number; message: string } {
  const message = e instanceof Error ? e.message : String(e);
  return { status: 502, message };
}
