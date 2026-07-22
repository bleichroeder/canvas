import { eq, and, desc } from 'drizzle-orm';
import type { Db } from '../db';
import { youtubeHistory, type YoutubeHistory } from '../db/schema';

export interface HistoryInput {
  ytId: string;
  title: string;
  thumbnail?: string | null;
  channelId?: string | null;
  channelTitle?: string | null;
  durationSec?: number | null;
  posSec: number;
}

/** A user's watch history, most-recently-watched first. */
export function listHistory(db: Db, userId: number, limit = 50): YoutubeHistory[] {
  return db
    .select()
    .from(youtubeHistory)
    .where(eq(youtubeHistory.userId, userId))
    // updatedAt is a millisecond stamp; id desc is a stable tiebreak.
    .orderBy(desc(youtubeHistory.updatedAt), desc(youtubeHistory.id))
    .limit(limit)
    .all();
}

/**
 * Record (or update) a watched video with its latest position. Upserts on the
 * (user_id, yt_id) unique index so re-watching moves the row to the top and
 * refreshes the resume position + cached metadata.
 */
export function recordHistory(db: Db, userId: number, input: HistoryInput): YoutubeHistory {
  db.$client
    .prepare(
      `INSERT INTO youtube_history
         (user_id, yt_id, title, thumbnail, channel_id, channel_title, duration_sec, pos_sec, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, yt_id) DO UPDATE SET
         title = excluded.title,
         thumbnail = excluded.thumbnail,
         channel_id = excluded.channel_id,
         channel_title = excluded.channel_title,
         duration_sec = excluded.duration_sec,
         pos_sec = excluded.pos_sec,
         updated_at = excluded.updated_at`,
    )
    .run(
      userId,
      input.ytId,
      input.title,
      input.thumbnail ?? null,
      input.channelId ?? null,
      input.channelTitle ?? null,
      input.durationSec ?? null,
      Math.max(0, Math.floor(input.posSec)),
      Date.now(), // millisecond sort key so same-second re-watches still order
    );
  const row = db
    .select()
    .from(youtubeHistory)
    .where(and(eq(youtubeHistory.userId, userId), eq(youtubeHistory.ytId, input.ytId)))
    .get();
  if (!row) throw new Error('recordHistory: row missing after upsert');
  return row;
}

/** Remove one video from history, scoped to the owner. Returns false if absent. */
export function removeHistory(db: Db, userId: number, ytId: string): boolean {
  const existing = db
    .select()
    .from(youtubeHistory)
    .where(and(eq(youtubeHistory.userId, userId), eq(youtubeHistory.ytId, ytId)))
    .get();
  if (!existing) return false;
  db.delete(youtubeHistory).where(eq(youtubeHistory.id, existing.id)).run();
  return true;
}

/** Clear the caller's entire watch history. */
export function clearHistory(db: Db, userId: number): void {
  db.delete(youtubeHistory).where(eq(youtubeHistory.userId, userId)).run();
}
