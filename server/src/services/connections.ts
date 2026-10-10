import type { AppDeps, AuthUser } from '../context.js';
import { decryptSecret, encryptSecret, newId } from '../core/crypto.js';
import type { Connection } from '../core/domain.js';
import { buildAuthHeaders } from '../core/engine.js';
import { missingContractFields } from '../core/qa.js';
import { scrubSecrets } from '../core/redact.js';
import { joinUrl, validateDestinationUrl } from '../core/ssrf.js';
import { badRequest, conflict, notFound, unprocessable } from '../http/errors.js';
import { audit } from './audit.js';
import type { z } from 'zod';
import type { ConnectionInputSchema } from '../schemas.js';

type ConnectionInput = z.infer<typeof ConnectionInputSchema>;

function cols(deps: AppDeps) {
  if (!deps.cols) throw new Error('Database unavailable');
  return deps.cols;
}

/** Public representation: secrets are never returned, only whether one is configured. */
export function toPublicConnection(c: Connection) {
  const { secret, ...rest } = c;
  return {
    ...rest,
    hasSecret: Boolean(secret),
    qaContractMissing: c.application === 'KP_QA_AGENT' ? missingContractFields(c.qaContract) : undefined,
  };
}

export async function getConnection(deps: AppDeps, id: string): Promise<Connection> {
  const c = (await cols(deps).connections.findOne({ _id: id as never })) as unknown as Connection | null;
  if (!c) throw notFound('Connection');
  return c;
}

export function readSecret(deps: AppDeps, c: Connection): string | undefined {
  if (!c.secret) return undefined;
  try {
    return decryptSecret(c.secret, deps.config.SECRETS_ENCRYPTION_KEY);
  } catch {
    throw unprocessable(`Stored credential for "${c.name}" cannot be decrypted (was SECRETS_ENCRYPTION_KEY changed?). Re-enter the credential.`);
  }
}

function checkInput(deps: AppDeps, input: ConnectionInput) {
  try {
    validateDestinationUrl(input.baseUrl, deps.policy);
  } catch (e) {
    throw badRequest(`Base URL rejected: ${(e as Error).message}`);
  }
  if (input.authType === 'API_KEY' && !input.apiKeyHeader) throw badRequest('API key authentication requires the header name documented by the destination API');
  if (input.qaContract && input.application !== 'KP_QA_AGENT') throw badRequest('A QA contract can only be configured on a KP QA Agent connection');
}

export async function createConnection(deps: AppDeps, input: ConnectionInput, actor: AuthUser) {
  checkInput(deps, input);
  const now = deps.now();
  const doc: Connection = {
    _id: newId('conn'),
    name: input.name,
    application: input.application,
    description: input.description,
    baseUrl: input.baseUrl.replace(/\/+$/, ''),
    authType: input.authType,
    apiKeyHeader: input.apiKeyHeader,
    secret: null,
    secretUpdatedAt: null,
    defaultHeaders: input.defaultHeaders ?? {},
    timeoutMs: input.timeoutMs,
    healthCheck: input.healthCheck ?? null,
    apiDocsUrl: input.apiDocsUrl || undefined,
    operations: input.operations,
    qaContract: (input.qaContract as Connection['qaContract']) ?? null,
    active: false, // must be tested before activation
    lastTest: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: actor.email,
    updatedBy: actor.email,
  };
  await cols(deps).connections.insertOne(doc as never);
  await audit(deps, { action: 'CONNECTION_CREATED', resourceType: 'connection', resourceId: doc._id, actor, details: { name: doc.name, application: doc.application, baseUrl: doc.baseUrl } });
  return toPublicConnection(doc);
}

