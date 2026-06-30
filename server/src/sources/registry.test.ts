import { describe, expect, it } from 'bun:test';
import { getAdapter, registerAdapter } from './registry';
import type { SourceAdapter } from './types';

const fakeAdapter: SourceAdapter = {
  type: 'plex',
  async startPair() { return { pairUrl: '', expiresAt: 0 }; },
  async home() { return []; },
  async search() { return []; },
  async library() { return { breadcrumbs: [], items: [] }; },
  async item() { return { id: '', type: 'movie', title: '' }; },
  async resolveStream() { return { url: '', durationSec: 0 }; },
  async saveProgress() {},
};

describe('source registry', () => {
  it('returns a registered adapter by type', () => {
    registerAdapter(fakeAdapter);
    expect(getAdapter('plex')).toBe(fakeAdapter);
  });

  it('throws for an unregistered type', () => {
    expect(() => getAdapter('jellyfin')).toThrow(/not registered|unknown adapter/i);
  });
});
