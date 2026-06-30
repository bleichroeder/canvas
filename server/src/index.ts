import { config } from './config';
import { logger } from './log';
import { initDb } from './db';
import { runMigrations } from './db/migrate';
import { startReaper } from './storage/reaper';
import { buildApp } from './app';

logger.info({ version: config.version, env: config.NODE_ENV }, 'canvas server starting');

const db = initDb(config.CANVAS_DB_PATH);
runMigrations(db);
const stopReaper = startReaper(db);
const app = buildApp(db);

const server = Bun.serve({
  port: config.PORT,
  hostname: config.HOST,
  fetch: app.fetch,
});

logger.info({ url: `http://${config.HOST}:${config.PORT}` }, 'listening');

const shutdown = (signal: string) => {
  logger.info({ signal }, 'shutting down');
  stopReaper();
  server.stop(false);
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
