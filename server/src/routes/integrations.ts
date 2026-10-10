import { z } from 'zod';
import type { AppDeps } from '../context.js';
import { defineRoute, IdParam, Pagination } from '../http/registry.js';
import { ApiError, notFound } from '../http/errors.js';
import { ExecuteSchema, IntegrationConfigSchema, PreviewSchema } from '../schemas.js';
import { cloneIntegration, createIntegration, getIntegration, previewRecords, setIntegrationActive, updateIntegration, validateIntegrationConfig } from '../services/integrations.js';
import { requestExecution } from '../services/runs.js';
import { drainPendingRuns } from '../services/worker.js';

const IntegrationOut = z.looseObject({ _id: z.string(), name: z.string(), entityType: z.string(), active: z.boolean(), version: z.number() });
const Issue = z.object({ field: z.string(), message: z.string(), severity: z.enum(['error', 'warning']) });

function cols(deps: AppDeps) {
  if (!deps.cols) throw new ApiError(503, 'DB_UNAVAILABLE', 'Database unavailable');
  return deps.cols;
}

defineRoute({
  method: 'get', path: '/api/integrations', tag: 'Integrations', access: 'VIEWER',
  summary: 'List integrations with search and pagination',
  query: Pagination.extend({ search: z.string().max(100).optional(), entityType: z.string().max(40).optional(), active: z.enum(['true', 'false']).optional() }),
  response: z.object({ items: z.array(IntegrationOut), total: z.number(), page: z.number(), pageSize: z.number() }),
  handler: async ({ deps, query }) => {
    const f: Record<string, unknown> = {};
    if (query.search) f.name = { $regex: query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    if (query.entityType) f.entityType = query.entityType;
    if (query.active) f.active = query.active === 'true';
    const [items, total] = await Promise.all([
      cols(deps).integrations.find(f, { projection: { name: 1, description: 1, entityType: 1, active: 1, version: 1, updatedAt: 1, 'destination.connectionId': 1, 'destination.method': 1, 'destination.endpointPath': 1, 'qa.enabled': 1 } }).sort({ updatedAt: -1 }).skip((query.page - 1) * query.pageSize).limit(query.pageSize).toArray(),
      cols(deps).integrations.countDocuments(f),
    ]);
    return { body: { items, total, page: query.page, pageSize: query.pageSize } };
  },
});

defineRoute({
  method: 'post', path: '/api/integrations/validate', tag: 'Integrations', access: 'OPERATOR',
  summary: 'Validate an integration configuration without saving it',
  body: IntegrationConfigSchema,
  response: z.object({ valid: z.boolean(), issues: z.array(Issue) }),
  handler: async ({ deps, body }) => {
    const issues = await validateIntegrationConfig(deps, body);
    return { body: { valid: !issues.some((i) => i.severity === 'error'), issues } };
  },
});

defineRoute({
  method: 'post', path: '/api/integrations/preview', tag: 'Integrations', access: 'VIEWER',
  summary: 'Live mapping preview: transform and validate sample records (nothing is sent or stored)',
  body: PreviewSchema.extend({ duplicateKeyField: z.string().max(200).optional() }),
  response: z.object({ results: z.array(z.any()), validCount: z.number(), invalidCount: z.number() }),
  exampleRequest: { mappings: [{ sourcePath: 'locationCode', targetPath: 'locationId', transforms: [] }], validationRules: [], records: [{ locationCode: 'KP101' }] },
  exampleResponse: { results: [{ index: 0, output: { locationId: 'KP101' }, transformationErrors: [], validationErrors: [], valid: true }], validCount: 1, invalidCount: 0 },
  handler: async ({ body }) => ({ body: previewRecords(body.mappings as never, body.validationRules as never, body.records, body.duplicateKeyField) }),
});

defineRoute({
  method: 'post', path: '/api/integrations', tag: 'Integrations', access: 'OPERATOR', successStatus: 201,
  summary: 'Create an integration (stored as version 1; activation requires an active destination connection)',
  body: IntegrationConfigSchema,
  response: z.object({ integration: IntegrationOut, warnings: z.array(Issue) }),
  errors: [400, 409, 422],
  handler: async ({ deps, body, user }) => ({ body: await createIntegration(deps, body, user!) }),
});

defineRoute({
  method: 'get', path: '/api/integrations/:id', tag: 'Integrations', access: 'VIEWER',
  summary: 'Get an integration', params: IdParam, response: z.object({ integration: IntegrationOut }), errors: [404],
  handler: async ({ deps, params }) => ({ body: { integration: await getIntegration(deps, params.id) } }),
});

defineRoute({
  method: 'put', path: '/api/integrations/:id', tag: 'Integrations', access: 'OPERATOR',
  summary: 'Update an integration (creates a new configuration version)',
  params: IdParam,
  body: IntegrationConfigSchema.extend({ expectedVersion: z.number().int().optional() }),
  response: z.object({ integration: IntegrationOut, warnings: z.array(Issue) }),
  errors: [400, 404, 409, 422],
  handler: async ({ deps, params, body, user }) => {
    const { expectedVersion, ...cfg } = body;
    return { body: await updateIntegration(deps, params.id, cfg, expectedVersion, user!) };
  },
});

defineRoute({
  method: 'post', path: '/api/integrations/:id/activate', tag: 'Integrations', access: 'ADMIN',
  summary: 'Activate an integration', params: IdParam, response: z.object({ integration: IntegrationOut }), errors: [404, 422],
  handler: async ({ deps, params, user }) => ({ body: { integration: await setIntegrationActive(deps, params.id, true, user!) } }),
});

defineRoute({
  method: 'post', path: '/api/integrations/:id/deactivate', tag: 'Integrations', access: 'ADMIN',
  summary: 'Deactivate an integration', params: IdParam, response: z.object({ integration: IntegrationOut }), errors: [404],
  handler: async ({ deps, params, user }) => ({ body: { integration: await setIntegrationActive(deps, params.id, false, user!) } }),
});

defineRoute({
  method: 'post', path: '/api/integrations/:id/clone', tag: 'Integrations', access: 'OPERATOR', successStatus: 201,
  summary: 'Clone an integration configuration (the clone is inactive)',
  params: IdParam, body: z.object({ name: z.string().trim().min(3).max(100) }),
  response: z.object({ integration: IntegrationOut, warnings: z.array(Issue) }), errors: [404, 409, 422],
  handler: async ({ deps, params, body, user }) => ({ body: await cloneIntegration(deps, params.id, body.name, user!) }),
});

defineRoute({
  method: 'get', path: '/api/integrations/:id/versions', tag: 'Integrations', access: 'VIEWER',
  summary: 'Configuration history (newest first)', params: IdParam,
  response: z.object({ items: z.array(z.looseObject({ version: z.number(), changeType: z.string(), createdAt: z.string() })) }),
  handler: async ({ deps, params }) => {
    const items = await cols(deps).integrationVersions.find({ integrationId: params.id }, { projection: { config: 0 } }).sort({ version: -1 }).limit(200).toArray();
    return { body: { items } };
  },
});

defineRoute({
  method: 'get', path: '/api/integrations/:id/versions/:version', tag: 'Integrations', access: 'VIEWER',
  summary: 'Full configuration of a specific version',
  params: IdParam.extend({ version: z.coerce.number().int().min(1) }),
  response: z.object({ version: z.looseObject({ version: z.number(), config: z.any() }) }), errors: [404],
  handler: async ({ deps, params }) => {
    const v = await cols(deps).integrationVersions.findOne({ integrationId: params.id, version: params.version });
    if (!v) throw notFound('Integration version');
    return { body: { version: v } };
  },
});

defineRoute({
  method: 'post', path: '/api/integrations/:id/execute', tag: 'Integrations', access: 'OPERATOR', successStatus: 202,
  summary: 'Queue a manual execution. Returns execution IDs immediately; poll /api/runs/{id} for status.',
  description: 'Records are validated first. If any are invalid the request is rejected with per-record errors unless acknowledgeInvalid=true, in which case only valid records are queued.',
  params: IdParam, body: ExecuteSchema,
  response: z.object({ batchId: z.string(), executionIds: z.array(z.string()), queued: z.number(), skippedInvalid: z.number() }),
  errors: [400, 404, 422],
  rateLimit: { windowMs: 60_000, max: 30 },
  exampleRequest: { records: [{ locationCode: 'KP101', name: 'KP Downtown Store', region: 'North', active: true }] },
  exampleResponse: { batchId: 'batch_…', executionIds: ['run_…'], queued: 1, skippedInvalid: 0 },
  handler: async ({ deps, params, body, user }) => {
    const res = await requestExecution(deps, params.id, body, user!);
    if (res.queued > 0) {
      // Process pending runs immediately (essential for serverless environments where no background daemon is polling)
      try {
        await drainPendingRuns(deps, res.queued);
      } catch (e) {
        console.error('[execute] inline drain failed:', (e as Error).message);
      }
    }
    return { body: res };
  },
});
