import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db';
import { users, type User, type NewUser } from '../db/schema';
import { nowSec } from '../lib/time';

export function getUser(db: Db, id: number): User | null {
  return db.select().from(users).where(eq(users.id, id)).get() ?? null;
}

export function getUserByLabel(db: Db, label: string): User | null {
  return db.select().from(users).where(eq(users.label, label)).get() ?? null;
}

export function listUsers(db: Db): User[] {
  return db.select().from(users).all();
}

export function createUser(db: Db, input: { label: string; role: 'admin' | 'member' }): User {
  const row: NewUser = {
    label: input.label,
    role: input.role,
    createdAt: nowSec(),
  };
  const inserted = db.insert(users).values(row).returning().get();
  if (!inserted) throw new Error(`createUser: insert returned no row (label=${input.label})`);
  return inserted;
}

export function deleteUser(db: Db, id: number): void {
  db.delete(users).where(eq(users.id, id)).run();
}

export function countAdmins(db: Db): number {
  const r = db.select({ c: sql<number>`count(*)` }).from(users).where(eq(users.role, 'admin')).get();
  return r?.c ?? 0;
}

export function setPasswordHash(db: Db, userId: number, hash: string): void {
  db.update(users).set({ passwordHash: hash }).where(eq(users.id, userId)).run();
}

export function getPasswordHash(db: Db, userId: number): string | null {
  const row = db.select({ h: users.passwordHash }).from(users).where(eq(users.id, userId)).get();
  return row?.h ?? null;
}
