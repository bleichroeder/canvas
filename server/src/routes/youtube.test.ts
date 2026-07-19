import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { makeYoutubeRoutes } from './youtube';
import { requireUser } from '../middleware/auth';
import { errorHandler } from '../middleware/error-handler';
import { createUser } from '../storage/users';
import { createDeviceSession } from '../storage/device-sessions';
import { generateBearer, hashBearer } from '../lib/bearer';
import type { YtDlp } from '../lib/ytdlp';

// Fake yt-dlp: resolveFollowMeta reads title + thumbnails from the -J payload.
const fakeYt: YtDlp = { json: async () => ({ title: 'Resolved Title', thumbnails: [{ url: 't://thumb' }] }) };

async function makeFixture(yt: YtDlp = fakeYt) {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  const user = createUser(db, { label: 'A', role: 'admin' });
  const bearer = generateBearer();
  createDeviceSession(db, { userId: user.id, deviceLabel: 'd', tokenHash: await hashBearer(bearer) });
  const app = new Hono();
  app.onError(errorHandler);
  app.use('/api/youtube/*', requireUser(() => db));
  app.route('/api/youtube', makeYoutubeRoutes(() => db, yt));
  return { app, bearer };
}

const auth = (bearer: string) => ({ authorization: `Bearer ${bearer}`, 'content-type': 'application/json' });

describe('youtube follows routes', () => {
  test('POST /follows {kind, ytId} resolves meta, stores, and lists', async () => {
    const { app, bearer } = await makeFixture();
    const res = await app.fetch(new Request('http://t/api/youtube/follows', {
      method: 'POST', headers: auth(bearer), body: JSON.stringify({ kind: 'channel', ytId: 'UCabc' }),
    }));
    expect(res.status).toBe(201);
    const f = await res.json() as { kind: string; ytId: string; title: string; thumbnail: string };
    expect(f).toMatchObject({ kind: 'channel', ytId: 'UCabc', title: 'Resolved Title', thumbnail: 't://thumb' });

    const list = await (await app.fetch(new Request('http://t/api/youtube/follows', { headers: auth(bearer) }))).json() as unknown[];
    expect(list).toHaveLength(1);
  });

  test('POST /follows {url} parses a playlist link', async () => {
    const { app, bearer } = await makeFixture();
    const res = await app.fetch(new Request('http://t/api/youtube/follows', {
      method: 'POST', headers: auth(bearer), body: JSON.stringify({ url: 'https://www.youtube.com/playlist?list=PLabc123' }),
    }));
    expect(res.status).toBe(201);
    const f = await res.json() as { kind: string; ytId: string };
    expect(f).toMatchObject({ kind: 'playlist', ytId: 'PLabc123' });
  });

  test('POST /follows with neither url nor kind/ytId is 400', async () => {
    const { app, bearer } = await makeFixture();
    const res = await app.fetch(new Request('http://t/api/youtube/follows', {
      method: 'POST', headers: auth(bearer), body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });

  test('POST /follows with an unparseable url is 400', async () => {
    const { app, bearer } = await makeFixture();
    const res = await app.fetch(new Request('http://t/api/youtube/follows', {
      method: 'POST', headers: auth(bearer), body: JSON.stringify({ url: 'https://example.com/not-youtube' }),
    }));
    expect(res.status).toBe(400);
  });

  test('DELETE /follows/:id removes, then 404s', async () => {
    const { app, bearer } = await makeFixture();
    const created = await (await app.fetch(new Request('http://t/api/youtube/follows', {
      method: 'POST', headers: auth(bearer), body: JSON.stringify({ kind: 'channel', ytId: 'UCx' }),
    }))).json() as { id: number };
    const del = await app.fetch(new Request(`http://t/api/youtube/follows/${created.id}`, { method: 'DELETE', headers: auth(bearer) }));
    expect(del.status).toBe(204);
    const del2 = await app.fetch(new Request(`http://t/api/youtube/follows/${created.id}`, { method: 'DELETE', headers: auth(bearer) }));
    expect(del2.status).toBe(404);
  });

  test('requires auth', async () => {
    const { app } = await makeFixture();
    const res = await app.fetch(new Request('http://t/api/youtube/follows'));
    expect(res.status).toBe(401);
  });
});
