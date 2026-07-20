import { Hono } from 'hono';
import type { Db } from '../db';
import type { YtDlp } from '../lib/ytdlp';
import { getAuthContext } from '../middleware/auth';
import { getUserSources } from '../lib/user-sources';
import { getAdapter } from '../sources/registry';
import { listFollows, addFollow, removeFollow } from '../storage/youtube-follows';
import { listLikes, addLike, removeLikeByYtId } from '../storage/youtube-likes';
import { parseFollowUrl, resolveFollowMeta } from '../sources/youtube';
import { logger } from '../log';

// Per-user followed YouTube channels/playlists — the curated feed shown on the
// YouTube destination page. Authed (mounted under requireUser in app.ts).
export function makeYoutubeRoutes(getDb: () => Db, yt: YtDlp) {
  const r = new Hono();

  // GET /follows — the caller's follows, newest first.
  r.get('/follows', (c) => {
    const auth = getAuthContext(c);
    return c.json(listFollows(getDb(), auth.userId));
  });

  // POST /follows — body is either { kind, ytId } or { url } (a pasted link).
  // Resolves the display title/thumbnail via yt-dlp, then stores it (idempotent).
  r.post('/follows', async (c) => {
    const auth = getAuthContext(c);
    const body = await c.req.json().catch(() => ({})) as { kind?: unknown; ytId?: unknown; url?: unknown };

    let kind: 'channel' | 'playlist';
    let ytId: string;
    if (typeof body.url === 'string' && body.url.trim()) {
      const parsed = parseFollowUrl(body.url);
      if (!parsed) return c.json({ error: 'could not find a channel or playlist in that URL' }, 400);
      ({ kind, ytId } = parsed);
    } else if ((body.kind === 'channel' || body.kind === 'playlist') && typeof body.ytId === 'string' && body.ytId) {
      kind = body.kind;
      ytId = body.ytId;
    } else {
      return c.json({ error: 'provide {kind, ytId} or {url}' }, 400);
    }

    const meta = await resolveFollowMeta(yt, kind, ytId);
    const follow = addFollow(getDb(), auth.userId, { kind, ytId, title: meta.title, thumbnail: meta.thumbnail ?? null });
    logger.info({ userId: auth.userId, kind, ytId }, 'youtube follow added');
    return c.json(follow, 201);
  });

  // DELETE /follows/:id — unfollow (owner-scoped).
  r.delete('/follows/:id', (c) => {
    const auth = getAuthContext(c);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
    const ok = removeFollow(getDb(), auth.userId, id);
    return ok ? c.body(null, 204) : c.json({ error: 'follow not found' }, 404);
  });

  // GET /search?q=&offset=&limit=[&source=] — paged YouTube search for the
  // YouTube destination page. Unlike the aggregated /api/search (single shot,
  // capped at 30), this windows results so the page can infinite-scroll.
  r.get('/search', async (c) => {
    const q = (c.req.query('q') ?? '').trim();
    if (!q) return c.json({ items: [] });
    const offset = Math.max(0, Math.trunc(Number(c.req.query('offset') ?? 0)) || 0);
    const limit = Math.min(30, Math.max(1, Math.trunc(Number(c.req.query('limit') ?? 15)) || 15));
    const sources = getUserSources(getDb(), getAuthContext(c));
    const wantKey = c.req.query('source');
    const entry = wantKey && sources[wantKey]?.type === 'youtube'
      ? sources[wantKey]
      : Object.values(sources).find((s) => s.type === 'youtube');
    if (!entry) return c.json({ items: [] });
    const items = await getAdapter('youtube').search({ baseUrl: entry.baseUrl, token: entry.token }, q, { offset, limit });
    return c.json({ items });
  });

  // GET /likes — the caller's liked videos, newest first.
  r.get('/likes', (c) => {
    const auth = getAuthContext(c);
    return c.json(listLikes(getDb(), auth.userId));
  });

  // POST /likes — like a video. Body carries the video id plus cached metadata
  // (title/thumbnail/channel/duration) so the "Liked" rail renders without a
  // per-video yt-dlp lookup. Idempotent.
  r.post('/likes', async (c) => {
    const auth = getAuthContext(c);
    const body = await c.req.json().catch(() => ({})) as {
      ytId?: unknown; title?: unknown; thumbnail?: unknown;
      channelId?: unknown; channelTitle?: unknown; durationSec?: unknown;
    };
    if (typeof body.ytId !== 'string' || !body.ytId || typeof body.title !== 'string' || !body.title) {
      return c.json({ error: 'provide {ytId, title}' }, 400);
    }
    const like = addLike(getDb(), auth.userId, {
      ytId: body.ytId,
      title: body.title,
      thumbnail: typeof body.thumbnail === 'string' ? body.thumbnail : null,
      channelId: typeof body.channelId === 'string' ? body.channelId : null,
      channelTitle: typeof body.channelTitle === 'string' ? body.channelTitle : null,
      durationSec: typeof body.durationSec === 'number' ? body.durationSec : null,
    });
    return c.json(like, 201);
  });

  // DELETE /likes/:ytId — unlike (owner-scoped).
  r.delete('/likes/:ytId', (c) => {
    const auth = getAuthContext(c);
    const ytId = c.req.param('ytId');
    if (!ytId) return c.json({ error: 'invalid id' }, 400);
    const ok = removeLikeByYtId(getDb(), auth.userId, ytId);
    return ok ? c.body(null, 204) : c.json({ error: 'like not found' }, 404);
  });

  return r;
}
