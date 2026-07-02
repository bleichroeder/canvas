import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { Db } from '../db';
import { errorReports, type ErrorReport, type NewErrorReport } from '../db/schema';

export function insertErrorReport(db: Db, row: NewErrorReport): ErrorReport {
  const inserted = db.insert(errorReports).values(row).returning().get();
  if (!inserted) throw new Error('insertErrorReport: insert returned no row');
  return inserted;
}

export interface ListOpts {
  cursor?: string;      // opaque; encodes createdAt of last row seen
  kind?: string;
  sinceMs?: number;
  limit: number;
}

export function listErrorReports(db: Db, opts: ListOpts): ErrorReport[] {
  const conds = [];
  if (opts.kind) conds.push(eq(errorReports.errorKind, opts.kind));
  if (opts.sinceMs != null) conds.push(gte(errorReports.createdAt, opts.sinceMs));
  if (opts.cursor) {
    const cursorMs = Number(opts.cursor);
    if (Number.isFinite(cursorMs)) conds.push(lt(errorReports.createdAt, cursorMs));
  }
  const where = conds.length ? and(...conds) : undefined;
  const q = db.select().from(errorReports);
  return (where ? q.where(where) : q).orderBy(desc(errorReports.createdAt)).limit(opts.limit).all();
}

export function getErrorReport(db: Db, id: string): ErrorReport | null {
  return db.select().from(errorReports).where(eq(errorReports.id, id)).get() ?? null;
}

export function deleteErrorReport(db: Db, id: string): boolean {
  const res = db.delete(errorReports).where(eq(errorReports.id, id)).run();
  return res.changes > 0;
}

export function countErrorReports(db: Db): number {
  const r = db.select({ n: sql<number>`count(*)`.as('n') }).from(errorReports).get();
  return r?.n ?? 0;
}

export function pruneErrorReportsByAge(db: Db, olderThanMs: number): number {
  const res = db.delete(errorReports).where(lt(errorReports.createdAt, olderThanMs)).run();
  return res.changes;
}

export function pruneErrorReportsByCap(db: Db, keepNewest: number): number {
  // Delete rows where createdAt is older than the Nth-newest row's createdAt.
  const boundary = db
    .select({ createdAt: errorReports.createdAt })
    .from(errorReports)
    .orderBy(desc(errorReports.createdAt))
    .limit(1)
    .offset(keepNewest - 1)
    .get();
  if (!boundary) return 0;
  const res = db.delete(errorReports).where(lt(errorReports.createdAt, boundary.createdAt)).run();
  return res.changes;
}
