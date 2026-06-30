import { Hono } from 'hono';
import { config } from './config';
import { corsMiddleware } from './middleware/cors';
import { errorHandler } from './middleware/error-handler';
import { requestLog } from './middleware/request-log';
import { makePairRoutes } from './routes/pair';
import { homeRoutes } from './routes/home';
import { sourceHomeRoutes } from './routes/source-home';
import { libraryRoutes } from './routes/library';
import { itemRoutes } from './routes/item';
import { searchRoutes } from './routes/search';
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
  app.route('/api/pair', makePairRoutes(() => db));
  app.route('/api/home',        homeRoutes);
  app.route('/api/source-home', sourceHomeRoutes);
  app.route('/api/library',     libraryRoutes);
  app.route('/api/item',        itemRoutes);
  app.route('/api/search',      searchRoutes);
  return app;
}
