import type { AppDeps } from '../context.js';

/** All metrics are computed from data stored in the Hub database. Nothing is hardcoded. */
export async function getDashboard(deps: AppDeps, days = 14) {
  if (!deps.cols) throw new Error('Database unavailable');
  const c = deps.cols;
  const since = new Date(deps.now().getTime() - days * 86_400_000);
  since.setUTCHours(0, 0, 0, 0);

  const [integrationCounts, transferCounts, qaCounts, recentRuns, recentErrors, trend] = await Promise.all([
    c.integrations.aggregate([{ $group: { _id: '$active', n: { $sum: 1 } } }]).toArray(),
    c.runs.aggregate([{ $group: { _id: '$transferStatus', n: { $sum: 1 } } }]).toArray(),
    c.runs.aggregate([{ $group: { _id: '$qa.status', n: { $sum: 1 } } }]).toArray(),
    c.runs
      .find({}, { projection: { integrationName: 1, entityType: 1, transferStatus: 1, 'qa.status': 1, 'verification.status': 1, httpStatus: 1, createdAt: 1, endedAt: 1, correlationId: 1, sourceRecordKey: 1 } })
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray(),
    c.runs
      .find({ $or: [{ transferStatus: { $in: ['FAILED', 'TIMEOUT'] } }, { 'qa.status': { $in: ['FAILED', 'ERROR'] } }, { 'verification.status': { $in: ['MISMATCH', 'ERROR'] } }] }, { projection: { integrationName: 1, transferStatus: 1, 'qa.status': 1, 'qa.message': 1, 'verification.status': 1, errorSummary: 1, updatedAt: 1, httpStatus: 1 } })
      .sort({ updatedAt: -1 })
      .limit(10)
      .toArray(),
    c.runs
      .aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, status: '$transferStatus' }, n: { $sum: 1 } } },
      ])
      .toArray(),
  ]);

  const byKey = (rows: { _id: unknown; n: number }[]) => Object.fromEntries(rows.map((r) => [String(r._id), r.n]));
  const ic = byKey(integrationCounts as never);
  const tc = byKey(transferCounts as never);
  const qc = byKey(qaCounts as never);
  const totalExecutions = Object.values(tc).reduce((a, b) => a + b, 0);

  const trendMap = new Map<string, Record<string, number>>();
  for (let d = 0; d <= days; d++) {
    const day = new Date(since.getTime() + d * 86_400_000).toISOString().slice(0, 10);
    trendMap.set(day, {});
  }
  for (const row of trend as unknown as { _id: { day: string; status: string }; n: number }[]) {
    const bucket = trendMap.get(row._id.day);
    if (bucket) bucket[row._id.status] = row.n;
  }

  return {
    generatedAt: deps.now(),
    integrations: { total: (ic.true ?? 0) + (ic.false ?? 0), active: ic.true ?? 0, inactive: ic.false ?? 0 },
    executions: {
      total: totalExecutions,
      successfulTransfers: tc.SUCCESS ?? 0,
      failedTransfers: (tc.FAILED ?? 0) + (tc.TIMEOUT ?? 0),
      pending: (tc.PENDING ?? 0) + (tc.RUNNING ?? 0) + (tc.RETRYING ?? 0),
      cancelled: tc.CANCELLED ?? 0,
      byStatus: tc,
    },
    qa: { passed: qc.PASSED ?? 0, failed: qc.FAILED ?? 0, errors: qc.ERROR ?? 0, running: (qc.PENDING ?? 0) + (qc.RUNNING ?? 0), notStarted: qc.NOT_STARTED ?? 0, byStatus: qc },
    recentRuns,
    recentErrors,
    trend: Array.from(trendMap.entries()).map(([day, counts]) => ({ day, ...counts })),
  };
}
