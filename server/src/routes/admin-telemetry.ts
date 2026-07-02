import { Hono } from 'hono';
import type { Db } from '../db';
import {
  listErrorReports,
  getErrorReport,
  deleteErrorReport,
} from '../storage/error-reports';

const PAGE_SIZE = 25;

export function makeAdminTelemetryRoutes(getDb: () => Db) {
  const r = new Hono();

  r.get('/telemetry/errors', (c) => {
    const cursor = c.req.query('cursor');
    const kind = c.req.query('kind');
    const sinceStr = c.req.query('since');
    const sinceMs = sinceStr && /^\d+$/.test(sinceStr) ? Number(sinceStr) : undefined;

    const rows = listErrorReports(getDb(), {
      ...(cursor !== undefined && { cursor }),
      ...(kind !== undefined && { kind }),
      ...(sinceMs !== undefined && { sinceMs }),
      limit: PAGE_SIZE,
    });

    const nextCursor = rows.length === PAGE_SIZE ? String(rows[rows.length - 1]!.createdAt) : null;

    return c.json({
      rows: rows.map((row) => ({
        id: row.id,
        created_at: row.createdAt,
        error_kind: row.errorKind,
        error_message: row.errorMessage,
        source_type: row.sourceType,
        canvas_version: row.canvasVersion,
        user_agent: row.userAgent,
      })),
      nextCursor,
    });
  });

  r.get('/telemetry/errors/:id', (c) => {
    const row = getErrorReport(getDb(), c.req.param('id'));
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({
      id: row.id,
      created_at: row.createdAt,
      user_id: row.userId,
      canvas_version: row.canvasVersion,
      user_agent: row.userAgent,
      error_message: row.errorMessage,
      error_kind: row.errorKind,
      source_type: row.sourceType,
      report_json: row.reportJson,
    });
  });

  r.delete('/telemetry/errors/:id', (c) => {
    const deleted = deleteErrorReport(getDb(), c.req.param('id'));
    if (!deleted) return c.json({ error: 'not_found' }, 404);
    return c.body(null, 204);
  });

  return r;
}
