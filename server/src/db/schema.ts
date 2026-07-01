import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';

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

// ── Sub-project B tables ──────────────────────────────────────────────────────

export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    label: text('label').notNull(),
    role: text('role', { enum: ['admin', 'member'] }).notNull(),
    passwordHash: text('password_hash'),      // nullable; NULL = no password set yet
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    // DB-enforced singleton: at most one admin row.
    adminSingleton: uniqueIndex('users_admin_singleton')
      .on(t.role)
      .where(sql`${t.role} = 'admin'`),
  }),
);

export const claimTokens = sqliteTable(
  'claim_tokens',
  {
    token: text('token').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    usedAt: integer('used_at'),
  },
  (t) => ({
    expiresIdx: index('claim_tokens_expires').on(t.expiresAt),
  }),
);

export const deviceSessions = sqliteTable(
  'device_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    deviceLabel: text('device_label').notNull(),
    createdAt: integer('created_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
  },
  (t) => ({
    userIdx: index('device_sessions_user').on(t.userId),
  }),
);

export const sources = sqliteTable(
  'sources',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type', { enum: ['plex', 'flixify'] }).notNull(),
    baseUrl: text('base_url').notNull(),
    token: text('token').notNull(),
    label: text('label').notNull(),
    pairedByUserId: integer('paired_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull(),
  },
);

export const userSourceAccess = sqliteTable(
  'user_source_access',
  {
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    sourceId: integer('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.sourceId] }),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ClaimToken = typeof claimTokens.$inferSelect;
export type NewClaimToken = typeof claimTokens.$inferInsert;
export type DeviceSession = typeof deviceSessions.$inferSelect;
export type NewDeviceSession = typeof deviceSessions.$inferInsert;
export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type UserSourceAccess = typeof userSourceAccess.$inferSelect;
