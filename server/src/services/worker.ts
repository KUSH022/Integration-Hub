/**
 * Database-backed job worker. Runs inside the API process (free tiers do not offer separate
 * background workers). All state lives in MongoDB, so executions survive restarts:
 * - PENDING runs are claimed atomically with a lease.
 * - Expired leases are recovered: runs that never sent a request are re-queued; runs that may have
 *   sent a non-idempotent request are marked FAILED with "outcome unknown" (never silently re-sent).
 * - QA validations are triggered and polled asynchronously; HTTP requests never wait for them.
 */
import os from 'node:os';
import type { AppDeps } from '../context.js';
import type { Connection, Integration, IntegrationRun, QaState } from '../core/domain.js';
import { executeRun, type IdempotencyStore } from '../core/engine.js';
import { pollQa, triggerQa } from '../core/qa.js';
import { sha256Json } from '../core/crypto.js';
import { audit } from './audit.js';
import { readSecret } from './connections.js';
import { expectedPayloadRef } from './runs.js';

const workerId = `${os.hostname()}-${process.pid}`;

function cols(deps: AppDeps) {
  if (!deps.cols) throw new Error('Database unavailable');
  return deps.cols;
}

export function mongoIdempotencyStore(deps: AppDeps): IdempotencyStore {
  return {
    async reserve(integrationId, key, runId) {
      const c = cols(deps).idempotency;
      try {
        await c.insertOne({ _id: key as never, integrationId, runId, status: 'IN_PROGRESS', createdAt: deps.now(), updatedAt: deps.now() });
        return { reserved: true };
      } catch (e) {
        if ((e as { code?: number }).code !== 11000) throw e;
        const existing = await c.findOne({ _id: key as never });
        if (existing && existing.status === 'FAILED') {
          // A previous attempt definitively failed: take over the key.
          await c.updateOne({ _id: key as never, status: 'FAILED' }, { $set: { runId, status: 'IN_PROGRESS', updatedAt: deps.now() } });
          return { reserved: true };
        }
        return { reserved: false, existingRunId: existing?.runId, existingStatus: existing?.status };
      }
    },
    async complete(_integrationId, key, runId, status) {
      // TIMEOUT means the outcome is unknown: keep the key blocked so it is not blindly resent.
      const s = status === 'SUCCESS' ? 'SUCCESS' : status === 'TIMEOUT' ? 'UNKNOWN' : 'FAILED';
      await cols(deps).idempotency.updateOne({ _id: key as never, runId }, { $set: { status: s, updatedAt: deps.now() } });
    },
  };
}

