import { Hono } from 'hono';
import { config } from './config';
import { corsMiddleware } from './middleware/cors';
import { requestLog } from './middleware/request-log';
import { errorHandler } from './middleware/error-handler';

export const app = new Hono();

app.use('*', corsMiddleware());
app.use('*', requestLog());
app.onError(errorHandler);

app.get('/health', (c) => c.json({ ok: true, version: config.version }));
