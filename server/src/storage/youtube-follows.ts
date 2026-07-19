import { eq, and, desc } from 'drizzle-orm';
import type { Db } from '../db';
import { youtubeFollows, type YoutubeFollow } from '../db/schema';
import { nowSec } from '../lib/time';

export interface FollowInput {
  kind: 'channel' | 'playlist';
  ytId: string;
  title: string;
  thumbnail?: string | null;
}

/** A user's follows, newest first. */
export function listFollows(db: Db, userId: number): YoutubeFollow[] {
  return db
    .select()
    .from(youtubeFollows)
    .where(eq(youtubeFollows.userId, userId))
    .orderBy(desc(youtubeFollows.createdAt))
    .all();
}

/**
 * Follow a channel/playlist. Idempotent via the (user_id, kind, yt_id) unique
 * index — a repeat follow is a no-op and returns the existing row (title/
 * thumbnail are not overwritten).
 */
export function addFollow(db: Db, userId: number, input: FollowInput): YoutubeFollow {
  db.$client
    .prepare(
      `INSERT OR IGNORE INTO youtube_follows (user_id, kind, yt_id, title, thumbnail, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, input.kind, input.ytId, input.title, input.thumbnail ?? null, nowSec());
  const row = db
    .select()
    .from(youtubeFollows)
    .where(and(
      eq(youtubeFollows.userId, userId),
      eq(youtubeFollows.kind, input.kind),
      eq(youtubeFollows.ytId, input.ytId),
    ))
    .get();
  if (!row) throw new Error('addFollow: row missing after insert');
  return row;
}

/** Unfollow by id, scoped to the owner. Returns false if not found / not theirs. */
export function removeFollow(db: Db, userId: number, id: number): boolean {
  const existing = db
    .select()
    .from(youtubeFollows)
    .where(and(eq(youtubeFollows.id, id), eq(youtubeFollows.userId, userId)))
    .get();
  if (!existing) return false;
  db.delete(youtubeFollows).where(eq(youtubeFollows.id, id)).run();
  return true;
}