export async function processRun(deps: AppDeps, run: IntegrationRun) {
  const c = cols(deps);
  const persist = async (patch: Partial<IntegrationRun>) => {
    const leaseUntil = new Date(deps.now().getTime() + deps.config.RUN_LEASE_SECONDS * 1000);
    const set: Record<string, unknown> = { ...patch, updatedAt: deps.now() };
    if (!('lease' in patch)) set.lease = { owner: workerId, until: leaseUntil };
    // requestSnapshot is write-once: only set it when not already present.
    if (patch.requestSnapshot) {
      delete set.requestSnapshot;
      await c.runs.updateOne({ _id: run._id as never, requestSnapshot: null }, { $set: { requestSnapshot: patch.requestSnapshot } });
    }
    await c.runs.updateOne({ _id: run._id as never }, { $set: set });
  };
  try {
    const integration = (await c.integrations.findOne({ _id: run.integrationId as never })) as unknown as Integration | null;
    if (!integration) {
      await persist({ transferStatus: 'FAILED', stage: 'CONFIGURATION', errorSummary: 'Integration no longer exists', endedAt: deps.now(), lease: null });
      return;
    }
    if (sha256Json(run.sourceSnapshot) !== run.sourceSnapshotHash) {
      await persist({ transferStatus: 'FAILED', stage: 'INTEGRITY', errorSummary: 'Source snapshot hash mismatch; snapshot integrity cannot be guaranteed', endedAt: deps.now(), lease: null });
      return;
    }
    const conn = (await c.connections.findOne({ _id: integration.destination.connectionId as never })) as unknown as Connection | null;
    if (!conn) {
      await persist({ transferStatus: 'FAILED', stage: 'CONFIGURATION', errorSummary: 'Destination connection no longer exists', endedAt: deps.now(), lease: null });
      return;
    }
    await audit(deps, { action: 'EXECUTION_STARTED', resourceType: 'run', resourceId: run._id, actor: 'worker', details: { integrationId: integration._id, correlationId: run.correlationId } });
    let secret: string | undefined;
    try {
      secret = readSecret(deps, conn);
    } catch (e) {
      await persist({ transferStatus: 'FAILED', stage: 'CONFIGURATION', errorSummary: (e as Error).message, endedAt: deps.now(), lease: null });
      return;
    }
    const outcome = await executeRun(
      { run, integration, connection: conn, secret },
      {
        send: deps.send,
        now: deps.now,
        persist,
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        idempotency: mongoIdempotencyStore(deps),
        isCancelled: async () => Boolean((await c.runs.findOne({ _id: run._id as never }, { projection: { cancelRequested: 1 } }))?.cancelRequested),
        historyHasKey: async (integrationId, keyField, keyValue, excludeRunId) =>
          Boolean(await c.runs.findOne({ integrationId, transferStatus: 'SUCCESS', _id: { $ne: excludeRunId as never }, [`requestSnapshot.body.${keyField}`]: keyValue }, { projection: { _id: 1 } })),
      },
    );
    await audit(deps, {
      action: outcome.transferStatus === 'SUCCESS' ? 'EXECUTION_COMPLETED' : 'EXECUTION_FAILED',
      resourceType: 'run', resourceId: run._id, actor: 'worker', result: outcome.transferStatus === 'SUCCESS' ? 'SUCCESS' : 'FAILURE',
      details: { transferStatus: outcome.transferStatus, verification: outcome.verification.status, qa: outcome.qa.status },
    });
  } catch (e) {
    console.error(JSON.stringify({ level: 'error', message: 'run processing crashed', runId: run._id, error: (e as Error).message }));
    const current = await c.runs.findOne({ _id: run._id as never }, { projection: { requestSnapshot: 1 } });
    const sent = Boolean(current?.requestSnapshot);
    await c.runs.updateOne({ _id: run._id as never }, { $set: { transferStatus: 'FAILED', stage: 'INTERNAL', errorSummary: `Internal error during execution${sent ? '; the request may have been sent — check the destination' : ''}`, endedAt: deps.now(), updatedAt: deps.now(), lease: null } });
  }
}

/** Recovers runs whose worker lease expired (crash, restart, free-tier sleep). */
export async function recoverStaleRuns(deps: AppDeps) {
  const c = cols(deps);
  const now = deps.now();
  const stale = await c.runs.find({ transferStatus: { $in: ['RUNNING', 'RETRYING'] }, 'lease.until': { $lt: now } }, { projection: { requestSnapshot: 1, attempts: 1 } }).limit(100).toArray();
  for (const r of stale) {
    const method = r.requestSnapshot?.method as string | undefined;
    if (!r.requestSnapshot) {
      await c.runs.updateOne({ _id: r._id, 'lease.until': { $lt: now } }, { $set: { transferStatus: 'PENDING', stage: 'QUEUED', lease: null, updatedAt: now, recoveredAt: now } });
    } else if (method === 'PUT' || method === 'DELETE') {
      await c.runs.updateOne({ _id: r._id, 'lease.until': { $lt: now } }, { $set: { transferStatus: 'PENDING', stage: 'QUEUED', lease: null, updatedAt: now, recoveredAt: now } });
    } else {
      await c.runs.updateOne(
        { _id: r._id, 'lease.until': { $lt: now } },
        { $set: { transferStatus: 'FAILED', stage: 'INTERRUPTED', lease: null, endedAt: now, updatedAt: now, errorSummary: `Execution was interrupted after a ${method} request may have been sent. Outcome at the destination is unknown and it was not re-sent automatically.`, verification: { status: 'NOT_APPLICABLE', message: 'Interrupted' } } },
      );
    }
    await audit(deps, { action: 'EXECUTION_RECOVERED', resourceType: 'run', resourceId: String(r._id), actor: 'worker', details: { method } });
  }
  // QA triggers interrupted between claim and response: outcome unknown, do not re-trigger.
  await c.runs.updateMany(
    { 'qa.status': 'RUNNING', 'qa.qaExecutionId': { $exists: false }, qaLeaseUntil: { $lt: now } },
    { $set: { 'qa.status': 'ERROR', 'qa.message': 'QA trigger was interrupted; it is unknown whether KP QA Agent received it', 'qa.completedAt': now, updatedAt: now } },
  );
}

