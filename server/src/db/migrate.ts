import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import type { Db } from './index';

export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: './drizzle' });
}

// Allow `bun src/db/migrate.ts` from the package script to run migrations
// against the configured DB path. Useful for ops/debugging.
if (import.meta.main) {
  const { initDb } = await import('./index');
  const { config } = await import('../config');
  const db = initDb(config.CANVAS_DB_PATH);
  runMigrations(db);
  console.log('migrations applied');
}
