import { describe, expect, test, beforeEach } from 'bun:test';
import { getUpdateStatus, __resetForTests } from './update-checker';

// Helper to install a fetch mock returning a specific response.
function mockFetch(status: number, body: unknown): { calls: number } {
  const state = { calls: 0 };
  const original = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async () => {
    state.calls++;
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }) as unknown as Response;
  };
  // Restore in a teardown — bun:test doesn't have afterEach easily wired here,
  // so tests are responsible for calling __resetForTests() to clear cache.
  return Object.assign(state, {
    restore: () => {
      (globalThis as unknown as { fetch: typeof fetch }).fetch = original;
    },
  });
}

describe('getUpdateStatus', () => {
  beforeEach(() => __resetForTests());

  test('fetches from GitHub API on first call', async () => {
    const m = mockFetch(200, {
      tag_name: 'v0.8.0',
      published_at: '2026-07-02T12:00:00Z',
      body: '## What\'s new\n- Fix X\n- Add Y',
      html_url: 'https://github.com/bleichroeder/canvas/releases/tag/v0.8.0',
    });
    const status = await getUpdateStatus('v0.7.0');
    expect(m.calls).toBe(1);
    expect(status.currentVersion).toBe('v0.7.0');
    expect(status.latestVersion).toBe('v0.8.0');
    expect(status.updateAvailable).toBe(true);
    expect(status.releaseNotes).toContain("Fix X");
    expect(status.htmlUrl).toBe('https://github.com/bleichroeder/canvas/releases/tag/v0.8.0');
    expect(status.error).toBeNull();
    (m as unknown as { restore: () => void }).restore();
  });

  test('serves cached data within TTL, does not refetch', async () => {
    const m = mockFetch(200, {
      tag_name: 'v0.8.0',
      published_at: '2026-07-02T12:00:00Z',
      body: 'notes',
      html_url: 'https://example',
    });
    await getUpdateStatus('v0.7.0');
    await getUpdateStatus('v0.7.0');
    await getUpdateStatus('v0.7.0');
    expect(m.calls).toBe(1);
    (m as unknown as { restore: () => void }).restore();
  });

  test('semver: v0.7.0 vs v0.8.0 → updateAvailable true', async () => {
    const m = mockFetch(200, { tag_name: 'v0.8.0', published_at: '', body: '', html_url: '' });
    const status = await getUpdateStatus('v0.7.0');
    expect(status.updateAvailable).toBe(true);
    (m as unknown as { restore: () => void }).restore();
  });

  test('semver: v1.0.0 vs v0.9.99 → updateAvailable false', async () => {
    const m = mockFetch(200, { tag_name: 'v0.9.99', published_at: '', body: '', html_url: '' });
    const status = await getUpdateStatus('v1.0.0');
    expect(status.updateAvailable).toBe(false);
    (m as unknown as { restore: () => void }).restore();
  });

  test('semver: equal → updateAvailable false', async () => {
    const m = mockFetch(200, { tag_name: 'v0.7.0', published_at: '', body: '', html_url: '' });
    const status = await getUpdateStatus('v0.7.0');
    expect(status.updateAvailable).toBe(false);
    (m as unknown as { restore: () => void }).restore();
  });

  test('semver: "dev" current → updateAvailable true when a real version exists', async () => {
    const m = mockFetch(200, { tag_name: 'v0.1.0', published_at: '', body: '', html_url: '' });
    const status = await getUpdateStatus('dev');
    expect(status.updateAvailable).toBe(true);
    (m as unknown as { restore: () => void }).restore();
  });

  test('404 → error message, cached', async () => {
    const m = mockFetch(404, { message: 'Not Found' });
    const status = await getUpdateStatus('v0.7.0');
    expect(status.latestVersion).toBeNull();
    expect(status.updateAvailable).toBe(false);
    expect(status.error).toBe('no releases published yet');
    // Second call should also be cached
    await getUpdateStatus('v0.7.0');
    expect(m.calls).toBe(1);
    (m as unknown as { restore: () => void }).restore();
  });

  test('5xx → error message, no stale cache available', async () => {
    const m = mockFetch(503, { message: 'Service unavailable' });
    const status = await getUpdateStatus('v0.7.0');
    expect(status.error).toBe('GitHub API unavailable');
    (m as unknown as { restore: () => void }).restore();
  });
});
