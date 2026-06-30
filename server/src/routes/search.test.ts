import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { searchRoutes } from './search';
import { errorHandler } from '../middleware/error-handler';

describe('search route', () => {
  test('empty q returns empty hits + errors immediately (no x-sources call)', async () => {
    const app = new Hono();
    app.onError(errorHandler);
    app.route('/api/search', searchRoutes);
    const res = await app.fetch(new Request('http://test/api/search?q='));
    expect(res.status).toBe(200);
    const body = await res.json() as { hits: unknown[]; errors: unknown[] };
    expect(body.hits).toEqual([]);
    expect(body.errors).toEqual([]);
  });
});
