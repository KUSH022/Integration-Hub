import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AppDeps } from '../context.js';
import { ENTITIES, QA_STATUSES, TRANSFER_STATUSES } from '../core/domain.js';
import { QA_TEMPLATE_VARIABLES } from '../core/qa.js';
import { TEMPLATES } from '../core/templates.js';
import { TRANSFORM_TYPES } from '../core/transform.js';
import { defineRoute, Pagination } from '../http/registry.js';
import { ApiError } from '../http/errors.js';
import { buildOpenApi } from '../http/openapi.js';
import { getDashboard } from '../services/dashboard.js';
import { drainPendingRuns, recoverStaleRuns } from '../services/worker.js';

function cols(deps: AppDeps) {
  if (!deps.cols) throw new ApiError(503, 'DB_UNAVAILABLE', 'Database unavailable');
  return deps.cols;
}

function requireCronSecret(deps: AppDeps, authorization: string | undefined) {
  const secret = deps.config.CRON_SECRET;
  if (!secret) throw new ApiError(503, 'CRON_NOT_CONFIGURED', 'CRON_SECRET is not configured');
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(authorization ?? '');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new ApiError(401, 'INVALID_CRON_SECRET', 'Invalid cron authorization');
}

defineRoute({
  method: 'get', path: '/api/health', tag: 'System', access: 'PUBLIC',
  summary: 'Liveness check (does not touch the database)',
  response: z.object({ status: z.literal('ok'), time: z.string() }),
  handler: async () => ({ body: { status: 'ok', time: new Date().toISOString() } }),
});

defineRoute({
  method: 'get', path: '/api/ready', tag: 'System', access: 'PUBLIC',
  summary: 'Readiness check: pings the Hub database',
  response: z.object({ status: z.enum(['ready', 'unavailable']), database: z.enum(['ok', 'unavailable']) }),
  errors: [503],
  handler: async ({ deps }) => {
    try {
      if (!deps.cols) throw new Error('no db');
      await deps.cols.users.countDocuments({}, { limit: 1 });
      return { body: { status: 'ready', database: 'ok' } };
    } catch {
      return { status: 503, body: { status: 'unavailable', database: 'unavailable' } };
    }
  },
});

defineRoute({
  method: 'get', path: '/api/meta', tag: 'System', access: 'VIEWER',
  summary: 'Supported entities, transformations, statuses and QA template variables',
  response: z.object({ entities: z.array(z.any()), transformTypes: z.array(z.string()), transferStatuses: z.array(z.string()), qaStatuses: z.array(z.string()), qaTemplateVariables: z.array(z.string()), security: z.any() }),
  handler: async ({ deps }) => ({
    body: {
      entities: ENTITIES,
      transformTypes: [...TRANSFORM_TYPES],
      transferStatuses: TRANSFER_STATUSES,
      qaStatuses: QA_STATUSES,
      qaTemplateVariables: [...QA_TEMPLATE_VARIABLES],
      security: { requireHttpsDestinations: deps.policy.requireHttps, allowPrivateDestinations: deps.policy.allowPrivateNetworks, allowedPorts: deps.policy.allowedPorts, expectedPayloadRefsEnabled: Boolean(deps.config.PUBLIC_API_BASE_URL) },
    },
  }),
});

defineRoute({
  method: 'get', path: '/api/dashboard', tag: 'Dashboard', access: 'VIEWER',
  summary: 'Live metrics computed from stored integrations and executions',
  query: z.object({ days: z.coerce.number().int().min(1).max(90).default(14) }),
  response: z.looseObject({ integrations: z.any(), executions: z.any(), qa: z.any(), recentRuns: z.array(z.any()), recentErrors: z.array(z.any()), trend: z.array(z.any()) }),
  handler: async ({ deps, query }) => ({ body: await getDashboard(deps, query.days) }),
});

defineRoute({
  method: 'get', path: '/api/templates', tag: 'Templates', access: 'VIEWER',
  summary: 'Reusable integration templates (starting configurations only)',
  response: z.object({ items: z.array(z.any()) }),
  handler: async () => ({ body: { items: TEMPLATES } }),
});

defineRoute({
  method: 'get', path: '/api/audit-logs', tag: 'Audit', access: 'OPERATOR',
  summary: 'Audit log with filters and pagination',
  query: Pagination.extend({ action: z.string().max(60).optional(), resourceId: z.string().max(100).optional(), result: z.enum(['SUCCESS', 'FAILURE']).optional() }),
  response: z.object({ items: z.array(z.any()), total: z.number(), page: z.number(), pageSize: z.number() }),
  handler: async ({ deps, query }) => {
    const f: Record<string, unknown> = {};
    if (query.action) f.action = query.action;
    if (query.resourceId) f.resourceId = query.resourceId;
    if (query.result) f.result = query.result;
    const [items, total] = await Promise.all([
      cols(deps).auditLogs.find(f).sort({ timestamp: -1 }).skip((query.page - 1) * query.pageSize).limit(query.pageSize).toArray(),
      cols(deps).auditLogs.countDocuments(f),
    ]);
    return { body: { items, total, page: query.page, pageSize: query.pageSize } };
  },
});

defineRoute({
  method: 'get', path: '/api/openapi.json', tag: 'System', access: 'PUBLIC',
  summary: 'OpenAPI 3.1 document generated from the implemented route registry',
  response: z.any(),
  handler: async ({ deps }) => ({ body: buildOpenApi(deps.config.PUBLIC_API_BASE_URL) }),
});

defineRoute({
  method: 'get', path: '/api/worker/tick', tag: 'System', access: 'PUBLIC',
  summary: 'Recover stale worker leases and process runs manually queued by a user. Protected for Vercel Cron.',
  response: z.object({ ok: z.boolean(), drained: z.number(), time: z.string() }),
  handler: async ({ deps, req }) => {
    requireCronSecret(deps, req.header('authorization'));
    if (!deps.cols) throw new ApiError(503, 'DB_UNAVAILABLE', 'Database unavailable');
    await recoverStaleRuns(deps);
    const drained = await drainPendingRuns(deps, 25);
    return { body: { ok: true, drained, time: new Date().toISOString() } };
  },
});

defineRoute({
  method: 'post', path: '/api/worker/tick', tag: 'System', access: 'PUBLIC',
  summary: 'Trigger a worker processing cycle via POST',
  response: z.object({ ok: z.boolean(), drained: z.number(), time: z.string() }),
  handler: async ({ deps, req }) => {
    requireCronSecret(deps, req.header('authorization'));
    if (!deps.cols) throw new ApiError(503, 'DB_UNAVAILABLE', 'Database unavailable');
    await recoverStaleRuns(deps);
    const drained = await drainPendingRuns(deps, 25);
    return { body: { ok: true, drained, time: new Date().toISOString() } };
  },
});

