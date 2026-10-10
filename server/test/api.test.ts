/**
 * HTTP-level tests that do not need a database: authentication, CORS, security headers,
 * size limits, validation and OpenAPI generation.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { policyFromConfig } from '../src/context.js';
import { createHttpClient } from '../src/core/httpClient.js';
import { routes } from '../src/http/registry.js';
import { testConfig } from './helpers/config.js';

const config = testConfig();
const policy = policyFromConfig(config);
const app = createApp({ config, cols: null, policy, send: createHttpClient({ policy }), now: () => new Date() }, { logRequests: false });

describe('API security baseline', () => {
  it('serves liveness without authentication and with secure headers', async () => {
    const r = await request(app).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });

  it('reports the database as unavailable on readiness when not connected', async () => {
    const r = await request(app).get('/api/ready');
    expect(r.status).toBe(503);
  });

  it.each([
    ['get', '/api/integrations'], ['get', '/api/connections'], ['get', '/api/runs'], ['get', '/api/dashboard'],
    ['post', '/api/connections'], ['post', '/api/integrations/int_x/execute'], ['get', '/api/audit-logs'],
  ])('rejects unauthenticated %s %s with 401', async (method, path) => {
    const r = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](path).send({});
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects forged or tampered bearer tokens', async () => {
    const r = await request(app).get('/api/auth/me').set('Authorization', 'Bearer kphub.eyJzdWIiOiJ4In0.forged');
    expect(r.status).toBe(401);
  });

  it('applies the CORS allowlist', async () => {
    const ok = await request(app).options('/api/integrations').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'POST');
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const bad = await request(app).options('/api/integrations').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    expect(bad.status).toBe(403);
    const badPost = await request(app).post('/api/auth/login').set('Origin', 'https://evil.example').send({ email: 'a@b.co', password: 'x' });
    expect(badPost.status).toBe(403);
  });

  it('enforces the request size limit', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'a@b.co', password: 'x'.repeat(20_000) });
    expect(r.status).toBe(413);
  });

  it('returns validation errors with field details', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'not-an-email', password: '' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(r.body.error.details.map((d: { field: string }) => d.field)).toContain('email');
  });

  it('rejects malformed JSON safely', async () => {
    const r = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{bad json');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_JSON');
  });

  it('generates OpenAPI only from implemented routes', async () => {
    const r = await request(app).get('/api/openapi.json');
    expect(r.status).toBe(200);
    const documented = Object.entries(r.body.paths as Record<string, Record<string, unknown>>).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m} ${p}`)).sort();
    const implemented = routes.map((rt) => `${rt.method} ${rt.path.replace(/:([A-Za-z]+)/g, '{$1}')}`).sort();
    expect(documented).toEqual(implemented);
    expect(r.body.paths['/api/integrations/{id}/execute'].post['x-required-role']).toBe('OPERATOR');
  });

  it('returns 404 JSON for unknown routes', async () => {
    const r = await request(app).get('/api/does-not-exist');
    expect(r.status).toBe(404);
  });
});
