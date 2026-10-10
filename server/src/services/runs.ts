import type { AppDeps, AuthUser } from '../context.js';
import { newId, sha256Json, signReference } from '../core/crypto.js';
import { parseCsv } from '../core/csv.js';
import type { Connection, IntegrationRun, SourceType } from '../core/domain.js';
import { deepClone, getPath } from '../core/paths.js';
import { badRequest, notFound, unprocessable } from '../http/errors.js';
import { retentionDate } from '../db/mongo.js';
import { audit } from './audit.js';
import { getIntegration, previewRecords } from './integrations.js';

function cols(deps: AppDeps) {
  if (!deps.cols) throw new Error('Database unavailable');
  return deps.cols;
}

export interface ParsedSource {
  records: Record<string, unknown>[];
  parseErrors: { line?: number; index?: number; message: string }[];
}

export function parseSourceInput(input: { sourceType: SourceType; content?: string; records?: unknown }, maxRecords: number): ParsedSource {
  const parseErrors: ParsedSource['parseErrors'] = [];
  let raw: unknown = input.records;
  if (input.sourceType === 'CSV_FILE') {
    if (!input.content) throw badRequest('CSV content is required');
    const r = parseCsv(input.content, maxRecords);
    return { records: r.records, parseErrors: r.errors };
  }
  if (raw === undefined) {
    if (!input.content) throw badRequest('Provide JSON content or records');
    try {
      raw = JSON.parse(input.content);
    } catch (e) {
      throw badRequest(`Invalid JSON: ${(e as Error).message}`);
    }
  }
  const list = Array.isArray(raw) ? raw : [raw];
  if (list.length > maxRecords) throw unprocessable(`Too many records (${list.length}); the limit per submission is ${maxRecords}`);
  const records: Record<string, unknown>[] = [];
  list.forEach((r, i) => {
    if (r === null || typeof r !== 'object' || Array.isArray(r)) parseErrors.push({ index: i, message: `Record #${i + 1} is not a JSON object` });
    else records.push(r as Record<string, unknown>);
  });
  if (records.length === 0 && parseErrors.length === 0) parseErrors.push({ message: 'No records found' });
  return { records, parseErrors };
}

function recordKey(rec: unknown, field?: string) {
  if (!field) return null;
  try {
    const v = getPath(rec, field).value;
    return v === undefined || v === null || typeof v === 'object' ? null : String(v);
  } catch {
    return null;
  }
}

export async function storeSourceRecords(deps: AppDeps, input: { sourceType: SourceType; fileName?: string; integrationId?: string; recordIdField?: string }, records: Record<string, unknown>[], actor: AuthUser) {
  const submissionId = newId('sub');
  const now = deps.now();
  const docs = records.map((payload, recordIndex) => ({
    _id: newId('src'),
    submissionId,
    integrationId: input.integrationId ?? null,
    sourceType: input.sourceType,
    fileName: input.fileName ?? null,
    recordIndex,
    recordKey: recordKey(payload, input.recordIdField),
    payload: deepClone(payload),
    payloadHash: sha256Json(payload),
    createdAt: now,
    createdBy: actor.email,
    retainUntil: retentionDate(deps.config.SOURCE_RETENTION_DAYS, now),
  }));
  if (docs.length) await cols(deps).sourceRecords.insertMany(docs as never[]);
  await audit(deps, { action: 'SOURCE_SUBMITTED', resourceType: 'source_submission', resourceId: submissionId, actor, details: { count: docs.length, sourceType: input.sourceType, fileName: input.fileName } });
  return { submissionId, ids: docs.map((d) => d._id), count: docs.length };
}

/**
 * Creates PENDING runs for the selected records. Work is performed by the database-backed worker,
 * so this request returns immediately with execution IDs for status polling.
 */
