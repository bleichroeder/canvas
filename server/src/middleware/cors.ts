import { cors } from 'hono/cors';
import { config } from '../config';

export function corsMiddleware() {
  return cors({
    origin: (origin) => (config.CANVAS_ALLOWED_ORIGINS.includes(origin) ? origin : null),
    allowHeaders: ['content-type', 'authorization'],
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    maxAge: 600,
    credentials: false,
  });
}
