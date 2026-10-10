/**
 * Execution engine core. Pure orchestration with injected I/O so that it can be tested with
 * local HTTP servers and in-memory persistence. The MongoDB-backed worker (services/worker.ts)
 * supplies real persistence.
 */
import { sha256Json, stableStringify } from './crypto.js';
import type { Connection, Integration, IntegrationRun, ResponseSnapshot, TransferStatus, VerificationResult, QaState, AttemptRecord } from './domain.js';
import type { HttpMethod, HttpResult, SendFn } from './httpClient.js';
import { getPath, listLeafPaths, deepClone } from './paths.js';
import { redactDeep, redactHeaders, redactUrl, scrubSecrets } from './redact.js';
import { decideRetry, retryDelay } from './retry.js';
import { joinUrl } from './ssrf.js';
import { renderPath, TemplateError } from './template.js';
import { applyMappings, type FieldError } from './transform.js';
import { validatePayload } from './validate.js';

export const MAX_STORED_BODY_CHARS = 64_000;

export interface IdempotencyStore {
  /** Returns the existing record (if any) after attempting to reserve the key for this run. */
  reserve(integrationId: string, key: string, runId: string): Promise<{ reserved: boolean; existingRunId?: string; existingStatus?: string }>;
  complete(integrationId: string, key: string, runId: string, status: TransferStatus): Promise<void>;
}

export interface EngineDeps {
  send: SendFn;
  persist: (patch: Partial<IntegrationRun>) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  /** Returns true if a previous successful run exists for this integration and key. */
  historyHasKey?: (integrationId: string, keyField: string, keyValue: unknown, excludeRunId: string) => Promise<boolean>;
  idempotency?: IdempotencyStore;
  isCancelled?: () => Promise<boolean>;
}

export function buildAuthHeaders(conn: Pick<Connection, 'authType' | 'apiKeyHeader'>, secret: string | undefined): Record<string, string> {
  if (conn.authType === 'NONE') return {};
  if (!secret) throw new Error('Connection credential is not configured on the server');
  if (conn.authType === 'BEARER') return { Authorization: `Bearer ${secret}` };
  return { [conn.apiKeyHeader || 'X-API-Key']: secret };
}

export function snapshotResponse(r: Extract<HttpResult, { ok: true }>, secrets: string[]): ResponseSnapshot {
  let body: unknown;
  if (r.bodyJson !== undefined) body = redactDeep(r.bodyJson, secrets);
  else {
    const text = scrubSecrets(r.bodyText, secrets);
    body = text.length > MAX_STORED_BODY_CHARS ? `${text.slice(0, MAX_STORED_BODY_CHARS)}…[truncated]` : text;
  }
  if (stableStringify(body).length > MAX_STORED_BODY_CHARS * 2) body = { note: 'Response body too large to store in full', preview: stableStringify(body).slice(0, MAX_STORED_BODY_CHARS) };
  return { httpStatus: r.status, headers: redactHeaders(r.headers), body, truncated: r.truncated, durationMs: r.durationMs };
}