async function claimRun(deps: AppDeps): Promise<IntegrationRun | null> {
  const now = deps.now();
  const r = await cols(deps).runs.findOneAndUpdate(
    { transferStatus: 'PENDING' },
    { $set: { transferStatus: 'RUNNING', stage: 'CLAIMED', lease: { owner: workerId, until: new Date(now.getTime() + deps.config.RUN_LEASE_SECONDS * 1000) }, updatedAt: now } },
    { sort: { createdAt: 1 }, returnDocument: 'after' },
  );
  return (r as unknown as IntegrationRun) ?? null;
}

function qaVars(deps: AppDeps, run: IntegrationRun, integration: Integration, destConn: Connection | null) {
  const body = run.requestSnapshot?.body ?? null;
  return {
    executionId: run._id,
    correlationId: run.correlationId,
    entityType: run.entityType,
    integrationId: run.integrationId,
    integrationName: run.integrationName,
    operation: run.requestSnapshot ? { method: run.requestSnapshot.method, path: integration.destination.endpointPath } : null,
    operationMethod: run.requestSnapshot?.method ?? null,
    operationPath: integration.destination.endpointPath,
    destinationRecordId: run.destinationRecordId ?? null,
    expectedPayload: body,
    expectedPayloadHash: run.requestSnapshot?.hash ?? null,
    expectedPayloadRef: expectedPayloadRef(deps, run._id),
    destinationConnectionRef: destConn ? { id: destConn._id, name: destConn.name, application: destConn.application, baseUrl: destConn.baseUrl } : null,
    verificationEndpoint: run.verification?.url ?? integration.destination.readback?.pathTemplate ?? null,
    verificationOperation: integration.qa.verificationOperation ?? null,
    comparisonRules: integration.qa.comparisonRules,
  };
}

async function setQa(deps: AppDeps, runId: string, qa: QaState) {
  await cols(deps).runs.updateOne({ _id: runId as never }, { $set: { qa, updatedAt: deps.now(), qaLeaseUntil: null } });
}

export async function processQaTriggers(deps: AppDeps) {
  const c = cols(deps);
  for (let i = 0; i < 5; i++) {
    const now = deps.now();
    const run = (await c.runs.findOneAndUpdate(
      { 'qa.status': 'PENDING', transferStatus: 'SUCCESS' },
      { $set: { 'qa.status': 'RUNNING', 'qa.message': 'Triggering KP QA Agent', qaLeaseUntil: new Date(now.getTime() + 120_000), updatedAt: now } },
      { sort: { updatedAt: 1 }, returnDocument: 'after' },
    )) as unknown as IntegrationRun | null;
    if (!run) return;
    const integration = (await c.integrations.findOne({ _id: run.integrationId as never })) as unknown as Integration | null;
    const qaConn = run.qa.connectionId ? ((await c.connections.findOne({ _id: run.qa.connectionId as never })) as unknown as Connection | null) : null;
    if (!integration || !qaConn) {
      await setQa(deps, run._id, { status: 'NOT_STARTED', message: 'KP QA Agent connection or integration not found' });
      continue;
    }
    const destConn = (await c.connections.findOne({ _id: run.destinationConnectionId as never })) as unknown as Connection | null;
    let state: QaState;
    try {
      state = await triggerQa(qaConn, readSecret(deps, qaConn), qaVars(deps, run, integration, destConn), { send: deps.send, now: deps.now });
    } catch (e) {
      state = { status: 'ERROR', message: (e as Error).message, connectionId: qaConn._id };
    }
    await setQa(deps, run._id, state);
    await audit(deps, { action: 'QA_TRIGGERED', resourceType: 'run', resourceId: run._id, actor: 'worker', result: state.status === 'ERROR' || state.status === 'NOT_STARTED' ? 'FAILURE' : 'SUCCESS', details: { qaStatus: state.status, qaExecutionId: state.qaExecutionId, message: state.message } });
  }
}

