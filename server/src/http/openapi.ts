/**
 * Generates an OpenAPI 3.1 document from the route registry using Zod's built-in JSON Schema
 * conversion (open source, no external tooling). Only implemented routes appear.
 */
import { z } from 'zod';
import { routes, ErrorSchema } from './registry.js';

function toSchema(s: z.ZodType | undefined, io: 'input' | 'output') {
  if (!s) return undefined;
  try {
    const out = z.toJSONSchema(s, { io, unrepresentable: 'any' }) as Record<string, unknown>;
    delete out.$schema;
    return out;
  } catch {
    return { description: 'Schema could not be represented as JSON Schema' };
  }
}

const ERROR_TEXT: Record<number, string> = {
  400: 'Invalid request (validation error)',
  401: 'Authentication required',
  403: 'Forbidden (insufficient role, CSRF or invalid reference)',
  404: 'Not found',
  409: 'Conflict (concurrent modification or duplicate name)',
  413: 'Payload too large',
  422: 'Unprocessable (business rule failed)',
  429: 'Rate limited',
  503: 'Database unavailable',
};

export function buildOpenApi(serverUrl?: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    const oaPath = r.path.replace(/:([A-Za-z]+)/g, '{$1}');
    const params: unknown[] = [];
    const pSchema = toSchema(r.params, 'input') as { properties?: Record<string, unknown> } | undefined;
    for (const [name, schema] of Object.entries(pSchema?.properties ?? {})) params.push({ name, in: 'path', required: true, schema });
    const qSchema = toSchema(r.query, 'input') as { properties?: Record<string, unknown>; required?: string[] } | undefined;
    for (const [name, schema] of Object.entries(qSchema?.properties ?? {})) params.push({ name, in: 'query', required: qSchema?.required?.includes(name) ?? false, schema });

    const responses: Record<string, unknown> = {
      [String(r.successStatus ?? 200)]: {
        description: 'Success',
        content: { 'application/json': { schema: toSchema(r.response, 'output') ?? {}, ...(r.exampleResponse ? { example: r.exampleResponse } : {}) } },
      },
    };
    const errs = new Set([...(r.errors ?? []), ...(r.body || r.query || r.params ? [400] : []), ...(r.access !== 'PUBLIC' ? [401, 403] : []), ...(r.rateLimit ? [429] : [])]);
    for (const code of Array.from(errs).sort()) responses[String(code)] = { description: ERROR_TEXT[code] ?? 'Error', content: { 'application/json': { schema: toSchema(ErrorSchema, 'output') } } };

    paths[oaPath] ??= {};
    paths[oaPath][r.method] = {
      tags: [r.tag],
      summary: r.summary,
      description: [r.description, r.access === 'PUBLIC' ? 'Public endpoint.' : `Requires role: ${r.access} or higher.`].filter(Boolean).join('\n\n'),
      security: r.access === 'PUBLIC' ? [] : [{ cookieAuth: [] }, { bearerAuth: [] }],
      'x-required-role': r.access,
      parameters: params.length ? params : undefined,
      requestBody: r.body ? { required: true, content: { 'application/json': { schema: toSchema(r.body, 'input'), ...(r.exampleRequest ? { example: r.exampleRequest } : {}) } } } : undefined,
      responses,
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'KP Integration Hub API',
      version: '1.0.0',
      description: 'Generated from the implemented route registry. Cookie-authenticated unsafe requests must send the header "X-KP-Hub-Client: web".',
    },
    servers: serverUrl ? [{ url: serverUrl }] : [{ url: '/' }],
    components: {
      securitySchemes: {
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'kphub_session' },
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'Session token from POST /api/auth/login with issueToken=true' },
      },
    },
    paths,
  };
}
