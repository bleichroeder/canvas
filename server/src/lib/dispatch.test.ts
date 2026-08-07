import { describe, expect, test } from 'bun:test';
import { callPerSource, callOneSource, explain } from './dispatch';
import type { ParsedSource } from './x-sources';

const src = (type: ParsedSource['type']): ParsedSource => ({ type, baseUrl: '', token: '' });

// These lock the guarantee that a failing source (e.g. a YouTube resolve error
// when yt-dlp falls behind) degrades to a per-source error and never sinks the
// user's Plex/Flixify results.
describe('callPerSource', () => {
  test('one source throwing does not sink the others', async () => {
    const sources = { '1': src('plex'), '2': src('youtube'), '3': src('flixify') };
    const { results, errors } = await callPerSource(sources, async (key) => {
      if (key === '2') throw new Error('yt-dlp exited 1');
      return `ok-${key}`;
    });
    expect(results).toEqual({ '1': 'ok-1', '3': 'ok-3' }); // plex + flixify unaffected
    expect(errors).toEqual([{ source: '2', status: 502, message: 'yt-dlp exited 1' }]);
  });

  test('all-success yields no errors', async () => {
    const { results, errors } = await callPerSource({ '1': src('plex') }, async (k) => `ok-${k}`);
    expect(results).toEqual({ '1': 'ok-1' });
    expect(errors).toEqual([]);
  });

  test('empty source set is a no-op', async () => {
    const { results, errors } = await callPerSource({}, async () => 'x');
    expect(results).toEqual({});
    expect(errors).toEqual([]);
  });
});

describe('callOneSource', () => {
  test('invokes fn for an existing key', async () => {
    const out = await callOneSource({ '5': src('youtube') }, '5', async (s) => s.type);
    expect(out).toBe('youtube');
  });

  test('throws for a missing key', () => {
    expect(() => callOneSource({}, 'nope', async () => 1)).toThrow(/not paired/);
  });
});

describe('explain', () => {
  test('normalizes any thrown value to a 502 with a message', () => {
    expect(explain(new Error('boom'))).toEqual({ status: 502, message: 'boom' });
    expect(explain('plain string')).toEqual({ status: 502, message: 'plain string' });
  });
});
