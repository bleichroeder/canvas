import { describe, expect, it } from 'bun:test';
import { parseXSources } from './x-sources';

function makeReq(headerValue: string | null): Request {
  const headers = new Headers();
  if (headerValue !== null) headers.set('x-sources', headerValue);
  return new Request('https://example.com/', { headers });
}

describe('parseXSources', () => {
  it('returns {} when header missing', () => {
    expect(parseXSources(makeReq(null))).toEqual({});
  });

  it('returns {} on malformed JSON', () => {
    expect(parseXSources(makeReq('{not json'))).toEqual({});
  });

  it('parses valid sources', () => {
    const v = parseXSources(
      makeReq('{"a":{"type":"plex","baseUrl":"https://plex.example","token":"t1"}}'),
    );
    expect(v).toEqual({
      a: { type: 'plex', baseUrl: 'https://plex.example', token: 't1' },
    });
  });

  it('drops entries with missing fields', () => {
    const v = parseXSources(
      makeReq('{"a":{"type":"plex","baseUrl":"x"},"b":{"type":"jellyfin","baseUrl":"y","token":"t"}}'),
    );
    expect(v).toEqual({ b: { type: 'jellyfin', baseUrl: 'y', token: 't' } });
  });

  it('drops entries with invalid type', () => {
    const v = parseXSources(
      makeReq('{"a":{"type":"bogus","baseUrl":"x","token":"t"}}'),
    );
    expect(v).toEqual({});
  });
});
