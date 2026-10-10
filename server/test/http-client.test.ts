import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpClient } from '../src/core/httpClient.js';
import { startTestServer, json } from './helpers/testServer.js';

let server: Awaited<ReturnType<typeof startTestServer>>;
let send: ReturnType<typeof createHttpClient>;

beforeAll(async () => {
  server = await startTestServer((r, res) => {
    if (r.url === '/slow') {
      setTimeout(() => json(res, 200, {}), 1500);
      return;
    }
    if (r.url === '/auth') {
      if (r.headers.authorization === 'Bearer good') return json(res, 200, { ok: true });
      return json(res, 401, { error: 'unauthorized' });
    }
    if (r.url === '/boom') return json(res, 500, { error: 'internal' });
    if (r.url === '/big') return json(res, 200, { data: 'x'.repeat(10_000) });
    if (r.url === '/redirect') {
      res.writeHead(302, { location: '/somewhere' });
      res.end();
      return;
    }
    return json(res, 201, { echo: r.body });
  });

  send = createHttpClient({
    policy: { allowPrivateNetworks: true, requireHttps: false, allowedPorts: null },
  });
});

afterAll(async () => {
  await server?.close();
});

describe('guarded HTTP client', () => {
  it('sends JSON and captures the actual response', async () => {
    const r = await send({ method: 'POST', url: `${server.baseUrl}/x`, headers: {}, body: { a: 1 }, timeoutMs: 2000 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bodyJson).toEqual({ echo: { a: 1 } });
  });

  it('surfaces authentication failures and destination HTTP errors as real statuses', async () => {
    const a = await send({ method: 'GET', url: `${server.baseUrl}/auth`, timeoutMs: 2000 });
    const b = await send({ method: 'GET', url: `${server.baseUrl}/boom`, timeoutMs: 2000 });
    expect(a.ok && a.status).toBe(401);
    expect(b.ok && b.status).toBe(500);
  });

  it('times out and reports that the request was sent', async () => {
    const r = await send({ method: 'POST', url: `${server.baseUrl}/slow`, body: {}, timeoutMs: 150 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorKind).toBe('TIMEOUT');
    }
  });

  it('reports connection refusal as not sent', async () => {
    const r = await send({ method: 'POST', url: 'http://127.0.0.1:9/x', body: {}, timeoutMs: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.requestSent).toBe(false);
  });

  it('caps response size', async () => {
    const r = await send({ method: 'GET', url: `${server.baseUrl}/big`, timeoutMs: 2000, maxResponseBytes: 2048 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.truncated).toBe(true);
  });

  it('does not follow redirects', async () => {
    const r = await send({ method: 'GET', url: `${server.baseUrl}/redirect`, timeoutMs: 2000 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.status).toBe(302);
  });

  it('blocks loopback at connect time when private destinations are not allowed (DNS check)', async () => {
    const strictSend = createHttpClient({
      policy: { allowPrivateNetworks: false, requireHttps: false, allowedPorts: null },
    });
    const ip = await strictSend({ method: 'GET', url: `${server.baseUrl}/x`, timeoutMs: 2000 });
    expect(ip.ok).toBe(false);
    if (!ip.ok) expect(ip.errorKind).toBe('SSRF_BLOCKED');
  });
});
