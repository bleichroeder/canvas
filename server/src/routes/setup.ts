import { Hono } from 'hono';
import type { Db } from '../db';
import { countAdmins, createUser, setPasswordHash } from '../storage/users';
import { updateDeploymentConfig } from '../storage/deployment-config';
import { writeDeploymentSidecarFiles } from '../lib/deployment-writer';
import { createDeviceSession } from '../storage/device-sessions';
import { generateBearer, hashBearer } from '../lib/bearer';
import { config } from '../config';
import { logger } from '../log';

export function isLoopback(remoteAddr: string | null | undefined): boolean {
  if (!remoteAddr) return false;
  return (
    remoteAddr === '127.0.0.1' ||
    remoteAddr === '::1' ||
    remoteAddr === '::ffff:127.0.0.1'
  );
}

// Use the return type of Bun.serve() rather than the generic Server<T> type
// to avoid having to supply the WebSocketData type parameter.
type BunServer = ReturnType<typeof Bun.serve>;

export function makeSetupRoutes(getDb: () => Db, getServer: () => BunServer | null) {
  const r = new Hono();

  // GET /setup/probe — lightweight loopback-only reachability check (no auth).
  // Used by the first-run wizard to verify it's running on the same host.
  r.get('/setup/probe', (c) => {
    const server = getServer();
    let remoteAddr: string | null = null;
    if (server) {
      try {
        const ip = server.requestIP(c.req.raw);
        remoteAddr = ip?.address ?? null;
      } catch { /* fallthrough */ }
    }
    if (!isLoopback(remoteAddr)) {
      return c.json({ error: 'setup can only be initiated from localhost' }, 403);
    }
    const noAdmin = countAdmins(getDb()) === 0;
    return c.json({ setupRequired: noAdmin });
  });

  // POST /setup — first-run admin creation (localhost-only, no auth required).
  r.post('/setup', async (c) => {
    // Guard 1: no admin exists yet.
    if (countAdmins(getDb()) > 0) {
      return c.json({ error: 'setup already complete' }, 409);
    }

    // Guard 2: request must come from loopback (setup has no auth; localhost is the trust boundary).
    const server = getServer();
    let remoteAddr: string | null = null;
    if (server) {
      try {
        const ip = server.requestIP(c.req.raw);
        remoteAddr = ip?.address ?? null;
      } catch { /* fallthrough */ }
    }
    if (!isLoopback(remoteAddr)) {
      logger.warn({ remoteAddr }, 'setup attempt from non-loopback');
      return c.json({ error: 'setup can only be initiated from localhost' }, 403);
    }

    const body = await c.req.json().catch(() => null) as {
      adminUsername?: string; adminPassword?: string; deviceLabel?: string;
    } | null;
    if (
      !body ||
      typeof body.adminUsername !== 'string' || body.adminUsername.length < 2 || body.adminUsername.length > 32 ||
      typeof body.adminPassword !== 'string' || body.adminPassword.length < 8 ||
      typeof body.deviceLabel !== 'string' || body.deviceLabel.length === 0
    ) {
      return c.json(
        { error: 'adminUsername (2-32 chars), adminPassword (8+ chars), deviceLabel required' },
        400,
      );
    }

    // Create admin.
    const admin = createUser(getDb(), { label: body.adminUsername, role: 'admin' });
    const hash = await Bun.password.hash(body.adminPassword);
    setPasswordHash(getDb(), admin.id, hash);

    // Issue a bearer immediately so the wizard can continue as admin.
    const bearer = generateBearer();
    const tokenHash = await hashBearer(bearer);
    createDeviceSession(getDb(), {
      userId: admin.id,
      deviceLabel: body.deviceLabel,
      tokenHash,
    });

    // Deployment stays 'local' until wizard step 2 updates it.
    const updated = updateDeploymentConfig(getDb(), { status: 'ready' });
    writeDeploymentSidecarFiles(updated, config.CANVAS_DATA_DIR);

    logger.info({ userId: admin.id, label: admin.label }, 'localhost setup complete');
    return c.json({
      bearer,
      user: { id: admin.id, label: admin.label, role: admin.role, hasPassword: true },
    });
  });

  return r;
}
