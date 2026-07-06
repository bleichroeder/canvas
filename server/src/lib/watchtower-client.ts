export interface WatchtowerClient {
  /** Check whether Watchtower's HTTP API is reachable. Cached per TTL. */
  isReachable(): Promise<boolean>;
  /** Trigger a Watchtower update. Canvas will be recreated within seconds. */
  triggerUpdate(): Promise<void>;
}

export interface MakeWatchtowerClientOpts {
  url: string;
  token: string;
  reachableTtlMs?: number;
  probeTimeoutMs?: number;
}

export function makeWatchtowerClient(opts: MakeWatchtowerClientOpts): WatchtowerClient {
  const reachableTtlMs = opts.reachableTtlMs ?? 60_000;
  const probeTimeoutMs = opts.probeTimeoutMs ?? 2_000;
  let reachableCache: { value: boolean; at: number } | null = null;

  async function probe(): Promise<boolean> {
    if (!opts.url) return false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), probeTimeoutMs);
    try {
      const headers: Record<string, string> = {};
      if (opts.token) headers.authorization = `Bearer ${opts.token}`;
      const res = await fetch(`${opts.url}/v1/update`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      // Any HTTP response (including 401 or 5xx) means Watchtower is listening.
      // Only network-level failures indicate unreachability.
      void res;
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async isReachable(): Promise<boolean> {
      const now = Date.now();
      if (reachableCache && now - reachableCache.at < reachableTtlMs) {
        return reachableCache.value;
      }
      const value = await probe();
      reachableCache = { value, at: now };
      return value;
    },
    async triggerUpdate(): Promise<void> {
      if (!opts.url) throw new Error('WATCHTOWER_URL not configured');
      if (!opts.token) throw new Error('WATCHTOWER_TOKEN not configured');
      const res = await fetch(`${opts.url}/v1/update`, {
        method: 'POST',
        headers: { authorization: `Bearer ${opts.token}` },
      });
      if (!res.ok) {
        throw new Error(`watchtower POST /v1/update returned ${res.status}`);
      }
    },
  };
}
