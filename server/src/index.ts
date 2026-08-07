import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config';
import { logger } from './log';
import { initDb } from './db';
import { runMigrations } from './db/migrate';
import { bootstrapAdminIfNeeded } from './lib/bootstrap';
import { refreshDeploymentSync } from './lib/deployment-sync';
import { startReaper } from './storage/reaper';
import { makeWatchtowerClient } from './lib/watchtower-client';
import { detectPublicUrlDrift } from './lib/tunnel-url-drift';
import { startAutoUpdateWorker } from './lib/auto-update-worker';
import { buildApp } from './app';

logger.info({ version: config.version, env: config.NODE_ENV }, 'canvas server starting');

mkdirSync(dirname(config.CANVAS_DB_PATH), { recursive: true });
const db = initDb(config.CANVAS_DB_PATH);
runMigrations(db);
bootstrapAdminIfNeeded(db, { dbPath: config.CANVAS_DB_PATH, claimTokenTtlSec: 24 * 60 * 60 });

// Reconcile deployment_config with runtime after a restart: flip status
// from pending/applying back to ready, populate publicUrl from sidecar for
// cf-quick, etc.
const deployConf = refreshDeploymentSync(db, config.CANVAS_DATA_DIR);

// Detect if the public tunnel URL changed across restarts (sub-project P).
// Runs once at boot after the deployment sidecar has been read.
detectPublicUrlDrift(db, deployConf.publicUrl);

const watchtowerClient = makeWatchtowerClient({
  url: config.WATCHTOWER_URL,
  token: config.WATCHTOWER_TOKEN,
});

const stopReaper = startReaper(db);
const stopAutoUpdate = startAutoUpdateWorker({
  getDb: () => db,
  watchtowerClient,
  currentVersion: config.CANVAS_VERSION,
});

// Module-level ref so the setup route can call server.requestIP(req).
// Assigned right after Bun.serve() returns; the closure is safe because
// no request can arrive before Bun.serve() completes.
let serverRef: ReturnType<typeof Bun.serve> | null = null;
const app = buildApp(db, () => serverRef, watchtowerClient);

const server = Bun.serve({
  port: config.PORT,
  hostname: config.HOST,
  // Bun's default idle timeout (10s) kills a connection that sends/receives no
  // bytes for that long. The YouTube /stream response is a long-lived media
  // pipe the client reads with backpressure — when its playback buffer fills
  // (~10-15s ahead) it stops reading the socket, which read as "idle" and got
  // the connection killed mid-playback (client saw a 200 whose body then
  // errored, every few minutes). 120s is far longer than any backpressure
  // pause or reasonable user pause, yet still reaps a half-open connection
  // (e.g. the car dropping signal without a clean close) within ~2min so it
  // doesn't hold one of the YT_MAX_CONCURRENT_STREAMS slots indefinitely.
  idleTimeout: 120,
  fetch: app.fetch,
});
serverRef = server;

logger.info({ url: `http://${config.HOST}:${config.PORT}` }, 'listening');

const shutdown = (signal: string) => {
  logger.info({ signal }, 'shutting down');
  stopReaper();
  stopAutoUpdate.stop();
  server.stop(false);
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
