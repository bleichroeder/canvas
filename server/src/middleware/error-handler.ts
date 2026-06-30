import type { ErrorHandler } from 'hono';
import { HttpError } from '../errors';
import { logger } from '../log';

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof HttpError) {
    logger.warn({ url: c.req.url, code: err.code, status: err.status }, err.message);
    return c.json({ error: { code: err.code, message: err.message } }, err.status as 400 | 404 | 410 | 500 | 502);
  }
  logger.error({ url: c.req.url, err: err.stack ?? err.message }, 'unhandled error');
  return c.json({ error: { code: 'INTERNAL', message: 'Internal server error' } }, 500);
};