export async function requestExecution(
  deps: AppDeps,
  integrationId: string,
  body: { sourceRecordIds?: string[]; submissionId?: string; records?: Record<string, unknown>[]; acknowledgeInvalid: boolean },
  actor: AuthUser,
) {
  const integration = await getIntegration(deps, integrationId);
  if (!integration.active) throw unprocessable('Integration is inactive; activate it before executing');
  const conn = (await cols(deps).connections.findOne({ _id: integration.destination.connectionId as never })) as unknown as Connection | null;
  if (!conn) throw unprocessable('Destination connection no longer exists');
  if (!conn.active) throw unprocessable(`Destination connection "${conn.name}" is inactive`);

  // Collect source records (stored records are referenced; inline records are stored first as immutable snapshots).
  let sources: Array<{ _id: string; payload: Record<string, unknown>; payloadHash: string; recordKey: string | null }> = [];
  if (body.records?.length) {
    const stored = await storeSourceRecords(deps, { sourceType: integration.source.type, integrationId, recordIdField: integration.source.recordIdField }, body.records, actor);
    sources = (await cols(deps).sourceRecords.find({ _id: { $in: stored.ids as never[] } }).sort({ recordIndex: 1 }).toArray()) as never;
  } else if (body.sourceRecordIds?.length) {
    sources = (await cols(deps).sourceRecords.find({ _id: { $in: body.sourceRecordIds as never[] } }).sort({ recordIndex: 1 }).toArray()) as never;
    if (sources.length !== body.sourceRecordIds.length) throw notFound('One or more source records');
  } else if (body.submissionId) {
    sources = (await cols(deps).sourceRecords.find({ submissionId: body.submissionId }).sort({ recordIndex: 1 }).limit(deps.config.MAX_RECORDS_PER_SUBMISSION + 1).toArray()) as never;
    if (sources.length === 0) throw notFound('Source submission');
  } else throw badRequest('Provide records, sourceRecordIds or submissionId');

  if (sources.length > integration.execution.batchSize) {
    throw unprocessable(`This execution has ${sources.length} records but the integration batch size is ${integration.execution.batchSize}. Split the submission or increase the batch size.`);
  }

  const preview = previewRecords(integration.mappings, integration.validationRules, sources.map((s) => s.payload), integration.duplicateCheck?.keyField);
  if (preview.invalidCount > 0 && !body.acknowledgeInvalid) {
    throw unprocessable(`${preview.invalidCount} of ${sources.length} records are invalid. Review the errors; resubmit with acknowledgeInvalid=true to execute only the ${preview.validCount} valid records.`, {
      validCount: preview.validCount,
      invalidCount: preview.invalidCount,
      invalid: preview.results.filter((r) => !r.valid).map((r) => ({ index: r.index, sourceRecordId: sources[r.index]._id, errors: [...r.transformationErrors, ...r.validationErrors] })),
    });
  }
  const valid = preview.results.filter((r) => r.valid).map((r) => sources[r.index]);
  if (valid.length === 0) throw unprocessable('No valid records to execute');

  const batchId = newId('batch');
  const now = deps.now();
  const runs: IntegrationRun[] = valid.map((s) => ({
    _id: newId('run'),
    correlationId: newId('corr'),
    batchId,
    integrationId,
    integrationName: integration.name,
    integrationVersion: integration.version,
    entityType: integration.entityType,
    destinationApplication: `${conn.name} (${conn.application})`,
    destinationConnectionId: conn._id,
    sourceRecordId: s._id,
    sourceRecordKey: s.recordKey ?? recordKey(s.payload, integration.source.recordIdField),
    sourceSnapshot: deepClone(s.payload),
    sourceSnapshotHash: s.payloadHash,
    transferStatus: 'PENDING',
    stage: 'QUEUED',
    attempts: [],
    retryCount: 0,
    requestSnapshot: null,
    response: null,
    httpStatus: null,
    transformationErrors: [],
    validationErrors: [],
    errorSummary: null,
    destinationRecordId: null,
    verification: { status: 'NOT_APPLICABLE', message: 'Not executed yet' },
    qa: integration.qa.enabled ? { status: 'NOT_STARTED', message: 'Waiting for transfer to complete' } : { status: 'NOT_REQUESTED' },
    lease: null,
    createdAt: now,
    startedAt: null,
    endedAt: null,
    updatedAt: now,
    createdBy: actor.email,
    retainUntil: retentionDate(deps.config.RUN_RETENTION_DAYS, now),
  }));
  await cols(deps).runs.insertMany(runs as never[]);
  await audit(deps, { action: 'EXECUTION_REQUESTED', resourceType: 'integration', resourceId: integrationId, actor, details: { batchId, runs: runs.length, skippedInvalid: preview.invalidCount } });
  return { batchId, executionIds: runs.map((r) => r._id), queued: runs.length, skippedInvalid: preview.invalidCount };
}

