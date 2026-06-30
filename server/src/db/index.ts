import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema';

export type Db = BunSQLiteDatabase<typeof schema>;

export function initDb(path: string): Db {
  const sqlite = new Database(path, { create: true });
  // WAL mode gives concurrent reads + writes; matches typical SQLite-server
  // best practice. The pragma is idempotent.
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  return drizzle(sqlite, { schema });
}

export { schema };
