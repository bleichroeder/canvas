export interface CacheOptions {
  bypass?: boolean;
}

export async function cached<T>(
  kv: KVNamespace,
  key: string,
  ttlSec: number,
  fn: () => Promise<T>,
  opts: CacheOptions = {},
): Promise<T> {
  if (!opts.bypass) {
    const hit = await kv.get(key, 'json');
    if (hit !== null) return hit as T;
  }
  const value = await fn();
  // KV's minimum TTL is 60s; clamp.
  const ttl = Math.max(60, ttlSec);
  await kv.put(key, JSON.stringify(value), { expirationTtl: ttl });
  return value;
}

export async function tokenHash(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest).slice(0, 4)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
