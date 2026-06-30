import { config } from './config';
import { logger } from './log';
import { app } from './app';

logger.info({ version: config.version, env: config.NODE_ENV }, 'canvas server starting');

const server = Bun.serve({
  port: config.PORT,
  hostname: config.HOST,
  fetch: app.fetch,
});

logger.info({ url: `http://${config.HOST}:${config.PORT}` }, 'listening');

const shutdown = (signal: string) => {
  logger.info({ signal }, 'shutting down');
  server.stop(false);
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
