import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Db } from '../db';
import { insertErrorReport } from '../storage/error-reports';
import { runRetention } from '../lib/telemetry-retention';
import { createRateLimiter } from '../lib/rate-limit';
import { randomUUID } from 'crypto';

export interface TelemetryRouteOpts {
  enabled: boolean;
  retentionDays: number;
  maxRows: number;
}

const MAX_BYTES = 256 * 1024;
const MAX_EVENTS = 1000;

function getClientIp(c: Context): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return c.req.header('x-real-ip') ?? 'unknown';
}

interface Payload {
  events: unknown[];
  session: {
    userAgent?: unknown;
    viewport?: unknown;
    screen?: unknown;
    canvasVersion?: unknown;
    sourceType?: unknown;
    connectionType?: unknown;
  };
  error: {
    message?: unknown;
    kind?: unknown;
    stack?: unknown;
  };
}

function validatePayload(body: unknown): { ok: true; value: Payload } | { ok: false; reason: string } {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'body must be object' };
  const p = body as Record<string, unknown>;
  if (!Array.isArray(p.events)) return { ok: false, reason: 'events must be array' };
  if (p.events.length > MAX_EVENTS) return { ok: false, reason: `events exceeds ${MAX_EVENTS}` };
  if (!p.session || typeof p.session !== 'object') return { ok: false, reason: 'session required' };
  if (!p.error || typeof p.error !== 'object') return { ok: false, reason: 'error required' };
  return { ok: true, value: p as unknown as Payload };
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function makeTelemetryRoutes(getDb: () => Db, opts: TelemetryRouteOpts): Hono {
  const r = new Hono();
  const rateLimit = createRateLimiter({ windowMs: 60_000, max: 10 });

  r.post('/telemetry/error', async (c) => {
    if (!opts.enabled) return c.body(null, 204);

    const ip = getClientIp(c);
    if (!rateLimit(ip)) return c.json({ error: 'rate_limited' }, 429);

    // Size check: prefer content-length header when trustworthy.
    const cl = Number(c.req.header('content-length') ?? '0');
    if (cl > MAX_BYTES) return c.json({ error: 'payload_too_large' }, 413);

    let rawText: string;
    try {
      rawText = await c.req.text();
    } catch {
      return c.json({ error: 'invalid_body' }, 400);
    }
    if (rawText.length > MAX_BYTES) return c.json({ error: 'payload_too_large' }, 413);

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    const check = validatePayload(parsed);
    if (!check.ok) return c.json({ error: check.reason }, 400);
    const payload = check.value;

    // Opportunistic user_id capture: read bearer, look up session, else null.
    // For now, always null (auth path added later if needed; POST is public).
    const userId: number | null = null;

    const id = randomUUID();
    const db = getDb();
    insertErrorReport(db, {
      id,
      createdAt: Date.now(),
      userId,
      canvasVersion: str(payload.session.canvasVersion) ?? null,
      userAgent: str(payload.session.userAgent) ?? null,
      errorMessage: str(payload.error.message) ?? null,
      errorKind: str(payload.error.kind) ?? 'unknown',
      sourceType: str(payload.session.sourceType) ?? null,
      reportJson: rawText,
    });

    // Fire-and-forget retention prune (synchronous; SQLite is fast).
    try {
      runRetention(db, { retentionDays: opts.retentionDays, maxRows: opts.maxRows });
    } catch {
      // Never let retention failure surface to the caller.
    }

    return c.json({ id });
  });

  return r;
}
