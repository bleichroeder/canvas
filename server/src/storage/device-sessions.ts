import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db';
import { deviceSessions, type DeviceSession, type NewDeviceSession } from '../db/schema';
import { nowSec } from '../lib/time';

export function createDeviceSession(db: Db, input: { userId: number; deviceLabel: string; tokenHash: string }): DeviceSession {
  const now = nowSec();
  const row: NewDeviceSession = {
    tokenHash: input.tokenHash,
    userId: input.userId,
    deviceLabel: input.deviceLabel,
    createdAt: now,
    lastSeenAt: now,
  };
  const inserted = db.insert(deviceSessions).values(row).returning().get();
  if (!inserted) throw new Error('createDeviceSession: insert returned no row');
  return inserted;
}

export function getDeviceSession(db: Db, tokenHash: string): DeviceSession | null {
  return db.select().from(deviceSessions).where(eq(deviceSessions.tokenHash, tokenHash)).get() ?? null;
}

export function touchDeviceSession(db: Db, tokenHash: string, now: number = nowSec()): void {
  db.update(deviceSessions).set({ lastSeenAt: now }).where(eq(deviceSessions.tokenHash, tokenHash)).run();
}

export function listUserDevices(db: Db, userId: number): DeviceSession[] {
  return db
    .select()
    .from(deviceSessions)
    .where(eq(deviceSessions.userId, userId))
    .orderBy(desc(deviceSessions.lastSeenAt))
    .all();
}

export function deleteDeviceSession(db: Db, tokenHash: string): void {
  db.delete(deviceSessions).where(eq(deviceSessions.tokenHash, tokenHash)).run();
}

export function deleteUserDeviceSessions(db: Db, userId: number): void {
  db.delete(deviceSessions).where(eq(deviceSessions.userId, userId)).run();
}
