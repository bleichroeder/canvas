import { describe, expect, test } from 'bun:test';
import { makeStreamSigner, type StreamSigParams } from './yt-stream-sign';

// Parse a "from=..&exp=..&sig=.." query string into params for verify().
function parse(query: string): StreamSigParams {
  const p = new URLSearchParams(query);
  return { from: p.get('from') ?? undefined, exp: p.get('exp') ?? undefined, sig: p.get('sig') ?? undefined };
}

describe('makeStreamSigner', () => {
  test('round-trips: a freshly signed query verifies', async () => {
    const s = makeStreamSigner('secret', { now: () => 1000 });
    const q = await s.signQuery('vid123', 42);
    expect(await s.verify('vid123', parse(q))).toBe(true);
  });

  test('floors and clamps fromSec into the query', async () => {
    const s = makeStreamSigner('secret', { now: () => 1000 });
    const q = await s.signQuery('vid', 12.9);
    expect(parse(q).from).toBe('12');
    const q2 = await s.signQuery('vid', -5);
    expect(parse(q2).from).toBe('0');
  });

  test('rejects a tampered videoId', async () => {
    const s = makeStreamSigner('secret', { now: () => 1000 });
    const q = await s.signQuery('vid123', 0);
    expect(await s.verify('OTHER', parse(q))).toBe(false);
  });

  test('rejects a tampered from offset', async () => {
    const s = makeStreamSigner('secret', { now: () => 1000 });
    const q = parse(await s.signQuery('vid', 0));
    expect(await s.verify('vid', { ...q, from: '999' })).toBe(false);
  });

  test('rejects a tampered signature', async () => {
    const s = makeStreamSigner('secret', { now: () => 1000 });
    const q = parse(await s.signQuery('vid', 0));
    expect(await s.verify('vid', { ...q, sig: 'deadbeef' })).toBe(false);
  });

  test('rejects an expired URL', async () => {
    let t = 1000;
    const s = makeStreamSigner('secret', { now: () => t });
    const q = await s.signQuery('vid', 0, 60); // exp = 1060
    t = 2000;                                   // now past exp
    expect(await s.verify('vid', parse(q))).toBe(false);
  });

  test('rejects a signature from a different secret', async () => {
    const a = makeStreamSigner('secret-a', { now: () => 1000 });
    const b = makeStreamSigner('secret-b', { now: () => 1000 });
    const q = await a.signQuery('vid', 0);
    expect(await b.verify('vid', parse(q))).toBe(false);
  });

  test('rejects missing params', async () => {
    const s = makeStreamSigner('secret', { now: () => 1000 });
    expect(await s.verify('vid', {})).toBe(false);
    expect(await s.verify('vid', { from: '0', exp: '9999999999' })).toBe(false);
  });

  test('rejects a non-numeric exp', async () => {
    const s = makeStreamSigner('secret', { now: () => 1000 });
    const q = parse(await s.signQuery('vid', 0));
    expect(await s.verify('vid', { ...q, exp: 'abc' })).toBe(false);
  });
});
