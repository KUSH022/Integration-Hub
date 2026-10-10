import { describe, it, expect } from 'vitest';
import { isBlockedAddress, validateDestinationUrl, joinUrl, assertResolvedAddressesAllowed, type SsrfPolicy } from '../src/core/ssrf.js';
import { createHttpClient } from '../src/core/httpClient.js';
import { redactDeep, redactHeaders, redactUrl, REDACTED } from '../src/core/redact.js';
import { decryptSecret, encryptSecret, hashPassword, signToken, verifyPassword, verifyToken, signReference, verifyReference } from '../src/core/crypto.js';
import { decideRetry, retryDelay, type RetryPolicy } from '../src/core/retry.js';
import { startTestServer, json } from './helpers/testServer.js';

const prod: SsrfPolicy = { allowPrivateNetworks: false, requireHttps: true, allowedPorts: [443], allowedHosts: [] };

describe('SSRF protection', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00:ec2::254', '::ffff:127.0.0.1', '::ffff:7f00:1'])(
    'blocks non-public address %s',
    (ip: string) => expect(isBlockedAddress(ip)).toBe(true),
  );
  it('allows public addresses', () => {
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false);
  });
  it('rejects non-http protocols, plain http in production, embedded credentials, ports and metadata hosts', () => {
    expect(() => validateDestinationUrl('file:///etc/passwd', prod)).toThrow(/Protocol/);
    expect(() => validateDestinationUrl('http://api.example.com', prod)).toThrow(/HTTPS/);
    expect(() => validateDestinationUrl('https://user:pw@api.example.com', prod)).toThrow(/Credentials/);
    expect(() => validateDestinationUrl('https://api.example.com:8443', prod)).toThrow(/port/);
    expect(() => validateDestinationUrl('https://169.254.169.254/latest/meta-data', prod)).toThrow(/private|reserved/);
    expect(() => validateDestinationUrl('https://metadata.google.internal/', prod)).toThrow(/not allowed/);
    expect(() => validateDestinationUrl('https://localhost/', prod)).toThrow(/not allowed/);
    expect(() => validateDestinationUrl('https://2130706433/', prod)).toThrow();
    expect(validateDestinationUrl('https://api.example.com/v1', prod).hostname).toBe('api.example.com');
  });
  it('enforces an optional host allowlist', () => {
    const p = { ...prod, allowedHosts: ['*.kp.example'] };
    expect(() => validateDestinationUrl('https://evil.example/', p)).toThrow(/allowlist/);
    expect(validateDestinationUrl('https://wfm.kp.example/', p).hostname).toBe('wfm.kp.example');
  });
  it('rejects DNS answers that resolve to private addresses (rebinding defence)', () => {
    expect(() => assertResolvedAddressesAllowed('rebind.example', ['93.184.216.34', '127.0.0.1'], prod)).toThrow(/blocked address/);
  });
  it('validates DNS at connect time in the HTTP client', async () => {
    const send = createHttpClient({ policy: { ...prod, requireHttps: false, allowedPorts: null }, lookup: async () => ['127.0.0.1'] });
    const r = await send({ url: 'http://looks-public.example/', method: 'GET', timeoutMs: 2000 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorKind).toBe('SSRF_BLOCKED');
      expect(r.requestSent).toBe(false);
    }
  });
  it('does not follow redirects (prevents redirect-based bypass)', async () => {
    const srv = await startTestServer((_req, res) => {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' });
      res.end();
    });
    try {
      const send = createHttpClient({ policy: { allowPrivateNetworks: true, requireHttps: false, allowedPorts: null } });
      const r = await send({ url: `${srv.baseUrl}/x`, method: 'GET', timeoutMs: 2000 });
      expect(r.ok && r.status).toBe(302);
      expect(srv.requests.length).toBe(1);
    } finally {
      await srv.close();
    }
  });
  it('keeps endpoint paths on the connection origin', () => {
    expect(joinUrl('https://wfm.example/api', '/locations')).toBe('https://wfm.example/api/locations');
    expect(() => joinUrl('https://wfm.example/api', 'https://evil.example/x')).toThrow();
    expect(() => joinUrl('https://wfm.example/api', '//evil.example/x')).toThrow();
    expect(() => joinUrl('https://wfm.example/api', '/../admin')).toThrow();
  });
});

