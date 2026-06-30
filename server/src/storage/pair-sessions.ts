import { eq, lt } from 'drizzle-orm';
import type { Db } from '../db';
import { pairSessions, type NewPairSession, type PairSession, type PairPayload } from '../db/schema';
import { nowSec } from '../lib/time';

export function getPairSession(db: Db, code: string): PairSession | null {
  const row = db.select().from(pairSessions).where(eq(pairSessions.code, code)).get();
  return row ?? null;
}

export function createPairSession(db: Db, input: NewPairSession): PairSession {
  db.insert(pairSessions).values(input).run();
  const row = getPairSession(db, input.code);
  if (!row) throw new Error(`createPairSession: row not found after insert (code=${input.code})`);
  return row;
}

export function updatePairSessionPayload(db: Db, code: string, payload: PairPayload): void {
  db.update(pairSessions).set({ payload }).where(eq(pairSessions.code, code)).run();
}

export function setPairSessionStatus(
  db: Db,
  code: string,
  status: PairSession['status'],
): void {
  db.update(pairSessions).set({ status }).where(eq(pairSessions.code, code)).run();
}

export function deletePairSession(db: Db, code: string): void {
  db.delete(pairSessions).where(eq(pairSessions.code, code)).run();
}

export function reapPairSessions(db: Db, now: number = nowSec()): number {
  const result = db.delete(pairSessions).where(lt(pairSessions.expiresAt, now)).run();
  return result.changes ?? 0;
}