function valuesEqual(a: unknown, b: unknown, mode: 'EXACT' | 'CASE_INSENSITIVE' = 'EXACT') {
  if (mode === 'CASE_INSENSITIVE' && typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  return stableStringify(a) === stableStringify(b);
}

export function compareRecords(expected: unknown, actual: unknown, fields?: string[]): Array<{ field: string; expected: unknown; actual: unknown }> {
  const list = fields && fields.length > 0 ? fields : listLeafPaths(expected);
  const diffs: Array<{ field: string; expected: unknown; actual: unknown }> = [];
  for (const f of list) {
    const e = getPath(expected, f);
    const a = getPath(actual, f);
    if (!a.found || !valuesEqual(e.value, a.value)) diffs.push({ field: f, expected: e.value, actual: a.found ? a.value : '(missing)' });
  }
  return diffs;
}

function summarize(errors: FieldError[]) {
  return errors.slice(0, 3).map((e) => `${e.field}: ${e.message}`).join('; ') + (errors.length > 3 ? ` (+${errors.length - 3} more)` : '');
}

export interface EngineInput {
  run: Pick<IntegrationRun, '_id' | 'correlationId' | 'sourceSnapshot' | 'integrationId'>;
  integration: Integration;
  connection: Connection;
  secret?: string;
}

export interface EngineOutcome {
  transferStatus: TransferStatus;
  verification: VerificationResult;
  qa: QaState;
}

/**
 * Executes one run end-to-end (transfer + optional read-back). QA is not triggered here; the run is
 * marked qa.status=PENDING for the user to start a check from the local QA Agent.
 */
export async function executeRun(input: EngineInput, deps: EngineDeps): Promise<EngineOutcome> {
  const { run, integration, connection, secret } = input;
  const dest = integration.destination;
  const secrets = secret ? [secret] : [];
  const qaNotStarted = (message: string): QaState => (integration.qa?.enabled ? { status: 'NOT_STARTED', message } : { status: 'NOT_REQUESTED' });
  const notApplicable: VerificationResult = { status: 'NOT_APPLICABLE', message: 'Transfer did not succeed; read-back not performed' };

  const fail = async (status: TransferStatus, stage: string, errorSummary: string, extra: Partial<IntegrationRun> = {}): Promise<EngineOutcome> => {
    const qa = qaNotStarted('Transfer did not succeed; QA validation was not started');
    await deps.persist({ transferStatus: status, stage, errorSummary, endedAt: deps.now(), verification: notApplicable, qa, lease: null, ...extra });
    return { transferStatus: status, verification: notApplicable, qa };
  };

  await deps.persist({ transferStatus: 'RUNNING', stage: 'TRANSFORMATION', startedAt: deps.now() });

  if (!integration.active) return fail('CANCELLED', 'CONFIGURATION', 'Integration is inactive');
  if (!connection.active) return fail('FAILED', 'CONFIGURATION', `Destination connection "${connection.name}" is inactive`);

  // 1. Transform (source snapshot is cloned inside applyMappings and never mutated).
  const { output: payload, errors: tErrors } = applyMappings(deepClone(run.sourceSnapshot), integration.mappings);
  if (tErrors.length > 0) return fail('FAILED', 'TRANSFORMATION', `Transformation failed: ${summarize(tErrors)}`, { transformationErrors: tErrors });

  // 2. Validate transformed payload.
  const vErrors = validatePayload(payload, integration.validationRules);
  if (vErrors.length > 0) return fail('FAILED', 'VALIDATION', `Validation failed: ${summarize(vErrors)}`, { validationErrors: vErrors });

  // 3. Duplicate check against history (batch duplicates are rejected at submission time).
  const dup = integration.duplicateCheck;
  if (dup && dup.scope === 'BATCH_AND_HISTORY' && deps.historyHasKey) {
    const key = getPath(payload, dup.keyField).value;
    if (key !== undefined && key !== null && (await deps.historyHasKey(integration._id, dup.keyField, key, run._id))) {
      const err = { field: dup.keyField, code: 'DUPLICATE', message: `A previous successful transfer exists for ${dup.keyField}=${String(key)}` };
      return fail('FAILED', 'VALIDATION', err.message, { validationErrors: [err] });
    }
  }

  // 4. Idempotency key (only when the destination actually supports one).
  let idempotencyKey: string | undefined;
  if (dest.idempotency?.supported) {
    const v = dest.idempotency.keyField ? getPath(payload, dest.idempotency.keyField).value : undefined;
    if (v === undefined || v === null || v === '') {
      const err = { field: dest.idempotency.keyField ?? '(idempotency)', code: 'REQUIRED', message: 'Idempotency key field has no value' };
      return fail('FAILED', 'VALIDATION', err.message, { validationErrors: [err] });
    }
    idempotencyKey = `${integration._id}:${String(v)}`;
    if (deps.idempotency) {
      const r = await deps.idempotency.reserve(integration._id, idempotencyKey, run._id);
      if (!r.reserved && r.existingStatus === 'SUCCESS') {
        return fail('FAILED', 'IDEMPOTENCY', `Idempotency key already completed successfully in execution ${r.existingRunId}; not resent`);
      }
      if (!r.reserved && r.existingRunId !== run._id && r.existingStatus !== 'FAILED') {
        return fail('FAILED', 'IDEMPOTENCY', `Idempotency key is in use by execution ${r.existingRunId} (status ${r.existingStatus}); not resent`);
      }
    }
  }

  // 5. Build request.
  let url: string;
  let headers: Record<string, string>;
  try {
    url = joinUrl(connection.baseUrl, renderPath(dest.endpointPath, { payload }));
    headers = {
      ...connection.defaultHeaders,
      ...dest.headers,
      'X-Correlation-ID': run.correlationId,
      'X-Hub-Execution-ID': run._id,
      ...buildAuthHeaders(connection, secret),
    };
    if (idempotencyKey && dest.idempotency.headerName) headers[dest.idempotency.headerName] = idempotencyKey;
  } catch (e) {
    const msg = e instanceof TemplateError ? `Endpoint path template error: ${e.message}` : (e as Error).message;
    return fail('FAILED', 'CONFIGURATION', msg);
  }
  const method = dest.method as HttpMethod;
  const body = method === 'DELETE' ? undefined : payload;
  const requestSnapshot = {
    method,
    url: redactUrl(url),
    headers: redactHeaders(headers, connection.apiKeyHeader ? [connection.apiKeyHeader] : []),
    body: body === undefined ? null : redactDeep(body, secrets),
    hash: sha256Json(body ?? null),
    createdAt: deps.now(),
  };
  await deps.persist({ requestSnapshot, stage: 'TRANSFER' });

  // 6. Send with bounded retries.
  const attempts: AttemptRecord[] = [];
  let result: HttpResult | undefined;
  for (let attempt = 1; ; attempt++) {
    if (deps.isCancelled && (await deps.isCancelled())) {
      return fail('CANCELLED', 'TRANSFER', 'Execution was cancelled before the next attempt', { attempts, retryCount: Math.max(0, attempts.length - 1) });
    }
    const startedAt = deps.now();
    result = await deps.send({ url, method, headers, body, timeoutMs: dest.timeoutMs || connection.timeoutMs });
    const decision = decideRetry({ attempt, policy: integration.execution.retry, method, idempotencyKeySent: Boolean(idempotencyKey && dest.idempotency.headerName), result, successStatuses: dest.successStatuses });
    attempts.push({
      attempt,
      startedAt,
      endedAt: deps.now(),
      httpStatus: result.ok ? result.status : undefined,
      errorKind: result.ok ? undefined : result.errorKind,
      message: result.ok ? undefined : scrubSecrets(result.message, secrets),
      durationMs: result.durationMs,
      retryDecision: decision.reason,
    });
    if (!decision.retry) break;
    await deps.persist({ transferStatus: 'RETRYING', attempts, retryCount: attempt });
    await deps.sleep(retryDelay(integration.execution.retry, attempt));
    await deps.persist({ transferStatus: 'RUNNING' });
  }
  const retryCount = attempts.length - 1;

  if (!result.ok) {
    const status: TransferStatus = result.errorKind === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED';
    const unknownOutcome = result.requestSent && (method === 'POST' || method === 'PATCH') ? ' Outcome at the destination is unknown; check the destination before re-running.' : '';
    if (idempotencyKey && deps.idempotency) await deps.idempotency.complete(integration._id, idempotencyKey, run._id, status);
    return fail(status, 'TRANSFER', `${result.errorKind}: ${scrubSecrets(result.message, secrets)}.${unknownOutcome}`, { attempts, retryCount, httpStatus: null });
  }

  const response = snapshotResponse(result, secrets);
  const accepted = dest.successStatuses.includes(result.status);
  if (!accepted) {
    if (idempotencyKey && deps.idempotency) await deps.idempotency.complete(integration._id, idempotencyKey, run._id, 'FAILED');
    const hint = result.status === 401 || result.status === 403 ? ' (authentication/authorization failed — check the connection credential and its permissions)' : '';
    return fail('FAILED', 'TRANSFER', `Destination returned HTTP ${result.status}, which is not a configured success status${hint}`, { attempts, retryCount, response, httpStatus: result.status });
  }

  // 7. Destination record identifier.
  let destinationRecordId: string | null = null;
  if (dest.destinationIdFrom) {
    const src = dest.destinationIdFrom.source === 'RESPONSE' ? result.bodyJson : payload;
    const v = src === undefined ? undefined : getPath(src, dest.destinationIdFrom.path).value;
    if (v !== undefined && v !== null && typeof v !== 'object') destinationRecordId = String(v);
  }

  await deps.persist({ transferStatus: 'SUCCESS', stage: 'READBACK', attempts, retryCount, response, httpStatus: result.status, destinationRecordId });
  if (idempotencyKey && deps.idempotency) await deps.idempotency.complete(integration._id, idempotencyKey, run._id, 'SUCCESS');

  // 8. Read-back verification (separate GET). Never reported as verified without performing it.
  let verification: VerificationResult;
  const rb = dest.readback;
  if (!rb || !rb.enabled || !rb.pathTemplate) {
    verification = { status: 'NOT_CONFIGURED', message: 'Destination persistence could not be independently verified: no read-back (GET) endpoint is configured for this integration.' };
  } else {
    let rbUrl = '';
    try {
      rbUrl = joinUrl(connection.baseUrl, renderPath(rb.pathTemplate, { payload, destinationId: destinationRecordId ?? undefined }));
      const r = await deps.send({ url: rbUrl, method: 'GET', headers: { ...connection.defaultHeaders, 'X-Correlation-ID': run.correlationId, ...buildAuthHeaders(connection, secret) }, timeoutMs: dest.timeoutMs || connection.timeoutMs });
      if (!r.ok) verification = { status: 'ERROR', message: `Read-back request failed: ${r.errorKind}: ${scrubSecrets(r.message, secrets)}`, url: redactUrl(rbUrl), checkedAt: deps.now() };
      else if (r.status === 404) verification = { status: 'MISMATCH', message: 'Read-back returned 404: the record was not found at the destination', url: redactUrl(rbUrl), httpStatus: 404, checkedAt: deps.now() };
      else if (r.status < 200 || r.status > 299) verification = { status: 'ERROR', message: `Read-back returned HTTP ${r.status}`, url: redactUrl(rbUrl), httpStatus: r.status, checkedAt: deps.now() };
      else if (r.bodyJson === undefined) verification = { status: 'ERROR', message: 'Read-back response was not JSON; cannot compare', url: redactUrl(rbUrl), httpStatus: r.status, checkedAt: deps.now() };
      else {
        const record = rb.responseRecordPath ? getPath(r.bodyJson, rb.responseRecordPath).value : r.bodyJson;
        const differences = compareRecords(payload, record, rb.compareFields);
        verification = differences.length === 0
          ? { status: 'VERIFIED', message: 'Read-back record matches the transformed request', url: redactUrl(rbUrl), httpStatus: r.status, checkedAt: deps.now(), differences: [] }
          : { status: 'MISMATCH', message: `${differences.length} field(s) differ between the request and the read-back record`, url: redactUrl(rbUrl), httpStatus: r.status, checkedAt: deps.now(), differences: redactDeep(differences, secrets) };
      }
    } catch (e) {
      verification = { status: 'ERROR', message: `Read-back could not be performed: ${(e as Error).message}`, url: rbUrl ? redactUrl(rbUrl) : undefined, checkedAt: deps.now() };
    }
  }

  // 9. QA is triggered asynchronously by the QA service.
  let qa: QaState;
  if (!integration.qa?.enabled) qa = { status: 'NOT_REQUESTED' };
  else qa = { status: 'PENDING', message: 'Waiting for a manual check from the local QA Agent' };

  await deps.persist({ stage: 'COMPLETE', verification, qa, endedAt: deps.now(), lease: null, errorSummary: verification.status === 'MISMATCH' ? verification.message : null });
  return { transferStatus: 'SUCCESS', verification, qa };
}
