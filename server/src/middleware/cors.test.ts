import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { corsMiddleware } from './cors';

function makeApp() {
  const app = new Hono();
  app.use('*', corsMiddleware());
  app.get('/', (c) => c.text('ok'));
  app.post('/', (c) => c.text('ok'));
  return app;
}

describe('corsMiddleware', () => {
  test('OPTIONS preflight includes content-type and authorization in Access-Control-Allow-Headers', async () => {
    const app = makeApp();
    const res = await app.fetch(new Request('http://test/', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type, authorization',
      },
    }));
    const allowHeaders = res.headers.get('access-control-allow-headers') ?? '';
    expect(allowHeaders.toLowerCase()).toContain('content-type');
    expect(allowHeaders.toLowerCase()).toContain('authorization');
  });
});
