import { describe, expect, test } from 'bun:test';
import {
  HttpError, PairNotFoundError, PairExpiredError, UpstreamError, PlexHttpError,
} from './errors';

describe('errors', () => {
  test('PairNotFoundError is an HttpError 404', () => {
    const e = new PairNotFoundError('XYZ');
    expect(e).toBeInstanceOf(HttpError);
    expect(e.status).toBe(404);
    expect(e.code).toBe('PAIR_NOT_FOUND');
    expect(e.message).toContain('XYZ');
  });

  test('PlexHttpError is an UpstreamError with status from Plex', () => {
    const e = new PlexHttpError(404, '/library/sections/99/all', '<html>404</html>');
    expect(e).toBeInstanceOf(UpstreamError);
    expect(e).toBeInstanceOf(HttpError);
    expect(e.status).toBe(502); // canvas returns 502 to client
    expect(e.upstreamStatus).toBe(404);
    expect(e.upstreamUrl).toBe('/library/sections/99/all');
    expect(e.message).toContain('Plex 404');
    expect(e.message).toContain('/library/sections/99/all');
  });

  test('PlexHttpError truncates long bodies in the message', () => {
    const longBody = 'x'.repeat(500);
    const e = new PlexHttpError(500, '/foo', longBody);
    expect(e.message.length).toBeLessThan(300);
  });
});
