import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error-handler';
import { subtitlesRoutes } from './subtitles';

function makeApp(): Hono {
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/api/subtitles', subtitlesRoutes);
  return app;
}

describe('subtitles route', () => {
  test('400 when ?src missing', async () => {
    const res = await makeApp().fetch(new Request('http://test/api/subtitles'));
    expect(res.status).toBe(400);
  });

  test('404 when srcKey not in x-sources', async () => {
    const res = await makeApp().fetch(new Request('http://test/api/subtitles?src=missing'));
    expect(res.status).toBe(404);
  });

  test('400 when plex source is missing partId', async () => {
    const xs = JSON.stringify({ s1: { type: 'plex', baseUrl: 'http://x', token: 't' } });
    const res = await makeApp().fetch(new Request('http://test/api/subtitles?src=s1&streamId=2', {
      headers: { 'x-sources': xs },
    }));
    expect(res.status).toBe(400);
  });

  test('501 for generic source type', async () => {
    const xs = JSON.stringify({ s1: { type: 'generic', baseUrl: 'http://x', token: 't' } });
    const res = await makeApp().fetch(new Request('http://test/api/subtitles?src=s1', {
      headers: { 'x-sources': xs },
    }));
    expect(res.status).toBe(501);
  });
});