describe('credential redaction', () => {
  it('redacts sensitive headers including custom API-key headers', () => {
    const h = redactHeaders({ Authorization: 'Bearer abc', 'X-Custom-Key': 'k', Accept: 'json' }, ['x-custom-key']);
    expect(h).toEqual({ Authorization: REDACTED, 'X-Custom-Key': REDACTED, Accept: 'json' });
  });
  it('redacts sensitive keys and known secret values deeply', () => {
    const out = redactDeep({ password: 'p', nested: { apiKey: 'k', note: 'token is s3cr3t-value' }, list: [{ secret: 'x' }] }, ['s3cr3t-value']);
    expect(out).toEqual({ password: REDACTED, nested: { apiKey: REDACTED, note: `token is ${REDACTED}` }, list: [{ secret: REDACTED }] });
  });
  it('redacts credentials in URLs', () => {
    expect(redactUrl('https://a.example/x?api_key=123&q=1')).toBe(`https://a.example/x?api_key=${encodeURIComponent(REDACTED)}&q=1`);
  });
});

describe('crypto', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  it('encrypts and decrypts secrets with AES-GCM and detects tampering', () => {
    const enc = encryptSecret('top-secret', key);
    expect(JSON.stringify(enc)).not.toContain('top-secret');
    expect(decryptSecret(enc, key)).toBe('top-secret');
    expect(() => decryptSecret({ ...enc, data: Buffer.from('xxxx').toString('base64') }, key)).toThrow();
  });
  it('hashes passwords with scrypt', async () => {
    const h = await hashPassword('Correct-Horse-1');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('Correct-Horse-1', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });
  it('signs and verifies session tokens and references', () => {
    const t = signToken({ sub: 'u1', role: 'ADMIN', email: 'a@b.c', sid: 's' }, 'x'.repeat(40), 60);
    expect(verifyToken(t, 'x'.repeat(40))?.sub).toBe('u1');
    expect(verifyToken(t, 'y'.repeat(40))).toBeNull();
    expect(verifyToken(t.slice(0, -2) + 'aa', 'x'.repeat(40))).toBeNull();
    const ref = signReference('run_1', 'k'.repeat(40), 60);
    expect(verifyReference('run_1', ref.exp, ref.sig, 'k'.repeat(40))).toBe(true);
    expect(verifyReference('run_2', ref.exp, ref.sig, 'k'.repeat(40))).toBe(false);
  });
});

describe('retry limits and idempotency safeguards', () => {
  const policy: RetryPolicy = { retryCount: 2, retryDelayMs: 100, backoff: 'EXPONENTIAL', retryOnStatus: [503] };
  const ok = (status: number) => ({ ok: true as const, status, headers: {}, bodyText: '', bodyJson: undefined, truncated: false, durationMs: 1 });
  const timeout = { ok: false as const, errorKind: 'TIMEOUT' as const, message: 't', requestSent: true, durationMs: 1 };
  const refused = { ok: false as const, errorKind: 'NETWORK' as const, message: 'ECONNREFUSED', requestSent: false, durationMs: 1 };

  it('stops at the retry limit', () => {
    expect(decideRetry({ attempt: 3, policy, method: 'PUT', idempotencyKeySent: false, result: ok(503), successStatuses: [200] }).retry).toBe(false);
    expect(decideRetry({ attempt: 2, policy, method: 'PUT', idempotencyKeySent: false, result: ok(503), successStatuses: [200] }).retry).toBe(true);
  });
  it('does not retry a POST that timed out after being sent unless an idempotency key is used', () => {
    expect(decideRetry({ attempt: 1, policy, method: 'POST', idempotencyKeySent: false, result: timeout, successStatuses: [201] }).retry).toBe(false);
    expect(decideRetry({ attempt: 1, policy, method: 'POST', idempotencyKeySent: true, result: timeout, successStatuses: [201] }).retry).toBe(true);
  });
  it('retries a POST when the request was never delivered', () => {
    expect(decideRetry({ attempt: 1, policy, method: 'POST', idempotencyKeySent: false, result: refused, successStatuses: [201] }).retry).toBe(true);
  });
  it('never retries 4xx client errors that are not configured', () => {
    expect(decideRetry({ attempt: 1, policy, method: 'PUT', idempotencyKeySent: false, result: ok(400), successStatuses: [200] }).retry).toBe(false);
  });
  it('caps delays', () => {
    expect(retryDelay(policy, 1)).toBe(100);
    expect(retryDelay(policy, 3)).toBe(400);
    expect(retryDelay({ ...policy, retryDelayMs: 10_000_000 }, 5)).toBe(60_000);
  });
});

describe('HTTP client timeouts', () => {
  it('reports TIMEOUT when the destination does not answer in time', async () => {
    const srv = await startTestServer(async (_req, res) => {
      await new Promise((r) => setTimeout(r, 500));
      json(res, 200, {});
    });
    try {
      const send = createHttpClient({ policy: { allowPrivateNetworks: true, requireHttps: false, allowedPorts: null } });
      const r = await send({ url: `${srv.baseUrl}/slow`, method: 'POST', body: { a: 1 }, timeoutMs: 100 });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errorKind).toBe('TIMEOUT');
        expect(r.requestSent).toBe(true);
      }
    } finally {
      await srv.close();
    }
  });
});
