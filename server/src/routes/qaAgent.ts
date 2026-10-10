import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AppDeps } from '../context.js';
import type { Integration, IntegrationRun } from '../core/domain.js';
import { defineRoute, IdParam } from '../http/registry.js';
import { ApiError } from '../http/errors.js';

function cols(deps: AppDeps) {
  if (!deps.cols) throw new ApiError(503, 'DB_UNAVAILABLE', 'Database unavailable');
  return deps.cols;
}

function requireAgentKey(deps: AppDeps, supplied: string | undefined) {
  const configured = deps.config.QA_AGENT_API_KEY;
  if (!configured) throw new ApiError(503, 'QA_AGENT_NOT_CONFIGURED', 'QA_AGENT_API_KEY is not configured');
  const a = Buffer.from(configured);
  const b = Buffer.from(supplied ?? '');
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ApiError(401, 'INVALID_QA_AGENT_KEY', 'Invalid QA Agent key');
}

defineRoute({
  method: 'get', path: '/api/qa-agent/pending', tag: 'QA Agent', access: 'PUBLIC',
  summary: 'List successful Hub runs that are waiting for a manual local QA check',
  description: 'Requires the X-KP-QA-Agent-Key header configured by QA_AGENT_API_KEY.',
  response: z.object({ items: z.array(z.any()) }), errors: [401, 503],
  handler: async ({ deps, req }) => {
    requireAgentKey(deps, req.header('X-KP-QA-Agent-Key'));
    const runs = await cols(deps).runs.find({ transferStatus: 'SUCCESS', 'qa.status': 'PENDING', requestSnapshot: { $ne: null } })
      .sort({ createdAt: -1 }).limit(25).toArray() as unknown as IntegrationRun[];
    const items = [];
    for (const run of runs) {
      const integration = await cols(deps).integrations.findOne({ _id: run.integrationId as never }) as unknown as Integration | null;
      if (!integration?.qa?.enabled || !run.requestSnapshot) continue;
      const requestBody = run.requestSnapshot.body;
      const records = requestBody && typeof requestBody === 'object' && !Array.isArray(requestBody)
        ? (requestBody as Record<string, unknown>).records
        : undefined;
      const expectedPayload = Array.isArray(records) && records.length === 1 ? records[0] : requestBody;
      items.push({
        runId: run._id,
        correlationId: run.correlationId,
        integrationId: run.integrationId,
        integrationName: run.integrationName,
        entityType: run.entityType,
        operation: integration.destination.method,
        destinationRecordId: run.destinationRecordId,
        recordId: run.destinationRecordId ?? run.sourceRecordKey ?? null,
        // WFM's inbound contract wraps a single Hub source record in { records: [...] }.
        // Compare that record itself with the outbound read response, not the transport envelope.
        expectedPayload,
        expectedPayloadHash: run.requestSnapshot.hash,
        comparisonRules: integration.qa.comparisonRules,
        createdAt: run.createdAt,
      });
    }
    return { body: { items } };
  },
});

defineRoute({
  method: 'post', path: '/api/qa-agent/:id/claim', tag: 'QA Agent', access: 'PUBLIC',
  summary: 'Mark a Hub run as claimed by the local QA Agent',
  description: 'Requires the X-KP-QA-Agent-Key header configured by QA_AGENT_API_KEY.',
  params: IdParam,
  body: z.object({ qaExecutionId: z.string().min(1).max(100) }),
  response: z.object({ claimed: z.boolean() }), errors: [401, 404, 409, 503],
  handler: async ({ deps, req, params, body }) => {
    requireAgentKey(deps, req.header('X-KP-QA-Agent-Key'));
    const c = cols(deps);
    const claimed = await c.runs.updateOne(
      { _id: params.id as never, transferStatus: 'SUCCESS', 'qa.status': 'PENDING' },
      { $set: { qa: { status: 'RUNNING', message: 'Local QA Agent is checking WFM', qaExecutionId: body.qaExecutionId, triggeredAt: deps.now() }, updatedAt: deps.now() } },
    );
    if (claimed.matchedCount) return { body: { claimed: true } };
    const run = await c.runs.findOne({ _id: params.id as never });
    if (!run) throw new ApiError(404, 'NOT_FOUND', 'Hub execution not found');
    if ((run.qa as { qaExecutionId?: string } | undefined)?.qaExecutionId === body.qaExecutionId) return { body: { claimed: true } };
    throw new ApiError(409, 'QA_ALREADY_CLAIMED', 'This Hub execution has already been claimed or checked');
  },
});

defineRoute({
  method: 'post', path: '/api/qa-agent/:id/result', tag: 'QA Agent', access: 'PUBLIC',
  summary: 'Store the local QA Agent result on the Hub execution',
  description: 'Requires the X-KP-QA-Agent-Key header configured by QA_AGENT_API_KEY.',
  params: IdParam,
  body: z.object({
    qaExecutionId: z.string().min(1).max(100),
    status: z.enum(['PASSED', 'FAILED', 'ERROR']),
    message: z.string().max(1000).optional(),
    differences: z.array(z.any()).max(500).optional(),
  }),
  response: z.object({ saved: z.boolean() }), errors: [401, 404, 409, 503],
  handler: async ({ deps, req, params, body }) => {
    requireAgentKey(deps, req.header('X-KP-QA-Agent-Key'));
    const result = await cols(deps).runs.updateOne(
      { _id: params.id as never, 'qa.status': 'RUNNING', 'qa.qaExecutionId': body.qaExecutionId },
      { $set: { qa: { status: body.status, message: body.message ?? `QA Agent reported ${body.status}`, differences: body.differences ?? [], qaExecutionId: body.qaExecutionId, completedAt: deps.now() }, updatedAt: deps.now() } },
    );
    if (result.matchedCount) return { body: { saved: true } };
    const run = await cols(deps).runs.findOne({ _id: params.id as never });
    if (!run) throw new ApiError(404, 'NOT_FOUND', 'Hub execution not found');
    if ((run.qa as { qaExecutionId?: string } | undefined)?.qaExecutionId === body.qaExecutionId) return { body: { saved: true } };
    throw new ApiError(409, 'QA_CLAIM_MISMATCH', 'The QA execution does not own this Hub run');
  },
});
