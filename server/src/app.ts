import { Hono } from 'hono';
import { config } from './config';
import { corsMiddleware } from './middleware/cors';
import { errorHandler } from './middleware/error-handler';
import { requestLog } from './middleware/request-log';
import { makePairRoutes } from './routes/pair';
import type { Db } from './db';

export function buildApp(db: Db): Hono {
  const app = new Hono();
  app.use('*', corsMiddleware());
  app.use('*', requestLog());
  app.onError(errorHandler);
  app.get('/health', (c) => c.json({ ok: true, version: config.version }));
  app.route('/api/pair', makePairRoutes(() => db));
  return app;
}
