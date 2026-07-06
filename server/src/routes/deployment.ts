import { Hono } from 'hono';
import type { Db } from '../db';
import { updateDeploymentConfig, type DeploymentPatch } from '../storage/deployment-config';
import { writeDeploymentSidecarFiles } from '../lib/deployment-writer';
import { refreshDeploymentSync } from '../lib/deployment-sync';
import { config } from '../config';
import { logger } from '../log';

const RESTART_DELAY_MS = 2000;

export function scheduleRestart(reason: string): void {
  logger.info({ reason }, 'restart scheduled');
  setTimeout(() => {
    logger.info('sending SIGTERM to PID 1');
    try {
      process.kill(1, 'SIGTERM');
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'SIGTERM to PID 1 failed');
    }
  }, RESTART_DELAY_MS);
}

const VALID_MODES = ['local', 'domain', 'cf-quick', 'cf-named'] as const;
type DeploymentMode = typeof VALID_MODES[number];

export function makeDeploymentRoutes(getDb: () => Db) {
  const r = new Hono();

  // Admin — full config, minus the secret token.
  r.get('/admin/deployment', async (c) => {
    // Refresh in case cf-quick's public URL just landed in the sidecar file.
    const conf = refreshDeploymentSync(getDb(), config.CANVAS_DATA_DIR);
    return c.json({
      mode: conf.mode,
      domain: conf.domain,
      adminEmail: conf.adminEmail,
      publicUrl: conf.publicUrl,
      status: conf.status,
      statusMessage: conf.statusMessage,
      certExpiresAt: conf.certExpiresAt,
      lastAppliedAt: conf.lastAppliedAt,
      hasCfNamedToken: conf.cfNamedToken !== null && conf.cfNamedToken.length > 0,
      externallyManaged: config.CANVAS_EXTERNAL_PROXY,
      publicUrlChangedAt: conf.publicUrlChangedAt,
      previousPublicUrl: conf.previousPublicUrl,
    });
  });

  r.post('/admin/deployment', async (c) => {
    if (config.CANVAS_EXTERNAL_PROXY) {
      return c.json({ error: 'deployment is externally managed (CANVAS_EXTERNAL_PROXY=1)' }, 409);
    }
    const body = await c.req.json().catch(() => null) as {
      mode?: string; domain?: string; adminEmail?: string; cfNamedToken?: string;
    } | null;
    if (!body || !body.mode || !(VALID_MODES as readonly string[]).includes(body.mode)) {
      return c.json({ error: 'invalid mode' }, 400);
    }
    const mode = body.mode as DeploymentMode;
    // Mode-specific validation.
    if (mode === 'domain' && (!body.domain || body.domain.length < 3)) {
      return c.json({ error: 'domain required for mode=domain' }, 400);
    }
    if (mode === 'cf-named' && (!body.cfNamedToken || body.cfNamedToken.length < 20)) {
      return c.json({ error: 'cf tunnel token required for mode=cf-named' }, 400);
    }

    const patch: DeploymentPatch = {
      mode,
      domain: body.domain ?? null,
      adminEmail: body.adminEmail ?? null,
      cfNamedToken: body.cfNamedToken ?? null,
      status: 'pending',
      statusMessage: null,
      publicUrl: null,  // cleared; will be repopulated after apply
    };
    const updated = updateDeploymentConfig(getDb(), patch);
    writeDeploymentSidecarFiles(updated, config.CANVAS_DATA_DIR);
    scheduleRestart(`deployment mode changed to ${mode}`);
    return c.body(null, 204);
  });

  r.post('/admin/deployment/apply', async (c) => {
    scheduleRestart('manual apply');
    return c.body(null, 204);
  });

  // Public — safe subset. Also picks up cf-quick's late-arriving public URL
  // by re-reading the sidecar file on each poll.
  r.get('/deployment/status', async (c) => {
    const conf = refreshDeploymentSync(getDb(), config.CANVAS_DATA_DIR);
    return c.json({
      mode: conf.mode,
      status: conf.status,
      publicUrl: conf.publicUrl,
      externallyManaged: config.CANVAS_EXTERNAL_PROXY,
      publicUrlChangedAt: conf.publicUrlChangedAt,
      previousPublicUrl: conf.previousPublicUrl,
    });
  });

  return r;
}
