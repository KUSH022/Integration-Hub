import { describe, it, expect, afterEach } from 'vitest';
import { executeRun, type EngineDeps } from '../src/core/engine.js';
import { createHttpClient } from '../src/core/httpClient.js';
import { triggerQa, pollQa, missingContractFields } from '../src/core/qa.js';
import type { Connection, Integration, IntegrationRun, QaContract } from '../src/core/domain.js';
import { TEMPLATES } from '../src/core/templates.js';
import { REDACTED } from '../src/core/redact.js';
import { startTestServer, json } from './helpers/testServer.js';

const send = createHttpClient({ policy: { allowPrivateNetworks: true, requireHttps: false, allowedPorts: null } });
const now = () => new Date();
const SECRET = 'test-bearer-token-123456';

function connection(baseUrl: string, extra: Partial<Connection> = {}): Connection {
  return {
    _id: 'conn_1', name: 'Test destination (test double)', application: 'KP_WFM', baseUrl, authType: 'BEARER', defaultHeaders: {}, timeoutMs: 2000,
    operations: [], active: true, version: 1, createdAt: now(), updatedAt: now(), ...extra,
  };
}

function integration(extra: Partial<Integration['destination']> = {}, over: Partial<Integration> = {}): Integration {
  const t = TEMPLATES.find((x) => x.key === 'location-inbound')!.config;
  return {
    ...JSON.parse(JSON.stringify(t)),
    _id: 'int_1', version: 1, active: true, createdAt: now(), updatedAt: now(),
    destination: { ...t.destination, connectionId: 'conn_1', endpointPath: '/locations', method: 'POST', successStatuses: [201], timeoutMs: 1000, ...extra },
    execution: { retry: { retryCount: 2, retryDelayMs: 1, backoff: 'FIXED', retryOnStatus: [503] }, batchSize: 10 },
    ...over,
  };
}

function harness() {
  const state: Partial<IntegrationRun> = {};
  const transitions: string[] = [];
  const deps: EngineDeps = {
    send,
    now,
    sleep: async () => {},
    persist: async (p) => {
      Object.assign(state, p);
      if (p.transferStatus) transitions.push(p.transferStatus);
    },
  };
  return { state, transitions, deps };
}

const source = { locationCode: 'KP101', name: 'KP Downtown Store', region: 'North', active: true };
const run = { _id: 'run_1', correlationId: 'corr_1', integrationId: 'int_1', sourceSnapshot: source };

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

