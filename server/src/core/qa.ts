/**
 * KP QA Agent adapter. The QA Agent API contract was not available when the Hub was built, so every
 * contract detail (paths, request body, response field locations, status vocabulary) is supplied as
 * configuration on the KP QA Agent connection (connection.qaContract). Nothing is assumed.
 */
import type { Connection, QaContract, QaState, QaStatus } from './domain.js';
import type { SendFn } from './httpClient.js';
import { getPath } from './paths.js';
import { redactDeep, scrubSecrets } from './redact.js';
import { joinUrl } from './ssrf.js';
import { renderJson, renderPath, TemplateError } from './template.js';
import { buildAuthHeaders } from './engine.js';

/** Variables the Hub makes available to the QA request template. */
export const QA_TEMPLATE_VARIABLES = [
  'executionId', 'correlationId', 'entityType', 'integrationId', 'integrationName', 'operation', 'operationMethod', 'operationPath',
  'destinationRecordId', 'expectedPayload', 'expectedPayloadHash', 'expectedPayloadRef', 'destinationConnectionRef',
  'verificationEndpoint', 'verificationOperation', 'comparisonRules',
] as const;

export function missingContractFields(c: Partial<QaContract> | null | undefined): string[] {
  if (!c) return ['qaContract'];
  const missing: string[] = [];
  if (!c.triggerPath) missing.push('triggerPath');
  if (!c.triggerMethod) missing.push('triggerMethod');
  if (!c.requestTemplate || Object.keys(c.requestTemplate).length === 0) missing.push('requestTemplate');
  if (!c.executionIdPath) missing.push('executionIdPath');
  if (!c.statusPathTemplate) missing.push('statusPathTemplate');
  if (!c.statusFieldPath) missing.push('statusFieldPath');
  if (!c.statusValues || ![...(c.statusValues.passed ?? []), ...(c.statusValues.failed ?? [])].length) missing.push('statusValues');
  if (!c.contractReference) missing.push('contractReference');
  return missing;
}

export function mapQaStatus(raw: unknown, values: QaContract['statusValues']): QaStatus | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim().toLowerCase();
  const has = (arr: string[]) => arr.some((v) => v.trim().toLowerCase() === s);
  if (has(values.passed)) return 'PASSED';
  if (has(values.failed)) return 'FAILED';
  if (has(values.error)) return 'ERROR';
  if (has(values.running)) return 'RUNNING';
  return null;
}

export interface QaCallDeps {
  send: SendFn;
  now: () => Date;
}

function extractDetails(body: unknown, c: QaContract, secrets: string[]) {
  const differences = c.differencesPath ? getPath(body, c.differencesPath).value : undefined;
  const errorMessage = c.errorMessagePath ? getPath(body, c.errorMessagePath).value : undefined;
  return {
    differences: Array.isArray(differences) ? (redactDeep(differences.slice(0, 500), secrets) as unknown[]) : undefined,
    errorDetails: errorMessage !== undefined ? redactDeep(errorMessage, secrets) : undefined,
  };
}

