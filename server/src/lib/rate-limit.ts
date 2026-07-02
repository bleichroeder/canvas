export interface RateLimitOpts {
  windowMs: number;
  max: number;
  nowMs?: () => number;
}

export function createRateLimiter(opts: RateLimitOpts): (key: string) => boolean {
  const now = opts.nowMs ?? Date.now;
  const buckets = new Map<string, number[]>();

  return (key: string): boolean => {
    const t = now();
    const cutoff = t - opts.windowMs;
    let times = buckets.get(key);
    if (!times) {
      times = [];
      buckets.set(key, times);
    }
    // Drop entries older than window.
    while (times.length > 0 && times[0]! <= cutoff) times.shift();
    if (times.length >= opts.max) return false;
    times.push(t);
    return true;
  };
}
