import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeploymentConfig } from '../db/schema';

/**
 * Writes deployment state to sidecar plaintext files in the data directory.
 * Called after every deployment_config update. The entrypoint reads these
 * on container start to decide what subprocesses to spawn.
 */
export function writeDeploymentSidecarFiles(config: DeploymentConfig, dataDir: string): void {
  writeFileSync(join(dataDir, '.deployment-mode'), config.mode);
  writeFileSync(join(dataDir, '.deployment-domain'), config.domain ?? '');
  writeFileSync(join(dataDir, '.deployment-admin-email'), config.adminEmail ?? '');

  const tokenPath = join(dataDir, '.deployment-cf-token');
  writeFileSync(tokenPath, config.cfNamedToken ?? '');
  try { chmodSync(tokenPath, 0o600); } catch { /* Windows / non-POSIX */ }
}
