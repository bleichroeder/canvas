import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config';
import { logger } from './log';
import { initDb } from './db';
import { runMigrations } from './db/migrate';
import { bootstrapAdminIfNeeded } from './lib/bootstrap';
import { startReaper } from './storage/reaper';
import { buildApp } from './app';

logger.info({ version: config.version, env: config.NODE_ENV }, 'canvas server starting');

mkdirSync(dirname(config.CANVAS_DB_PATH), { recursive: true });
const db = initDb(config.CANVAS_DB_PATH);
runMigrations(db);
bootstrapAdminIfNeeded(db, { dbPath: config.CANVAS_DB_PATH, claimTokenTtlSec: 24 * 60 * 60 });
const stopReaper = startReaper(db);

// Module-level ref so the setup route can call server.requestIP(req).
// Assigned right after Bun.serve() returns; the closure is safe because
// no request can arrive before Bun.serve() completes.
let serverRef: ReturnType<typeof Bun.serve> | null = null;
const app = buildApp(db, () => serverRef);

const server = Bun.serve({
  port: config.PORT,
  hostname: config.HOST,
  fetch: app.fetch,
});
serverRef = server;

logger.info({ url: `http://${config.HOST}:${config.PORT}` }, 'listening');

const shutdown = (signal: string) => {
  logger.info({ signal }, 'shutting down');
  stopReaper();
  server.stop(false);
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