describe('execution engine (against a local test-double HTTP server)', () => {
  it('sends the exact transformed request, stores the actual response, and reports NOT_CONFIGURED verification when no read-back exists', async () => {
    const srv = await startTestServer((_r, res) => json(res, 201, { id: 'KP101', ok: true, token: SECRET }));
    close = srv.close;
    const h = harness();
    const out = await executeRun({ run, integration: integration(), connection: connection(srv.baseUrl), secret: SECRET }, h.deps);
    expect(out.transferStatus).toBe('SUCCESS');
    expect(srv.requests[0].body).toEqual({ locationId: 'KP101', locationName: 'KP Downtown Store', region: 'North', status: 'Active' });
    expect(srv.requests[0].headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(srv.requests[0].headers['x-correlation-id']).toBe('corr_1');
    expect(h.state.requestSnapshot?.headers.Authorization).toBe(REDACTED);
    expect(JSON.stringify(h.state)).not.toContain(SECRET);
    expect(h.state.httpStatus).toBe(201);
    expect(h.state.verification?.status).toBe('NOT_CONFIGURED');
    expect(h.transitions).toEqual(['RUNNING', 'SUCCESS']);
    expect(run.sourceSnapshot).toEqual(source); // immutable
  });

  it('marks VERIFIED only after a real read-back GET matches, and MISMATCH when it differs', async () => {
    let stored: Record<string, unknown> = {};
    const srv = await startTestServer((r, res) => {
      if (r.method === 'POST') {
        stored = { ...(r.body as object), locationName: 'Changed by destination' };
        return json(res, 201, { data: { id: 'KP101' } });
      }
      if (r.method === 'GET' && r.url === '/locations/KP101') return json(res, 200, { data: stored });
      json(res, 404, {});
    });
    close = srv.close;
    const h = harness();
    const out = await executeRun(
      { run, integration: integration({ destinationIdFrom: { source: 'RESPONSE', path: 'data.id' }, readback: { enabled: true, pathTemplate: '/locations/{{destinationId}}', responseRecordPath: 'data' } }), connection: connection(srv.baseUrl), secret: SECRET },
      h.deps,
    );
    expect(out.transferStatus).toBe('SUCCESS');
    expect(h.state.destinationRecordId).toBe('KP101');
    expect(out.verification.status).toBe('MISMATCH');
    expect(out.verification.differences).toEqual([{ field: 'locationName', expected: 'KP Downtown Store', actual: 'Changed by destination' }]);
    expect(srv.requests.map((r) => r.method)).toEqual(['POST', 'GET']);
  });

  it('fails with field-level errors before sending when transformation/validation fails', async () => {
    const srv = await startTestServer((_r, res) => json(res, 201, {}));
    close = srv.close;
    const h = harness();
    const out = await executeRun({ run: { ...run, sourceSnapshot: { name: 'No code', active: 'maybe' } }, integration: integration(), connection: connection(srv.baseUrl), secret: SECRET }, h.deps);
    expect(out.transferStatus).toBe('FAILED');
    expect(h.state.stage).toBe('TRANSFORMATION');
    expect(h.state.transformationErrors?.map((e) => e.field).sort()).toEqual(['locationId', 'status']);
    expect(srv.requests.length).toBe(0);
  });

  it('reports authentication failure (401) as FAILED with a hint and does not retry', async () => {
    const srv = await startTestServer((_r, res) => json(res, 401, { error: 'invalid token' }));
    close = srv.close;
    const h = harness();
    const out = await executeRun({ run, integration: integration(), connection: connection(srv.baseUrl), secret: 'wrong-token-value' }, h.deps);
    expect(out.transferStatus).toBe('FAILED');
    expect(h.state.errorSummary).toMatch(/authentication/);
    expect(srv.requests.length).toBe(1);
  });

  it('fails clearly when the connection credential is missing', async () => {
    const srv = await startTestServer((_r, res) => json(res, 201, {}));
    close = srv.close;
    const h = harness();
    const out = await executeRun({ run, integration: integration(), connection: connection(srv.baseUrl), secret: undefined }, h.deps);
    expect(out.transferStatus).toBe('FAILED');
    expect(h.state.errorSummary).toMatch(/credential/);
    expect(srv.requests.length).toBe(0);
  });

  it('retries idempotent PUT on 503 up to the limit then fails', async () => {
    const srv = await startTestServer((_r, res) => json(res, 503, { error: 'busy' }));
    close = srv.close;
    const h = harness();
    const out = await executeRun({ run, integration: integration({ method: 'PUT', endpointPath: '/locations/{{payload.locationId}}', successStatuses: [200] }), connection: connection(srv.baseUrl), secret: SECRET }, h.deps);
    expect(out.transferStatus).toBe('FAILED');
    expect(srv.requests.length).toBe(3);
    expect(srv.requests[0].url).toBe('/locations/KP101');
    expect(h.state.retryCount).toBe(2);
    expect(h.transitions).toEqual(['RUNNING', 'RETRYING', 'RUNNING', 'RETRYING', 'RUNNING', 'FAILED']);
  });

  it('does not retry a timed-out POST and records TIMEOUT with unknown outcome', async () => {
    const srv = await startTestServer(async (_r, res) => {
      await new Promise((r) => setTimeout(r, 300));
      json(res, 201, {});
    });
    close = srv.close;
    const h = harness();
    const out = await executeRun({ run, integration: integration({ timeoutMs: 80 }), connection: connection(srv.baseUrl), secret: SECRET }, h.deps);
    expect(out.transferStatus).toBe('TIMEOUT');
    expect(h.state.errorSummary).toMatch(/unknown/);
    expect(srv.requests.length).toBe(1);
  });

  it('refuses to resend an idempotency key that already succeeded', async () => {
    const srv = await startTestServer((_r, res) => json(res, 201, {}));
    close = srv.close;
    const h = harness();
    h.deps.idempotency = {
      reserve: async () => ({ reserved: false, existingRunId: 'run_0', existingStatus: 'SUCCESS' }),
      complete: async () => {},
    };
    const out = await executeRun({ run, integration: integration({ idempotency: { supported: true, headerName: 'Idempotency-Key', keyField: 'locationId' } }), connection: connection(srv.baseUrl), secret: SECRET }, h.deps);
    expect(out.transferStatus).toBe('FAILED');
    expect(h.state.stage).toBe('IDEMPOTENCY');
    expect(srv.requests.length).toBe(0);
  });

  it('keeps transfer SUCCESS and sets QA PENDING when QA is enabled', async () => {
    const srv = await startTestServer((_r, res) => json(res, 201, {}));
    close = srv.close;
    const h = harness();
    const integ = integration();
    integ.qa = { enabled: true, connectionId: 'conn_qa', comparisonRules: { fields: [], mode: 'EXACT' } };
    const out = await executeRun({ run, integration: integ, connection: connection(srv.baseUrl), secret: SECRET }, h.deps);
    expect(out.transferStatus).toBe('SUCCESS');
    expect(out.qa.status).toBe('PENDING');
  });
});

describe('KP QA Agent adapter (against a local test-double QA server)', () => {
  const contract: QaContract = {
    triggerPath: '/qa/runs', triggerMethod: 'POST', triggerSuccessStatuses: [202],
    requestTemplate: { externalId: '{{executionId}}', correlation: '{{correlationId}}', expected: '{{expectedPayload}}' },
    executionIdPath: 'run.id', statusPathTemplate: '/qa/runs/{{qaExecutionId}}', statusFieldPath: 'run.state',
    statusValues: { passed: ['PASSED'], failed: ['FAILED'], running: ['QUEUED', 'RUNNING'], error: ['ERROR'] },
    differencesPath: 'run.differences', pollIntervalSeconds: 2, maxPollMinutes: 1, contractReference: 'test double',
  };

  it('reports missing contract fields instead of inventing an API', () => {
    expect(missingContractFields(null)).toEqual(['qaContract']);
    expect(missingContractFields({ triggerPath: '/x' })).toContain('executionIdPath');
  });

  it('triggers QA with the exact expected payload, stores the QA execution ID, and polls to a final status', async () => {
    let polls = 0;
    const srv = await startTestServer((r, res) => {
      if (r.method === 'POST') return json(res, 202, { run: { id: 'qa-77', state: 'QUEUED' } });
      polls++;
      if (polls < 2) return json(res, 200, { run: { state: 'RUNNING' } });
      json(res, 200, { run: { state: 'FAILED', differences: [{ field: 'region', expected: 'North', actual: 'South' }] } });
    });
    close = srv.close;
    const conn = connection(srv.baseUrl, { application: 'KP_QA_AGENT', qaContract: contract });
    const expected = { locationId: 'KP101' };
    let state = await triggerQa(conn, SECRET, { executionId: 'run_1', correlationId: 'corr_1', expectedPayload: expected }, { send, now });
    expect(state.status).toBe('RUNNING');
    expect(state.qaExecutionId).toBe('qa-77');
    expect(srv.requests[0].body).toEqual({ externalId: 'run_1', correlation: 'corr_1', expected });
    state = await pollQa(conn, SECRET, state, { send, now });
    expect(state.status).toBe('RUNNING');
    state = await pollQa(conn, SECRET, state, { send, now });
    expect(state.status).toBe('FAILED');
    expect(state.differences).toEqual([{ field: 'region', expected: 'North', actual: 'South' }]);
    expect(srv.requests[1].url).toBe('/qa/runs/qa-77');
  });

  it('records ERROR (not a transfer failure) when QA Agent is unavailable', async () => {
    const conn = connection('http://127.0.0.1:1', { application: 'KP_QA_AGENT', qaContract: contract });
    const state = await triggerQa(conn, SECRET, { executionId: 'run_1', correlationId: 'c', expectedPayload: {} }, { send, now });
    expect(state.status).toBe('ERROR');
    expect(state.message).toMatch(/unavailable/);
  });

  it('records NOT_STARTED when the contract is not configured', async () => {
    const conn = connection('http://127.0.0.1:1', { application: 'KP_QA_AGENT', qaContract: null });
    expect((await triggerQa(conn, SECRET, {}, { send, now })).status).toBe('NOT_STARTED');
  });
});
