import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// Payload shapes — typed JSON columns. Schema is per-table; route handlers
// cast at the boundary.
export interface PairPayload {
  // For type='plex': may carry baseUrl/token after approval
  // For type='flixify': carries pin/pinUrl/mirror during pending, source after approval
  [k: string]: unknown;
}

export interface SourceStatusPayload {
  // Snapshot of the source-status response (publiclyReachable, lastSeenAt, …)
  [k: string]: unknown;
}

export const pairSessions = sqliteTable(
  'pair_sessions',
  {
    code: text('code').primaryKey(),
    type: text('type', { enum: ['plex', 'flixify'] }).notNull(),
    status: text('status', { enum: ['pending', 'approved', 'expired'] }).notNull(),
    payload: text('payload', { mode: 'json' }).$type<PairPayload>().notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => ({
    expiresIdx: index('pair_sessions_expires').on(t.expiresAt),
  }),
);

export const sourceStatusCache = sqliteTable(
  'source_status_cache',
  {
    sourceKey: text('source_key').primaryKey(),
    status: text('status').notNull(),
    lastSeenAt: integer('last_seen_at'),
    expiresAt: integer('expires_at').notNull(),
    payload: text('payload', { mode: 'json' }).$type<SourceStatusPayload>().notNull(),
  },
  (t) => ({
    expiresIdx: index('source_status_cache_expires').on(t.expiresAt),
  }),
);

export type PairSession = typeof pairSessions.$inferSelect;
export type NewPairSession = typeof pairSessions.$inferInsert;
export type SourceStatusCacheRow = typeof sourceStatusCache.$inferSelect;
export type NewSourceStatusCacheRow = typeof sourceStatusCache.$inferInsert;