export async function processQaPolls(deps: AppDeps, onlyRunId?: string) {
  const c = cols(deps);
  for (let i = 0; i < 10; i++) {
    const now = deps.now();
    const filter: Record<string, unknown> = { 'qa.status': 'RUNNING', 'qa.qaExecutionId': { $exists: true, $ne: null } };
    if (onlyRunId) filter._id = onlyRunId;
    else filter['qa.nextPollAt'] = { $lte: now };
    // Claim by pushing nextPollAt forward (lease), so concurrent workers don't double-poll.
    const run = (await c.runs.findOneAndUpdate(filter, { $set: { 'qa.nextPollAt': new Date(now.getTime() + 60_000) } }, { sort: { 'qa.nextPollAt': 1 }, returnDocument: 'after' })) as unknown as IntegrationRun | null;
    if (!run) return;
    const qaConn = run.qa.connectionId ? ((await c.connections.findOne({ _id: run.qa.connectionId as never })) as unknown as Connection | null) : null;
    let state: QaState;
    if (!qaConn) state = { ...run.qa, status: 'ERROR', message: 'KP QA Agent connection was removed', completedAt: now };
    else {
      try {
        state = await pollQa(qaConn, readSecret(deps, qaConn), run.qa, { send: deps.send, now: deps.now });
      } catch (e) {
        state = { ...run.qa, status: 'ERROR', message: (e as Error).message, completedAt: now };
      }
    }
    await setQa(deps, run._id, state);
    if (state.status !== 'RUNNING') {
      await audit(deps, { action: 'QA_COMPLETED', resourceType: 'run', resourceId: run._id, actor: 'worker', result: state.status === 'PASSED' ? 'SUCCESS' : 'FAILURE', details: { qaStatus: state.status, qaExecutionId: state.qaExecutionId } });
    }
    if (onlyRunId) return;
  }
}

/** Processes every currently pending run sequentially (used by tests and the one-shot CLI). */
export async function drainPendingRuns(deps: AppDeps, max = 100) {
  let n = 0;
  for (; n < max; n++) {
    const run = await claimRun(deps);
    if (!run) break;
    await processRun(deps, run);
  }
  return n;
}

export function startWorker(deps: AppDeps) {
  let stopped = false;
  let active = 0;
  let lastRecovery = 0;
  const tick = async () => {
    if (stopped || !deps.cols) return;
    try {
      if (Date.now() - lastRecovery > 30_000) {
        lastRecovery = Date.now();
        await recoverStaleRuns(deps);
      }
      while (active < deps.config.WORKER_CONCURRENCY) {
        const run = await claimRun(deps);
        if (!run) break;
        active++;
        processRun(deps, run).finally(() => active--);
      }
    } catch (e) {
      console.error(JSON.stringify({ level: 'error', message: 'worker tick failed', error: (e as Error).message }));
    }
  };
  const timer = setInterval(tick, deps.config.WORKER_POLL_MS);
  timer.unref();
  void tick();
  console.log(JSON.stringify({ level: 'info', message: 'worker started', workerId, pollMs: deps.config.WORKER_POLL_MS }));
  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      const deadline = Date.now() + 10_000;
      while (active > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    },
  };
}
