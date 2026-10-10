import { z } from 'zod';
import type { AppDeps } from '../context.js';
import { verifyReference } from '../core/crypto.js';
import { defineRoute, IdParam, Pagination } from '../http/registry.js';
import { ApiError, notFound } from '../http/errors.js';
import { RunsQuerySchema, SourceSubmitSchema } from '../schemas.js';
import { getIntegration, previewRecords } from '../services/integrations.js';
import { cancelRun, getRun, listRuns, parseSourceInput, storeSourceRecords } from '../services/runs.js';

function cols(deps: AppDeps) {
  if (!deps.cols) throw new ApiError(503, 'DB_UNAVAILABLE', 'Database unavailable');
  return deps.cols;
}

const RunSummary = z.looseObject({ _id: z.string(), correlationId: z.string(), integrationName: z.string(), transferStatus: z.string(), qa: z.object({ status: z.string() }) });

/* ---------------- Source data ---------------- */

defineRoute({
  method: 'post', path: '/api/sources/parse', tag: 'Source data', access: 'VIEWER',
  summary: 'Parse and validate a JSON/CSV payload (optionally against an integration) without storing it',
  body: SourceSubmitSchema,
  response: z.object({ count: z.number(), parseErrors: z.array(z.any()), records: z.array(z.any()), preview: z.any().optional() }),
  handler: async ({ deps, body }) => {
    const parsed = parseSourceInput(body, deps.config.MAX_RECORDS_PER_SUBMISSION);
    let preview;
    if (body.integrationId) {
      const i = await getIntegration(deps, body.integrationId);
      preview = previewRecords(i.mappings, i.validationRules, parsed.records, i.duplicateCheck?.keyField);
    }
    return { body: { count: parsed.records.length, parseErrors: parsed.parseErrors, records: parsed.records.slice(0, 200), preview } };
  },
});

defineRoute({
  method: 'post', path: '/api/sources', tag: 'Source data', access: 'OPERATOR', successStatus: 201,
  summary: 'Store source records as immutable snapshots (one submission)',
  body: SourceSubmitSchema,
  response: z.object({ submissionId: z.string(), ids: z.array(z.string()), count: z.number(), parseErrors: z.array(z.any()) }),
  errors: [400, 422],
  handler: async ({ deps, body, user }) => {
    const parsed = parseSourceInput(body, deps.config.MAX_RECORDS_PER_SUBMISSION);
    if (parsed.records.length === 0) throw new ApiError(422, 'NO_RECORDS', 'No valid JSON object records to store', parsed.parseErrors);
    const stored = await storeSourceRecords(deps, body, parsed.records, user!);
    return { body: { ...stored, parseErrors: parsed.parseErrors } };
  },
});

defineRoute({
  method: 'get', path: '/api/sources', tag: 'Source data', access: 'VIEWER',
  summary: 'List previously submitted source records',
  query: Pagination.extend({ submissionId: z.string().max(80).optional(), integrationId: z.string().max(80).optional() }),
  response: z.object({ items: z.array(z.any()), total: z.number(), page: z.number(), pageSize: z.number() }),
  handler: async ({ deps, query }) => {
    const f: Record<string, unknown> = {};
    if (query.submissionId) f.submissionId = query.submissionId;
    if (query.integrationId) f.integrationId = query.integrationId;
    const [items, total] = await Promise.all([
      cols(deps).sourceRecords.find(f).sort({ createdAt: -1, recordIndex: 1 }).skip((query.page - 1) * query.pageSize).limit(query.pageSize).toArray(),
      cols(deps).sourceRecords.countDocuments(f),
    ]);
    return { body: { items, total, page: query.page, pageSize: query.pageSize } };
  },
});

defineRoute({
  method: 'get', path: '/api/sources/:id', tag: 'Source data', access: 'VIEWER',
  summary: 'Get one stored source record', params: IdParam, response: z.object({ record: z.any() }), errors: [404],
  handler: async ({ deps, params }) => {
    const r = await cols(deps).sourceRecords.findOne({ _id: params.id as never });
    if (!r) throw notFound('Source record');
    return { body: { record: r } };
  },
});

/* ---------------- Executions ---------------- */

defineRoute({
  method: 'get', path: '/api/runs', tag: 'Executions', access: 'VIEWER',
  summary: 'Execution history with filters and pagination (max 100 per page)',
  query: RunsQuerySchema,
  response: z.object({ items: z.array(RunSummary), total: z.number(), page: z.number(), pageSize: z.number() }),
  handler: async ({ deps, query }) => ({ body: await listRuns(deps, query) }),
});

defineRoute({
  method: 'get', path: '/api/runs/:id', tag: 'Executions', access: 'VIEWER',
  summary: 'Execution detail: snapshots, response, errors, retries, verification and QA result',
  params: IdParam, response: z.object({ run: z.any() }), errors: [404],
  handler: async ({ deps, params }) => ({ body: { run: await getRun(deps, params.id) } }),
});

defineRoute({
  method: 'post', path: '/api/runs/:id/cancel', tag: 'Executions', access: 'OPERATOR',
  summary: 'Cancel a pending execution (in-flight executions stop before their next retry)',
  params: IdParam, response: z.object({ cancelled: z.boolean(), status: z.string() }), errors: [404, 422],
  handler: async ({ deps, params, user }) => ({ body: await cancelRun(deps, params.id, user!) }),
});

defineRoute({
  method: 'get', path: '/api/refs/expected-payload/:id', tag: 'Executions', access: 'PUBLIC',
  summary: 'Signed, expiring reference to the immutable transformed request (for KP QA Agent)',
  description: 'Requires the exp and sig query parameters generated by the Hub. Returns only the stored request body and its hash.',
  params: IdParam, query: z.object({ exp: z.coerce.number().int(), sig: z.string().min(10).max(200) }),
  response: z.object({ executionId: z.string(), correlationId: z.string(), hash: z.string(), payload: z.any() }), errors: [403, 404],
  handler: async ({ deps, params, query }) => {
    if (!verifyReference(params.id, query.exp, query.sig, deps.config.REFERENCE_SIGNING_SECRET)) throw new ApiError(403, 'INVALID_REFERENCE', 'Reference is invalid or expired');
    const run = await getRun(deps, params.id);
    if (!run.requestSnapshot) throw notFound('Expected payload');
    return { body: { executionId: run._id, correlationId: run.correlationId, hash: run.requestSnapshot.hash, payload: run.requestSnapshot.body } };
  },
});
