import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error-handler';
import { progressRoutes } from './progress';

function makeApp(): Hono {
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/api/progress', progressRoutes);
  return app;
}

describe('progress route', () => {
  test('400 when posSec missing', async () => {
    const res = await makeApp().fetch(new Request('http://test/api/progress/s1/abc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });

  test('400 when body is malformed JSON', async () => {
    const res = await makeApp().fetch(new Request('http://test/api/progress/s1/abc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    }));
    expect(res.status).toBe(400);
  });

  test('502 when srcKey not in x-sources', async () => {
    const res = await makeApp().fetch(new Request('http://test/api/progress/s1/abc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ posSec: 30 }),
    }));
    expect(res.status).toBe(502);
  });
});
