import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { updatePreferences, type NewUpdatePreferencesRow } from '../db/schema';

export interface UpdatePreferences {
  autoUpdate: boolean;
  lastAutoCheckAt: number | null;
}

/**
 * Read the singleton preferences row. If the row doesn't exist yet (fresh
 * install or immediately after migration), seed it with defaults and return
 * those. This avoids needing a manual INSERT statement in the migration.
 */
export function getUpdatePreferences(db: Db): UpdatePreferences {
  const row = db.select().from(updatePreferences).where(eq(updatePreferences.id, 1)).get();
  if (row) {
    return { autoUpdate: row.autoUpdate, lastAutoCheckAt: row.lastAutoCheckAt };
  }
  db.insert(updatePreferences).values({ id: 1, autoUpdate: false, lastAutoCheckAt: null }).run();
  return { autoUpdate: false, lastAutoCheckAt: null };
}

export function setUpdatePreferences(
  db: Db,
  patch: Partial<UpdatePreferences>,
): UpdatePreferences {
  // Ensure the row exists.
  getUpdatePreferences(db);
  const set: Partial<NewUpdatePreferencesRow> = {};
  if (patch.autoUpdate !== undefined) set.autoUpdate = patch.autoUpdate;
  if (patch.lastAutoCheckAt !== undefined) set.lastAutoCheckAt = patch.lastAutoCheckAt;
  if (Object.keys(set).length === 0) return getUpdatePreferences(db);
  db.update(updatePreferences).set(set).where(eq(updatePreferences.id, 1)).run();
  return getUpdatePreferences(db);
}
