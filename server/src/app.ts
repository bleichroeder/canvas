import { Hono } from 'hono';
import { config } from './config';
import { corsMiddleware } from './middleware/cors';
import { errorHandler } from './middleware/error-handler';
import { requestLog } from './middleware/request-log';
import { requireUser, requireAdmin } from './middleware/auth';
import { makeAuthRoutes } from './routes/auth';
import { makeAdminRoutes } from './routes/admin';
import { makePairRoutes } from './routes/pair';
import { homeRoutes } from './routes/home';
import { sourceHomeRoutes } from './routes/source-home';
import { libraryRoutes } from './routes/library';
import { itemRoutes } from './routes/item';
import { searchRoutes } from './routes/search';
import { playRoutes } from './routes/play';
import { progressRoutes } from './routes/progress';
import { makeSourceStatusRoutes } from './routes/source-status';
import { subtitlesRoutes } from './routes/subtitles';
import { registerAdapter } from './sources/registry';
import { plexAdapter } from './sources/plex';
import { flixifyAdapter } from './sources/flixify';
import type { Db } from './db';

// Register source adapters at module scope so they are available before any
// request is served. Re-registration via Map.set is idempotent.
registerAdapter(plexAdapter);
registerAdapter(flixifyAdapter);

export function buildApp(db: Db): Hono {
  const app = new Hono();
  app.use('*', corsMiddleware());
  app.use('*', requestLog());
  app.onError(errorHandler);
  app.get('/health', (c) => c.json({ ok: true, version: config.version }));

  // Auth routes — /claim is public; /me, /logout, /devices/* require auth
  // internally via requireUser applied inside makeAuthRoutes.
  app.route('/api/auth', makeAuthRoutes(() => db));

  // Everything else under /api/* requires a valid bearer token.
  app.use('/api/pair/*',        requireUser(() => db));
  app.use('/api/home',          requireUser(() => db));
  app.use('/api/source-home',   requireUser(() => db));
  app.use('/api/library/*',     requireUser(() => db));
  app.use('/api/item/*',        requireUser(() => db));
  app.use('/api/search',        requireUser(() => db));
  app.use('/api/play/*',        requireUser(() => db));
  app.use('/api/progress/*',    requireUser(() => db));
  app.use('/api/source-status', requireUser(() => db));
  app.use('/api/subtitles',     requireUser(() => db));
  app.use('/api/admin/*',       requireUser(() => db));
  app.use('/api/admin/*',       requireAdmin);
  // (sources management mount comes in Task 5)

  app.route('/api/pair',           makePairRoutes(() => db));
  app.route('/api/home',           homeRoutes);
  app.route('/api/source-home',    sourceHomeRoutes);
  app.route('/api/library',        libraryRoutes);
  app.route('/api/item',           itemRoutes);
  app.route('/api/search',         searchRoutes);
  app.route('/api/play',           playRoutes);
  app.route('/api/progress',       progressRoutes);
  app.route('/api/source-status',  makeSourceStatusRoutes(() => db));
  app.route('/api/subtitles',      subtitlesRoutes);
  app.route('/api/admin',          makeAdminRoutes(() => db));
  return app;
}
