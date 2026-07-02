import { and, desc, eq, gte, lt, notInArray, sql } from 'drizzle-orm';
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
  const rows = db.delete(errorReports).where(eq(errorReports.id, id)).returning({ id: errorReports.id }).all();
  return rows.length > 0;
}

export function countErrorReports(db: Db): number {
  const r = db.select({ n: sql<number>`count(*)`.as('n') }).from(errorReports).get();
  return r?.n ?? 0;
}

export function pruneErrorReportsByAge(db: Db, olderThanMs: number): number {
  const rows = db.delete(errorReports).where(lt(errorReports.createdAt, olderThanMs)).returning({ id: errorReports.id }).all();
  return rows.length;
}

export function pruneErrorReportsByCap(db: Db, keepNewest: number): number {
  // Identify the rows to keep by id, then delete everything else.
  // Using id-based exclusion avoids the timestamp-collision bug where multiple
  // rows share the boundary createdAt and a `createdAt < boundary` filter
  // would retain all of them, leaving the table above keepNewest.
  const keepIds = db
    .select({ id: errorReports.id })
    .from(errorReports)
    .orderBy(desc(errorReports.createdAt))
    .limit(keepNewest)
    .all()
    .map((r) => r.id);
  if (keepIds.length < keepNewest) return 0; // fewer rows than cap; nothing to prune
  const rows = db.delete(errorReports).where(notInArray(errorReports.id, keepIds)).returning({ id: errorReports.id }).all();
  return rows.length;
}
