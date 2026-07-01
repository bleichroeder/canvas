import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { deploymentConfig, type DeploymentConfig, type NewDeploymentConfig } from '../db/schema';
import { nowSec } from '../lib/time';

export function getDeploymentConfig(db: Db): DeploymentConfig {
  const row = db.select().from(deploymentConfig).where(eq(deploymentConfig.id, 1)).get();
  if (!row) throw new Error('deployment_config singleton row missing; migration 0003 not run?');
  return row;
}

export type DeploymentPatch = Partial<Omit<NewDeploymentConfig, 'id'>>;

export function updateDeploymentConfig(db: Db, patch: DeploymentPatch): DeploymentConfig {
  db.update(deploymentConfig)
    .set({ ...patch, lastAppliedAt: nowSec() })
    .where(eq(deploymentConfig.id, 1))
    .run();
  return getDeploymentConfig(db);
}
