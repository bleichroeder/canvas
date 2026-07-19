import { Hono } from 'hono';
import type { Db } from '../db';
import type { YtDlp } from '../lib/ytdlp';
import { getAuthContext } from '../middleware/auth';
import { listFollows, addFollow, removeFollow } from '../storage/youtube-follows';
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

  return r;
}
