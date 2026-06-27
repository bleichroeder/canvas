import { describe, expect, it, vi } from 'vitest';
import { cached } from './cache';

function fakeKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(k: string, format?: string) {
      const val = store.get(k);
      if (!val) return null;
      if (format === 'json') return JSON.parse(val);
      return val;
    },
    async put(k: string, v: string) { store.set(k, v); },
    async delete(k: string) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cacheStatus: null } as any; },
    getWithMetadata: () => Promise.reject(new Error('unused')),
  } as unknown as KVNamespace;
}

describe('cached()', () => {
  it('calls fn on first call', async () => {
    const kv = fakeKV();
    const fn = vi.fn(async () => ({ value: 42 }));
    const result = await cached(kv, 'k1', 60, fn);
    expect(result).toEqual({ value: 42 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns cached value on second call without invoking fn', async () => {
    const kv = fakeKV();
    const fn = vi.fn(async () => ({ value: 7 }));
    await cached(kv, 'k2', 60, fn);
    const second = await cached(kv, 'k2', 60, fn);
    expect(second).toEqual({ value: 7 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('honors bypass=true and calls fn again', async () => {
    const kv = fakeKV();
    const fn = vi.fn(async () => ({ n: Math.random() }));
    await cached(kv, 'k3', 60, fn);
    await cached(kv, 'k3', 60, fn, { bypass: true });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