export async function triggerQa(
  conn: Connection,
  secret: string | undefined,
  vars: Record<string, unknown>,
  deps: QaCallDeps,
): Promise<QaState> {
  const c = conn.qaContract;
  const missing = missingContractFields(c);
  const now = deps.now();
  if (!conn.active) return { status: 'NOT_STARTED', message: `KP QA Agent connection "${conn.name}" is inactive`, connectionId: conn._id };
  if (!c || missing.length) return { status: 'NOT_STARTED', message: `KP QA Agent API contract is not configured (missing: ${missing.join(', ')})`, connectionId: conn._id };
  const secrets = secret ? [secret] : [];
  let body: unknown;
  let url: string;
  let headers: Record<string, string>;
  try {
    body = renderJson(c.requestTemplate, vars);
    url = joinUrl(conn.baseUrl, renderPath(c.triggerPath, vars));
    headers = { ...conn.defaultHeaders, 'X-Correlation-ID': String(vars.correlationId ?? ''), ...buildAuthHeaders(conn, secret) };
  } catch (e) {
    const msg = e instanceof TemplateError ? `QA request template error: ${e.message}` : (e as Error).message;
    return { status: 'ERROR', message: msg, connectionId: conn._id, completedAt: now };
  }
  const r = await deps.send({ url, method: c.triggerMethod, headers, body, timeoutMs: conn.timeoutMs });
  if (!r.ok) {
    // QA Agent unavailable: the transfer status is not changed; only the QA status reflects the problem.
    return { status: 'ERROR', message: `KP QA Agent unavailable: ${r.errorKind}: ${scrubSecrets(r.message, secrets)}`, connectionId: conn._id, completedAt: now };
  }
  const responseBody = r.bodyJson !== undefined ? redactDeep(r.bodyJson, secrets) : scrubSecrets(r.bodyText.slice(0, 4000), secrets);
  if (!(c.triggerSuccessStatuses ?? [200, 201, 202]).includes(r.status)) {
    return { status: 'ERROR', message: `KP QA Agent rejected the trigger with HTTP ${r.status}`, connectionId: conn._id, completedAt: now, lastResponse: responseBody };
  }
  const qaId = r.bodyJson !== undefined ? getPath(r.bodyJson, c.executionIdPath).value : undefined;
  if (qaId === undefined || qaId === null || typeof qaId === 'object') {
    return { status: 'ERROR', message: `KP QA Agent response did not contain an execution ID at "${c.executionIdPath}"`, connectionId: conn._id, completedAt: now, lastResponse: responseBody };
  }
  const raw = c.initialStatusPath ? getPath(r.bodyJson, c.initialStatusPath).value : undefined;
  const mapped = mapQaStatus(raw, c.statusValues);
  const base: QaState = {
    status: 'RUNNING',
    connectionId: conn._id,
    qaExecutionId: String(qaId),
    rawStatus: raw === undefined ? undefined : String(raw),
    triggeredAt: now,
    pollCount: 0,
    nextPollAt: new Date(now.getTime() + Math.max(2, c.pollIntervalSeconds) * 1000),
    deadlineAt: new Date(now.getTime() + Math.max(1, c.maxPollMinutes) * 60_000),
    lastResponse: responseBody,
    message: 'QA execution started; status will be polled asynchronously',
  };
  if (mapped && mapped !== 'RUNNING') {
    return { ...base, ...extractDetails(r.bodyJson, c, secrets), status: mapped, completedAt: now, nextPollAt: undefined, message: `QA Agent reported ${String(raw)}` };
  }
  return base;
}

export async function pollQa(conn: Connection, secret: string | undefined, state: QaState, deps: QaCallDeps): Promise<QaState> {
  const c = conn.qaContract;
  const now = deps.now();
  const secrets = secret ? [secret] : [];
  if (!c || !state.qaExecutionId) return { ...state, status: 'ERROR', message: 'Cannot poll: QA contract or QA execution ID missing', completedAt: now };
  if (state.deadlineAt && now > new Date(state.deadlineAt)) {
    return { ...state, status: 'ERROR', message: `QA Agent did not report a final status within ${c.maxPollMinutes} minutes`, completedAt: now, nextPollAt: undefined };
  }
  let url: string;
  try {
    url = joinUrl(conn.baseUrl, renderPath(c.statusPathTemplate, { qaExecutionId: state.qaExecutionId }));
  } catch (e) {
    return { ...state, status: 'ERROR', message: `QA status path error: ${(e as Error).message}`, completedAt: now };
  }
  const pollCount = (state.pollCount ?? 0) + 1;
  const next = new Date(now.getTime() + Math.max(2, c.pollIntervalSeconds) * 1000);
  const r = await deps.send({ url, method: 'GET', headers: { ...conn.defaultHeaders, ...buildAuthHeaders(conn, secret) }, timeoutMs: conn.timeoutMs });
  if (!r.ok) {
    // Transient unavailability: keep polling until the deadline.
    return { ...state, pollCount, lastPolledAt: now, nextPollAt: next, message: `Status poll failed (${r.errorKind}); will retry` };
  }
  const responseBody = r.bodyJson !== undefined ? redactDeep(r.bodyJson, secrets) : scrubSecrets(r.bodyText.slice(0, 4000), secrets);
  if (r.status < 200 || r.status > 299 || r.bodyJson === undefined) {
    return { ...state, pollCount, lastPolledAt: now, nextPollAt: next, lastResponse: responseBody, message: `Status poll returned HTTP ${r.status}; will retry` };
  }
  const raw = getPath(r.bodyJson, c.statusFieldPath).value;
  const mapped = mapQaStatus(raw, c.statusValues);
  if (mapped && mapped !== 'RUNNING') {
    return { ...state, ...extractDetails(r.bodyJson, c, secrets), status: mapped, rawStatus: String(raw), pollCount, lastPolledAt: now, completedAt: now, nextPollAt: undefined, lastResponse: responseBody, message: `QA Agent reported ${String(raw)}` };
  }
  return {
    ...state,
    status: 'RUNNING',
    rawStatus: raw === undefined ? undefined : String(raw),
    pollCount,
    lastPolledAt: now,
    nextPollAt: next,
    lastResponse: responseBody,
    message: mapped ? 'QA execution in progress' : `Unrecognised QA status "${String(raw)}"; still polling (add it to the status mapping if it is final)`,
  };
}
