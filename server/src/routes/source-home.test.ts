import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { sourceHomeRoutes } from './source-home';
import { errorHandler } from '../middleware/error-handler';

describe('source-home route', () => {
  test('returns 400 when ?key is missing', async () => {
    const app = new Hono();
    app.onError(errorHandler);
    app.route('/api/source-home', sourceHomeRoutes);
    const res = await app.fetch(new Request('http://test/api/source-home'));
    expect(res.status).toBe(400);
  });

  test('returns 404 when key is not in x-sources header', async () => {
    const app = new Hono();
    app.onError(errorHandler);
    app.route('/api/source-home', sourceHomeRoutes);
    const res = await app.fetch(new Request('http://test/api/source-home?key=missing'));
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/source not paired/);
  });
});
