import { describe, it, expect } from 'vitest';
import {
  parseFlixifyAuth,
  serializeFlixifyAuth,
  encodeFlixifyItemId,
  decodeFlixifyItemId,
  harvestCookies,
} from './flixify';

describe('parseFlixifyAuth / serializeFlixifyAuth', () => {
  it('round-trips a populated auth blob', () => {
    const orig = { pip: 'a', session: 'b', profile_id: 'c', asset_host: 'cdn.x', mirror: 'thecalm.site' };
    expect(parseFlixifyAuth(serializeFlixifyAuth(orig))).toEqual(orig);
  });

  it('returns an empty-cookie blob for malformed input', () => {
    expect(parseFlixifyAuth('not json')).toEqual({ pip: '', session: '' });
    expect(parseFlixifyAuth('')).toEqual({ pip: '', session: '' });
  });
});

describe('encodeFlixifyItemId / decodeFlixifyItemId', () => {
  it('round-trips id+url and url-decodes the path', () => {
    const encoded = encodeFlixifyItemId('12345', '/shows/some-slug');
    expect(decodeFlixifyItemId(encoded)).toEqual({ id: '12345', url: '/shows/some-slug' });
  });

  it('encodes bare id when no url is provided', () => {
    expect(encodeFlixifyItemId('12345', undefined)).toBe('12345');
    expect(decodeFlixifyItemId('12345')).toEqual({ id: '12345' });
  });

  it('preserves special characters in the url segment', () => {
    const url = '/collections/some/multi/path';
    expect(decodeFlixifyItemId(encodeFlixifyItemId('abc', url))).toEqual({ id: 'abc', url });
  });
});

describe('harvestCookies', () => {
  function makeResp(setCookie: string[]): Response {
    const headers = new Headers();
    for (const c of setCookie) headers.append('set-cookie', c);
    return new Response(null, { headers });
  }

  it('extracts pip and session cookies from Set-Cookie headers', () => {
    const res = makeResp([
      'pip=abc123; Path=/; HttpOnly',
      'session=xyz789; Path=/; HttpOnly; SameSite=Lax',
      'unrelated=foo; Path=/',
    ]);
    const result = harvestCookies(res, { pip: '', session: '' });
    expect(result).toMatchObject({ pip: 'abc123', session: 'xyz789' });
  });

  it('preserves untouched fields and returns same ref when no tracked cookie present', () => {
    const before = { pip: 'a', session: 'b' };
    const res = makeResp(['unrelated=foo']);
    expect(harvestCookies(res, before)).toBe(before);
  });

  it('updates profile_id when present', () => {
    const res = makeResp(['profile_id=p42; Path=/']);
    expect(harvestCookies(res, { pip: '', session: '' }).profile_id).toBe('p42');
  });
});
