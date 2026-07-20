import { eq, and, desc } from 'drizzle-orm';
import type { Db } from '../db';
import { youtubeLikes, type YoutubeLike } from '../db/schema';
import { nowSec } from '../lib/time';

export interface LikeInput {
  ytId: string;
  title: string;
  thumbnail?: string | null;
  channelId?: string | null;
  channelTitle?: string | null;
  durationSec?: number | null;
}

/** A user's liked videos, newest first. */
export function listLikes(db: Db, userId: number): YoutubeLike[] {
  return db
    .select()
    .from(youtubeLikes)
    .where(eq(youtubeLikes.userId, userId))
    .orderBy(desc(youtubeLikes.createdAt))
    .all();
}

/**
 * Like a video. Idempotent via the (user_id, yt_id) unique index — a repeat
 * like is a no-op and returns the existing row (cached metadata is not
 * overwritten).
 */
export function addLike(db: Db, userId: number, input: LikeInput): YoutubeLike {
  db.$client
    .prepare(
      `INSERT OR IGNORE INTO youtube_likes
         (user_id, yt_id, title, thumbnail, channel_id, channel_title, duration_sec, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      input.ytId,
      input.title,
      input.thumbnail ?? null,
      input.channelId ?? null,
      input.channelTitle ?? null,
      input.durationSec ?? null,
      nowSec(),
    );
  const row = db
    .select()
    .from(youtubeLikes)
    .where(and(eq(youtubeLikes.userId, userId), eq(youtubeLikes.ytId, input.ytId)))
    .get();
  if (!row) throw new Error('addLike: row missing after insert');
  return row;
}

/** Unlike by video id, scoped to the owner. Returns false if not liked. */
export function removeLikeByYtId(db: Db, userId: number, ytId: string): boolean {
  const existing = db
    .select()
    .from(youtubeLikes)
    .where(and(eq(youtubeLikes.userId, userId), eq(youtubeLikes.ytId, ytId)))
    .get();
  if (!existing) return false;
  db.delete(youtubeLikes).where(eq(youtubeLikes.id, existing.id)).run();
  return true;
}
