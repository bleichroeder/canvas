import { describe, expect, test } from 'bun:test';
import { createRateLimiter } from './rate-limit';

describe('createRateLimiter', () => {
  test('allows up to max requests within window', () => {
    const rl = createRateLimiter({ windowMs: 60_000, max: 10 });
    for (let i = 0; i < 10; i++) expect(rl('ip-a')).toBe(true);
  });

  test('blocks the (max+1)th within window', () => {
    const rl = createRateLimiter({ windowMs: 60_000, max: 10 });
    for (let i = 0; i < 10; i++) rl('ip-a');
    expect(rl('ip-a')).toBe(false);
  });

  test('separates keys', () => {
    const rl = createRateLimiter({ windowMs: 60_000, max: 2 });
    rl('ip-a'); rl('ip-a');
    expect(rl('ip-a')).toBe(false);
    expect(rl('ip-b')).toBe(true);
  });

  test('resets after window elapses', () => {
    let now = 0;
    const rl = createRateLimiter({ windowMs: 1000, max: 2, nowMs: () => now });
    expect(rl('k')).toBe(true);
    expect(rl('k')).toBe(true);
    expect(rl('k')).toBe(false);
    now = 1001;
    expect(rl('k')).toBe(true);
  });

  test('sliding window (not fixed bucket)', () => {
    let now = 0;
    const rl = createRateLimiter({ windowMs: 1000, max: 2, nowMs: () => now });
    now = 0; expect(rl('k')).toBe(true);
    now = 500; expect(rl('k')).toBe(true);
    now = 999; expect(rl('k')).toBe(false);
    now = 1001; // first request (at 0) now expired, so one slot free
    expect(rl('k')).toBe(true);
  });
});
