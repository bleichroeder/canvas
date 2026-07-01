import { Hono } from 'hono';
import type { Db } from '../db';
import { countAdmins, createUser, setPasswordHash } from '../storage/users';
import { updateDeploymentConfig } from '../storage/deployment-config';
import { writeDeploymentSidecarFiles } from '../lib/deployment-writer';
import { createDeviceSession } from '../storage/device-sessions';
import { generateBearer, hashBearer } from '../lib/bearer';
import { config } from '../config';
import { logger } from '../log';

/**
 * Whether a client IP is trusted to initiate first-run setup.
 *
 * Accepts loopback + any RFC1918 private-network address. The wider criteria
 * is deliberate: when canvas runs inside Docker, `docker run -p 8787:8787`
 * NATs external requests so they arrive at Bun from Docker's bridge network
 * (e.g. 172.17.0.1) — the actual client's IP is lost. Requiring literal
 * loopback would make /api/setup unreachable from any browser outside the
 * container, defeating the point.
 *
 * The security posture is: canvas at :8787 should only be exposed to trusted
 * networks before an admin exists. Anyone with LAN or same-host access can
 * complete setup; that's the same trust boundary users get for `docker run`
 * itself.
 */
export function isTrustedSetupClient(remoteAddr: string | null | undefined): boolean {
  if (!remoteAddr) return false;
  // Strip IPv4-mapped IPv6 prefix (::ffff:x.x.x.x)
  const addr = remoteAddr.replace(/^::ffff:/, '');
  // IPv6 loopback
  if (addr === '::1') return true;
  // IPv4 literal
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(addr);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 127) return true;                              // 127.0.0.0/8 loopback
  if (a === 10) return true;                               // 10.0.0.0/8
  if (a === 192 && b === 168) return true;                 // 192.168.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true;        // 172.16.0.0/12
  return false;
}

// Use the return type of Bun.serve() rather than the generic Server<T> type
// to avoid having to supply the WebSocketData type parameter.
type BunServer = ReturnType<typeof Bun.serve>;

export function makeSetupRoutes(getDb: () => Db, getServer: () => BunServer | null) {
  const r = new Hono();

  // GET /setup/probe — public "is setup needed?" flag for the frontend.
  // No auth, no host restriction — this leaks no secrets, just tells the
  // wizard whether to redirect to /#/setup or /#/sign-in on load.
  r.get('/setup/probe', (c) => {
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
    if (!isTrustedSetupClient(remoteAddr)) {
      logger.warn({ remoteAddr }, 'setup attempt from untrusted host');
      return c.json({ error: 'setup can only be initiated from a trusted host (loopback or LAN)' }, 403);
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