export async function getRun(deps: AppDeps, id: string): Promise<IntegrationRun> {
  const r = (await cols(deps).runs.findOne({ _id: id as never }, { projection: { lease: 0 } })) as unknown as IntegrationRun | null;
  if (!r) throw notFound('Execution');
  return r;
}

export async function cancelRun(deps: AppDeps, id: string, actor: AuthUser) {
  const now = deps.now();
  const r = await cols(deps).runs.findOneAndUpdate(
    { _id: id as never, transferStatus: 'PENDING' },
    { $set: { transferStatus: 'CANCELLED', stage: 'CANCELLED', endedAt: now, updatedAt: now, errorSummary: `Cancelled by ${actor.email}`, verification: { status: 'NOT_APPLICABLE', message: 'Cancelled' } } },
    { returnDocument: 'after' },
  );
  if (r) {
    await audit(deps, { action: 'EXECUTION_CANCELLED', resourceType: 'run', resourceId: id, actor });
    return { cancelled: true, status: 'CANCELLED' };
  }
  // In-flight runs: request cancellation before the next retry attempt.
  const inflight = await cols(deps).runs.updateOne({ _id: id as never, transferStatus: { $in: ['RUNNING', 'RETRYING'] } }, { $set: { cancelRequested: true, updatedAt: now } });
  if (inflight.matchedCount) {
    await audit(deps, { action: 'EXECUTION_CANCELLED', resourceType: 'run', resourceId: id, actor, details: { note: 'cancellation requested for in-flight execution; takes effect before the next attempt' } });
    return { cancelled: false, status: 'CANCELLATION_REQUESTED' };
  }
  const existing = await getRun(deps, id);
  throw unprocessable(`Execution is already ${existing.transferStatus} and cannot be cancelled`);
}

export function buildRunFilter(q: { integrationId?: string; entityType?: string; transferStatus?: string; qaStatus?: string; correlationId?: string; batchId?: string; from?: string; to?: string }) {
  const f: Record<string, unknown> = {};
  if (q.integrationId) f.integrationId = q.integrationId;
  if (q.entityType) f.entityType = q.entityType;
  if (q.transferStatus) f.transferStatus = q.transferStatus;
  if (q.qaStatus) f['qa.status'] = q.qaStatus;
  if (q.correlationId) f.correlationId = q.correlationId;
  if (q.batchId) f.batchId = q.batchId;
  if (q.from || q.to) {
    const range: Record<string, Date> = {};
    if (q.from) range.$gte = new Date(q.from.length === 10 ? `${q.from}T00:00:00.000Z` : q.from);
    if (q.to) range.$lte = new Date(q.to.length === 10 ? `${q.to}T23:59:59.999Z` : q.to);
    f.createdAt = range;
  }
  return f;
}

export const RUN_LIST_PROJECTION = {
  correlationId: 1, batchId: 1, integrationId: 1, integrationName: 1, integrationVersion: 1, entityType: 1, destinationApplication: 1, sourceRecordKey: 1,
  transferStatus: 1, httpStatus: 1, 'qa.status': 1, 'qa.qaExecutionId': 1, 'verification.status': 1, retryCount: 1, errorSummary: 1, createdAt: 1, startedAt: 1, endedAt: 1, stage: 1,
};

export async function listRuns(deps: AppDeps, q: Parameters<typeof buildRunFilter>[0] & { page: number; pageSize: number }) {
  const filter = buildRunFilter(q);
  const [items, total] = await Promise.all([
    cols(deps).runs.find(filter, { projection: RUN_LIST_PROJECTION }).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).toArray(),
    cols(deps).runs.countDocuments(filter),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize };
}

/** Signed, expiring URL that lets KP QA Agent fetch the immutable expected payload without Hub credentials. */
export function expectedPayloadRef(deps: AppDeps, runId: string): string | undefined {
  if (!deps.config.PUBLIC_API_BASE_URL) return undefined;
  const { exp, sig } = signReference(runId, deps.config.REFERENCE_SIGNING_SECRET, 24 * 3600);
  return `${deps.config.PUBLIC_API_BASE_URL.replace(/\/+$/, '')}/api/refs/expected-payload/${encodeURIComponent(runId)}?exp=${exp}&sig=${sig}`;
}
