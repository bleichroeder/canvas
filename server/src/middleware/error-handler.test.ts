import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { errorHandler } from './error-handler';
import { PairNotFoundError } from '../errors';

function makeApp() {
  const app = new Hono();
  app.onError(errorHandler);
  return app;
}

describe('errorHandler', () => {
  test('maps HttpError subclass to typed JSON response', async () => {
    const app = makeApp();
    app.get('/x', () => { throw new PairNotFoundError('ABC'); });
    const res = await app.fetch(new Request('http://test/x'));
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('PAIR_NOT_FOUND');
    expect(body.error.message).toContain('ABC');
  });

  test('maps unknown errors to 500 with INTERNAL code', async () => {
    const app = makeApp();
    app.get('/x', () => { throw new Error('boom'); });
    const res = await app.fetch(new Request('http://test/x'));
    expect(res.status).toBe(500);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INTERNAL');
    // message must not leak internal details
    expect(body.error.message).not.toContain('boom');
  });
});
