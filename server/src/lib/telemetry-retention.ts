import type { Db } from '../db';
import {
  countErrorReports,
  pruneErrorReportsByAge,
  pruneErrorReportsByCap,
} from '../storage/error-reports';

export interface RetentionOpts {
  retentionDays: number;
  maxRows: number;
  nowMs?: number;   // injectable for tests
}

export function runRetention(db: Db, opts: RetentionOpts): void {
  const now = opts.nowMs ?? Date.now();
  const ageBoundary = now - opts.retentionDays * 86_400_000;
  pruneErrorReportsByAge(db, ageBoundary);
  const count = countErrorReports(db);
  if (count > opts.maxRows) {
    pruneErrorReportsByCap(db, opts.maxRows);
  }
}
