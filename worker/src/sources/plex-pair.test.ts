import { describe, expect, it } from 'vitest';
import { plexAdapter } from './plex';

describe('plexAdapter.startPair', () => {
  it('returns a /pair URL containing the code', async () => {
    const { pairUrl, expiresAt } = await plexAdapter.startPair('K7P-Q3M');
    expect(pairUrl).toContain('code=K7P-Q3M');
    expect(pairUrl).toContain('type=plex');
    expect(expiresAt).toBeGreaterThan(Date.now());
  });
});