export async function updateConnection(deps: AppDeps, id: string, input: ConnectionInput, actor: AuthUser) {
  checkInput(deps, input);
  const existing = await getConnection(deps, id);
  const securityChanged = existing.baseUrl !== input.baseUrl.replace(/\/+$/, '') || existing.authType !== input.authType || existing.apiKeyHeader !== input.apiKeyHeader;
  const set = {
    name: input.name,
    application: input.application,
    description: input.description,
    baseUrl: input.baseUrl.replace(/\/+$/, ''),
    authType: input.authType,
    apiKeyHeader: input.apiKeyHeader,
    defaultHeaders: input.defaultHeaders ?? {},
    timeoutMs: input.timeoutMs,
    healthCheck: input.healthCheck ?? null,
    apiDocsUrl: input.apiDocsUrl || undefined,
    operations: input.operations,
    qaContract: input.qaContract ?? null,
    updatedAt: deps.now(),
    updatedBy: actor.email,
    // Changing where/how we authenticate invalidates the previous test and deactivates the connection.
    ...(securityChanged ? { active: false, lastTest: null } : {}),
  };
  const r = await cols(deps).connections.findOneAndUpdate({ _id: id as never, version: existing.version }, { $set: set, $inc: { version: 1 } }, { returnDocument: 'after' });
  if (!r) throw conflict('Connection was modified by someone else; reload and try again');
  await audit(deps, { action: 'CONNECTION_UPDATED', resourceType: 'connection', resourceId: id, actor, details: { securityChanged } });
  if (securityChanged) await audit(deps, { action: 'CREDENTIAL_UPDATED', resourceType: 'connection', resourceId: id, actor, details: { change: 'security configuration (base URL / auth type) changed; connection deactivated until re-tested' } });
  return toPublicConnection(r as unknown as Connection);
}

export async function setSecret(deps: AppDeps, id: string, secret: string | null, actor: AuthUser) {
  const c = await getConnection(deps, id);
  if (secret !== null && c.authType === 'NONE') throw badRequest('This connection uses no authentication; set an auth type first');
  const enc = secret === null ? null : encryptSecret(secret, deps.config.SECRETS_ENCRYPTION_KEY);
  await cols(deps).connections.updateOne({ _id: id as never }, { $set: { secret: enc, secretUpdatedAt: secret === null ? null : deps.now(), active: false, lastTest: null, updatedAt: deps.now(), updatedBy: actor.email }, $inc: { version: 1 } });
  await audit(deps, { action: secret === null ? 'CREDENTIAL_REMOVED' : 'CREDENTIAL_UPDATED', resourceType: 'connection', resourceId: id, actor, details: { note: 'Credential value is never logged. Connection deactivated until re-tested.' } });
  return toPublicConnection(await getConnection(deps, id));
}

/** Performs a real request against the configured health-check endpoint. */
export async function testConnection(deps: AppDeps, id: string, actor: AuthUser) {
  const c = await getConnection(deps, id);
  if (!c.healthCheck?.path) throw unprocessable('No health-check endpoint is configured. Add the health-check path documented by the application before testing.');
  let url = '';
  let result: Connection['lastTest'];
  const secret = readSecret(deps, c);
  try {
    url = joinUrl(c.baseUrl, c.healthCheck.path);
    const headers = { ...c.defaultHeaders, ...buildAuthHeaders(c, secret) };
    const r = await deps.send({ url, method: 'GET', headers, timeoutMs: c.timeoutMs, maxResponseBytes: 64_000 });
    if (!r.ok) result = { at: deps.now(), ok: false, durationMs: r.durationMs, message: `${r.errorKind}: ${scrubSecrets(r.message, [secret])}`, url };
    else {
      const ok = c.healthCheck.expectedStatuses.includes(r.status);
      const hint = r.status === 401 || r.status === 403 ? ' — authentication failed; check the credential' : '';
      result = { at: deps.now(), ok, httpStatus: r.status, durationMs: r.durationMs, message: ok ? `Received expected HTTP ${r.status}` : `Unexpected HTTP ${r.status} (expected ${c.healthCheck.expectedStatuses.join(', ')})${hint}`, url };
    }
  } catch (e) {
    result = { at: deps.now(), ok: false, message: scrubSecrets((e as Error).message, [secret]), url };
  }
  await cols(deps).connections.updateOne({ _id: id as never }, { $set: { lastTest: result } });
  await audit(deps, { action: 'CONNECTION_TESTED', resourceType: 'connection', resourceId: id, actor, result: result.ok ? 'SUCCESS' : 'FAILURE', details: { httpStatus: result.httpStatus, message: result.message } });
  return result;
}

export async function setConnectionActive(deps: AppDeps, id: string, active: boolean, actor: AuthUser) {
  const c = await getConnection(deps, id);
  if (active) {
    if (!c.lastTest?.ok) throw unprocessable('Run a successful connection test before activating this connection');
    if (c.authType !== 'NONE' && !c.secret) throw unprocessable('Configure the credential before activating this connection');
  }
  await cols(deps).connections.updateOne({ _id: id as never }, { $set: { active, updatedAt: deps.now(), updatedBy: actor.email }, $inc: { version: 1 } });
  await audit(deps, { action: active ? 'CONNECTION_ACTIVATED' : 'CONNECTION_DEACTIVATED', resourceType: 'connection', resourceId: id, actor });
  return toPublicConnection(await getConnection(deps, id));
}
