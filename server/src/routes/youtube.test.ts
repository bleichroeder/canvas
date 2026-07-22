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
const fakeYt: YtDlp = { json: async () => ({ title: 'Resolved Title', thumbnails: [{ url: 't://thumb' }] }), text: async () => '' };

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

describe('youtube likes routes', () => {
  test('POST /likes stores cached metadata, lists, then unlikes by ytId', async () => {
    const { app, bearer } = await makeFixture();
    const res = await app.fetch(new Request('http://t/api/youtube/likes', {
      method: 'POST', headers: auth(bearer),
      body: JSON.stringify({ ytId: 'v:abc', title: 'A Video', thumbnail: 't://p', channelId: 'UCx', channelTitle: 'Chan', durationSec: 42 }),
    }));
    expect(res.status).toBe(201);
    const like = await res.json() as { ytId: string; title: string; durationSec: number };
    expect(like).toMatchObject({ ytId: 'v:abc', title: 'A Video', durationSec: 42 });

    const list = await (await app.fetch(new Request('http://t/api/youtube/likes', { headers: auth(bearer) }))).json() as unknown[];
    expect(list).toHaveLength(1);

    const del = await app.fetch(new Request('http://t/api/youtube/likes/v%3Aabc', { method: 'DELETE', headers: auth(bearer) }));
    expect(del.status).toBe(204);
    const del2 = await app.fetch(new Request('http://t/api/youtube/likes/v%3Aabc', { method: 'DELETE', headers: auth(bearer) }));
    expect(del2.status).toBe(404);
  });

  test('POST /likes is idempotent on (user, ytId)', async () => {
    const { app, bearer } = await makeFixture();
    const body = JSON.stringify({ ytId: 'v:dup', title: 'Dup' });
    await app.fetch(new Request('http://t/api/youtube/likes', { method: 'POST', headers: auth(bearer), body }));
    await app.fetch(new Request('http://t/api/youtube/likes', { method: 'POST', headers: auth(bearer), body }));
    const list = await (await app.fetch(new Request('http://t/api/youtube/likes', { headers: auth(bearer) }))).json() as unknown[];
    expect(list).toHaveLength(1);
  });

  test('POST /likes without ytId/title is 400', async () => {
    const { app, bearer } = await makeFixture();
    const res = await app.fetch(new Request('http://t/api/youtube/likes', {
      method: 'POST', headers: auth(bearer), body: JSON.stringify({ ytId: 'v:x' }),
    }));
    expect(res.status).toBe(400);
  });
});

describe('youtube history routes', () => {
  test('POST /history records + lists with resume position, newest first', async () => {
    const { app, bearer } = await makeFixture();
    await app.fetch(new Request('http://t/api/youtube/history', {
      method: 'POST', headers: auth(bearer),
      body: JSON.stringify({ ytId: 'v:a', title: 'A', posSec: 30, durationSec: 100 }),
    }));
    await app.fetch(new Request('http://t/api/youtube/history', {
      method: 'POST', headers: auth(bearer),
      body: JSON.stringify({ ytId: 'v:b', title: 'B', posSec: 5 }),
    }));
    const list = await (await app.fetch(new Request('http://t/api/youtube/history', { headers: auth(bearer) }))).json() as Array<{ ytId: string; posSec: number }>;
    expect(list.map((h) => h.ytId)).toEqual(['v:b', 'v:a']); // most-recent first
    expect(list.find((h) => h.ytId === 'v:a')?.posSec).toBe(30);
  });

  test('POST /history upserts position and bumps to top', async () => {
    const { app, bearer } = await makeFixture();
    const rec = (ytId: string, posSec: number) => app.fetch(new Request('http://t/api/youtube/history', {
      method: 'POST', headers: auth(bearer), body: JSON.stringify({ ytId, title: ytId, posSec }),
    }));
    await rec('v:a', 10);
    await rec('v:b', 10);
    await new Promise((r) => setTimeout(r, 3)); // ensure a later ms stamp
    await rec('v:a', 42); // re-watch A → moves to top, pos updated
    const list = await (await app.fetch(new Request('http://t/api/youtube/history', { headers: auth(bearer) }))).json() as Array<{ ytId: string; posSec: number }>;
    expect(list).toHaveLength(2);
    expect(list[0]!.ytId).toBe('v:a');
    expect(list[0]!.posSec).toBe(42);
  });

  test('POST /history without ytId/title is 400', async () => {
    const { app, bearer } = await makeFixture();
    const res = await app.fetch(new Request('http://t/api/youtube/history', {
      method: 'POST', headers: auth(bearer), body: JSON.stringify({ posSec: 5 }),
    }));
    expect(res.status).toBe(400);
  });

  test('DELETE /history/:ytId removes one; DELETE /history clears all', async () => {
    const { app, bearer } = await makeFixture();
    const rec = (ytId: string) => app.fetch(new Request('http://t/api/youtube/history', {
      method: 'POST', headers: auth(bearer), body: JSON.stringify({ ytId, title: ytId, posSec: 1 }),
    }));
    await rec('v:a'); await rec('v:b');
    expect((await app.fetch(new Request('http://t/api/youtube/history/v%3Aa', { method: 'DELETE', headers: auth(bearer) }))).status).toBe(204);
    let list = await (await app.fetch(new Request('http://t/api/youtube/history', { headers: auth(bearer) }))).json() as unknown[];
    expect(list).toHaveLength(1);
    expect((await app.fetch(new Request('http://t/api/youtube/history', { method: 'DELETE', headers: auth(bearer) }))).status).toBe(204);
    list = await (await app.fetch(new Request('http://t/api/youtube/history', { headers: auth(bearer) }))).json() as unknown[];
    expect(list).toHaveLength(0);
  });
});

describe('youtube search route', () => {
  test('GET /search with no query returns empty', async () => {
    const { app, bearer } = await makeFixture();
    const res = await app.fetch(new Request('http://t/api/youtube/search', { headers: auth(bearer) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
  });

  test('GET /search returns empty when the user has no YouTube source', async () => {
    const { app, bearer } = await makeFixture();
    const res = await app.fetch(new Request('http://t/api/youtube/search?q=cats&offset=0&limit=15', { headers: auth(bearer) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
  });
});
