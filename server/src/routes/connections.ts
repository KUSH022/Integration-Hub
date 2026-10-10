import { z } from 'zod';
import type { AppDeps } from '../context.js';
import type { Connection } from '../core/domain.js';
import { defineRoute, IdParam } from '../http/registry.js';
import { ApiError } from '../http/errors.js';
import { ConnectionInputSchema, SecretInputSchema } from '../schemas.js';
import { createConnection, getConnection, setConnectionActive, setSecret, testConnection, toPublicConnection, updateConnection } from '../services/connections.js';

const ConnectionOut = z.looseObject({ _id: z.string(), name: z.string(), application: z.string(), baseUrl: z.string(), authType: z.string(), hasSecret: z.boolean(), active: z.boolean(), version: z.number() });
const TestResult = z.object({ at: z.string(), ok: z.boolean(), httpStatus: z.number().optional(), durationMs: z.number().optional(), message: z.string(), url: z.string() });

function cols(deps: AppDeps) {
  if (!deps.cols) throw new ApiError(503, 'DB_UNAVAILABLE', 'Database unavailable');
  return deps.cols;
}

defineRoute({
  method: 'get', path: '/api/connections', tag: 'Connections', access: 'VIEWER',
  summary: 'List API connections (credentials are never returned)',
  query: z.object({ application: z.enum(['KP_WFM', 'KP_QA_AGENT', 'REST_API']).optional() }),
  response: z.object({ items: z.array(ConnectionOut) }),
  handler: async ({ deps, query }) => {
    const items = await cols(deps).connections.find(query.application ? { application: query.application } : {}).sort({ name: 1 }).limit(200).toArray();
    return { body: { items: items.map((c) => toPublicConnection(c as unknown as Connection)) } };
  },
});

defineRoute({
  method: 'post', path: '/api/connections', tag: 'Connections', access: 'ADMIN', successStatus: 201,
  summary: 'Create a connection (created inactive; test before activating)',
  body: ConnectionInputSchema,
  response: z.object({ connection: ConnectionOut }),
  errors: [400, 409],
  exampleRequest: { name: 'KP WFM (production)', application: 'KP_WFM', baseUrl: 'https://kp-wfm.example.com', authType: 'BEARER', defaultHeaders: {}, timeoutMs: 15000, healthCheck: { path: '/api/<documented-health-path>', expectedStatuses: [200] }, operations: [] },
  handler: async ({ deps, body, user }) => ({ body: { connection: await createConnection(deps, body, user!) } }),
});

defineRoute({
  method: 'get', path: '/api/connections/:id', tag: 'Connections', access: 'VIEWER',
  summary: 'Get a connection', params: IdParam, response: z.object({ connection: ConnectionOut }), errors: [404],
  handler: async ({ deps, params }) => ({ body: { connection: toPublicConnection(await getConnection(deps, params.id)) } }),
});

defineRoute({
  method: 'put', path: '/api/connections/:id', tag: 'Connections', access: 'ADMIN',
  summary: 'Update a connection (changing URL or auth deactivates it until re-tested)',
  params: IdParam, body: ConnectionInputSchema, response: z.object({ connection: ConnectionOut }), errors: [400, 404, 409],
  handler: async ({ deps, params, body, user }) => ({ body: { connection: await updateConnection(deps, params.id, body, user!) } }),
});

defineRoute({
  method: 'put', path: '/api/connections/:id/secret', tag: 'Connections', access: 'ADMIN',
  summary: 'Set the connection credential (bearer token or API key). Stored encrypted; never returned.',
  params: IdParam, body: SecretInputSchema, response: z.object({ connection: ConnectionOut }), errors: [400, 404],
  handler: async ({ deps, params, body, user }) => ({ body: { connection: await setSecret(deps, params.id, body.secret, user!) } }),
});

defineRoute({
  method: 'delete', path: '/api/connections/:id/secret', tag: 'Connections', access: 'ADMIN',
  summary: 'Remove the stored credential', params: IdParam, response: z.object({ connection: ConnectionOut }), errors: [404],
  handler: async ({ deps, params, user }) => ({ body: { connection: await setSecret(deps, params.id, null, user!) } }),
});

defineRoute({
  method: 'post', path: '/api/connections/:id/test', tag: 'Connections', access: 'OPERATOR',
  summary: 'Perform a real request against the configured health-check endpoint',
  params: IdParam, response: z.object({ result: TestResult }), errors: [404, 422],
  rateLimit: { windowMs: 60_000, max: 20 },
  handler: async ({ deps, params, user }) => ({ body: { result: await testConnection(deps, params.id, user!) } }),
});

defineRoute({
  method: 'post', path: '/api/connections/:id/activate', tag: 'Connections', access: 'ADMIN',
  summary: 'Activate (requires a successful test and configured credential)', params: IdParam, response: z.object({ connection: ConnectionOut }), errors: [404, 422],
  handler: async ({ deps, params, user }) => ({ body: { connection: await setConnectionActive(deps, params.id, true, user!) } }),
});

defineRoute({
  method: 'post', path: '/api/connections/:id/deactivate', tag: 'Connections', access: 'ADMIN',
  summary: 'Deactivate a connection', params: IdParam, response: z.object({ connection: ConnectionOut }), errors: [404],
  handler: async ({ deps, params, user }) => ({ body: { connection: await setConnectionActive(deps, params.id, false, user!) } }),
});
