import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { libraryRoutes } from './library';
import { errorHandler } from '../middleware/error-handler';

describe('library route', () => {
  test('returns 502 when srcKey is not in x-sources header', async () => {
    const app = new Hono();
    app.onError(errorHandler);
    app.route('/api/library', libraryRoutes);
    const res = await app.fetch(new Request('http://test/api/library/missing'));
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/source not paired/);
  });
});
