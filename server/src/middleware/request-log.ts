import type { MiddlewareHandler } from 'hono';
import { logger } from '../log';

export function requestLog(): MiddlewareHandler {
  return async (c, next) => {
    const start = performance.now();
    await next();
    const ms = Math.round(performance.now() - start);
    logger.info(
      { method: c.req.method, path: new URL(c.req.url).pathname, status: c.res.status, ms },
      'request',
    );
  };
}
