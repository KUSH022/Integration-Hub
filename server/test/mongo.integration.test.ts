/**
 * MongoDB persistence and end-to-end flow tests.
 * Requires MONGODB_URI_TEST (a disposable database server; a dedicated test database is created and dropped).
 * KP WFM and KP QA Agent are replaced by CONTROLLED TEST DOUBLES (local HTTP servers). These tests prove the Hub's
 * behaviour, not the behaviour of the real external systems — use the smoke tests for that.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoClient } from 'mongodb';
import { createApp } from '../src/createApp.js';
import { policyFromConfig, type AppDeps } from '../src/context.js';
import { createHttpClient } from '../src/core/httpClient.js';
import { TEMPLATES } from '../src/core/templates.js';
import { connectMongo, ensureSchema, getCollections } from '../src/db/mongo.js';
import { createUser } from '../src/routes/auth.js';
import { drainPendingRuns, processQaPolls, processQaTriggers } from '../src/services/worker.js';
import { testConfig } from './helpers/config.js';
import { startTestServer, json } from './helpers/testServer.js';

const URI = process.env.MONGODB_URI_TEST;
const WFM_TOKEN = 'wfm-test-token-abcdef';
const QA_TOKEN = 'qa-test-token-abcdef';

describe.skipIf(!URI)('MongoDB persistence and end-to-end flow (test doubles for KP WFM / KP QA Agent)', () => {
  const config = testConfig();
  let client: MongoClient;
  let deps: AppDeps;
  let app: ReturnType<typeof createApp>;
  let token = '';
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const store = new Map<string, Record<string, unknown>>();
  let wfm: Awaited<ReturnType<typeof startTestServer>>;
  let qa: Awaited<ReturnType<typeof startTestServer>>;

  beforeAll(async () => {
    const m = await connectMongo(config);
    client = m.client;
    await ensureSchema(m.db);
    const policy = policyFromConfig(config);
    deps = { config, cols: getCollections(m.db), policy, send: createHttpClient({ policy }), now: () => new Date() };
    app = createApp(deps, { logRequests: false });
    await createUser(deps, { email: 'admin@test.local', password: 'Admin-password-1', role: 'ADMIN' });
    const login = await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'Admin-password-1', issueToken: true });
    expect(login.status).toBe(200);
    token = login.body.token;

    wfm = await startTestServer((r, res) => {
      if (r.headers.authorization !== `Bearer ${WFM_TOKEN}`) return json(res, 401, { error: 'unauthorized' });
      if (r.method === 'GET' && r.url === '/health') return json(res, 200, { ok: true });
      if (r.method === 'POST' && r.url === '/locations') {
        const b = r.body as Record<string, unknown>;
        store.set(String(b.locationId), b);
        return json(res, 201, { id: b.locationId });
      }
      const m = r.url.match(/^\/locations\/(.+)$/);
      if (r.method === 'GET' && m) return store.has(m[1]) ? json(res, 200, store.get(m[1])) : json(res, 404, {});
      json(res, 404, {});
    });
    qa = await startTestServer((r, res) => {
      if (r.headers.authorization !== `Bearer ${QA_TOKEN}`) return json(res, 401, {});
      if (r.url === '/health') return json(res, 200, {});
      if (r.method === 'POST' && r.url === '/verifications') return json(res, 202, { id: 'qa-1', status: 'QUEUED' });
      if (r.method === 'GET' && r.url === '/verifications/qa-1') return json(res, 200, { status: 'PASSED', diffs: [] });
      json(res, 404, {});
    });
  });

  afterAll(async () => {
    await wfm?.close();
    await qa?.close();
    await client?.db(config.MONGODB_DB_NAME).dropDatabase();
    await client?.close();
  });

  it('runs the full flow: connection test → integration → execution → read-back → QA', async () => {
    // KP WFM connection (test double)
    let r = await request(app).post('/api/connections').set(auth()).send({ name: 'WFM double', application: 'KP_WFM', baseUrl: wfm.baseUrl, authType: 'BEARER', healthCheck: { path: '/health', expectedStatuses: [200] } });
    expect(r.status).toBe(201);
    const wfmId = r.body.connection._id;
    expect((await request(app).post(`/api/connections/${wfmId}/activate`).set(auth())).status).toBe(422); // untested
    await request(app).put(`/api/connections/${wfmId}/secret`).set(auth()).send({ secret: WFM_TOKEN }).expect(200);
    r = await request(app).post(`/api/connections/${wfmId}/test`).set(auth());
    expect(r.body.result.ok).toBe(true);
    await request(app).post(`/api/connections/${wfmId}/activate`).set(auth()).expect(200);
    const listed = await request(app).get('/api/connections').set(auth());
    expect(JSON.stringify(listed.body)).not.toContain(WFM_TOKEN);
    expect(listed.body.items[0].hasSecret).toBe(true);

    // KP QA Agent connection (test double) with an explicitly configured contract
    r = await request(app).post('/api/connections').set(auth()).send({
      name: 'QA double', application: 'KP_QA_AGENT', baseUrl: qa.baseUrl, authType: 'BEARER', healthCheck: { path: '/health', expectedStatuses: [200] },
      qaContract: {
        triggerPath: '/verifications', triggerMethod: 'POST', triggerSuccessStatuses: [202],
        requestTemplate: { executionId: '{{executionId}}', correlationId: '{{correlationId}}', expected: '{{expectedPayload}}', recordId: '{{destinationRecordId}}' },
        executionIdPath: 'id', initialStatusPath: 'status', statusPathTemplate: '/verifications/{{qaExecutionId}}', statusFieldPath: 'status',
        statusValues: { passed: ['PASSED'], failed: ['FAILED'], running: ['QUEUED', 'RUNNING'], error: ['ERROR'] }, differencesPath: 'diffs',
        pollIntervalSeconds: 2, maxPollMinutes: 5, contractReference: 'test double',
      },
    });
    expect(r.status).toBe(201);
    const qaId = r.body.connection._id;
    await request(app).put(`/api/connections/${qaId}/secret`).set(auth()).send({ secret: QA_TOKEN }).expect(200);
    await request(app).post(`/api/connections/${qaId}/test`).set(auth()).expect(200);
    await request(app).post(`/api/connections/${qaId}/activate`).set(auth()).expect(200);

    // Integration from the location template
    const t = TEMPLATES.find((x) => x.key === 'location-inbound')!.config;
    r = await request(app).post('/api/integrations').set(auth()).send({
      ...t, name: 'Locations → WFM double',
      destination: { ...t.destination, connectionId: wfmId, endpointPath: '/locations', readback: { enabled: true, pathTemplate: '/locations/{{payload.locationId}}' } },
      qa: { enabled: true, connectionId: qaId, comparisonRules: t.qa.comparisonRules },
    });
    expect(r.status).toBe(201);
    const intId = r.body.integration._id;
    await request(app).post(`/api/integrations/${intId}/activate`).set(auth()).expect(200);

    // Invalid records are rejected for review first
    r = await request(app).post(`/api/integrations/${intId}/execute`).set(auth()).send({ records: [{ locationCode: 'KP101', name: 'KP Downtown Store', region: 'North', active: true }, { name: 'missing code' }] });
    expect(r.status).toBe(422);
    expect(r.body.error.details.invalidCount).toBe(1);
    r = await request(app).post(`/api/integrations/${intId}/execute`).set(auth()).send({ records: [{ locationCode: 'KP101', name: 'KP Downtown Store', region: 'North', active: true }, { name: 'missing code' }], acknowledgeInvalid: true });
    expect(r.status).toBe(202);
    const runId = r.body.executionIds[0];

    let run = (await request(app).get(`/api/runs/${runId}`).set(auth())).body.run;
    expect(run.transferStatus).toBe('PENDING');

    await drainPendingRuns(deps);
    run = (await request(app).get(`/api/runs/${runId}`).set(auth())).body.run;
    expect(run.transferStatus).toBe('SUCCESS');
    expect(run.httpStatus).toBe(201);
    expect(run.requestSnapshot.body).toEqual({ locationId: 'KP101', locationName: 'KP Downtown Store', region: 'North', status: 'Active' });
    expect(run.sourceSnapshot).toEqual({ locationCode: 'KP101', name: 'KP Downtown Store', region: 'North', active: true });
    expect(run.verification.status).toBe('VERIFIED');
    expect(run.qa.status).toBe('PENDING');
    expect(JSON.stringify(run)).not.toContain(WFM_TOKEN);

    await processQaTriggers(deps);
    run = (await request(app).get(`/api/runs/${runId}`).set(auth())).body.run;
    expect(run.qa.status).toBe('RUNNING');
    expect(run.qa.qaExecutionId).toBe('qa-1');
    expect(qa.requests.find((x) => x.method === 'POST')?.body).toMatchObject({ executionId: runId, expected: run.requestSnapshot.body, recordId: 'KP101' });

    await processQaPolls(deps, runId);
    run = (await request(app).get(`/api/runs/${runId}`).set(auth())).body.run;
    expect(run.qa.status).toBe('PASSED');
    expect(run.transferStatus).toBe('SUCCESS');

    // Persistence across a "restart": a brand-new client sees the same state
    const fresh = new MongoClient(URI!);
    await fresh.connect();
    const persisted = await fresh.db(config.MONGODB_DB_NAME).collection('integration_runs').findOne({ _id: runId as never });
    expect(persisted?.transferStatus).toBe('SUCCESS');
    await fresh.close();

    // Versions and audit
    const versions = await request(app).get(`/api/integrations/${intId}/versions`).set(auth());
    expect(versions.body.items.map((v: { changeType: string }) => v.changeType)).toEqual(['ACTIVATED', 'CREATED']);
    const audits = await request(app).get('/api/audit-logs?pageSize=100').set(auth());
    const actions = audits.body.items.map((a: { action: string }) => a.action);
    for (const a of ['CONNECTION_CREATED', 'CREDENTIAL_UPDATED', 'INTEGRATION_CREATED', 'EXECUTION_STARTED', 'EXECUTION_COMPLETED', 'QA_TRIGGERED', 'QA_COMPLETED']) expect(actions).toContain(a);
    expect(JSON.stringify(audits.body)).not.toContain(WFM_TOKEN);

    // Dashboard reflects stored data
    const dash = await request(app).get('/api/dashboard').set(auth());
    expect(dash.body.executions.successfulTransfers).toBe(1);
    expect(dash.body.qa.passed).toBe(1);
  });

  it('paginates and filters execution history', async () => {
    const all = await request(app).get('/api/runs?pageSize=1&page=1').set(auth());
    expect(all.body.items.length).toBe(1);
    expect(all.body.total).toBeGreaterThan(0);
    const none = await request(app).get('/api/runs?transferStatus=FAILED').set(auth());
    expect(none.body.total).toBe(0);
    const tooBig = await request(app).get('/api/runs?pageSize=1000').set(auth());
    expect(tooBig.status).toBe(400);
  });

  it('enforces role-based authorization', async () => {
    await createUser(deps, { email: 'viewer@test.local', password: 'Viewer-password-1', role: 'VIEWER' });
    const login = await request(app).post('/api/auth/login').send({ email: 'viewer@test.local', password: 'Viewer-password-1', issueToken: true });
    const r = await request(app).post('/api/connections').set('Authorization', `Bearer ${login.body.token}`).send({});
    expect(r.status).toBe(403);
  });

  it('revokes sessions on logout', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'Admin-password-1', issueToken: true });
    const t2 = login.body.token;
    await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${t2}`).expect(200);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${t2}`)).status).toBe(401);
  });
});
