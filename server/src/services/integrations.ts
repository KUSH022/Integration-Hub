import type { AppDeps, AuthUser } from '../context.js';
import { newId } from '../core/crypto.js';
import { isOperationalEntity, type Connection, type Integration, type IntegrationConfig } from '../core/domain.js';
import { listPlaceholders } from '../core/template.js';
import { applyMappings, validateMappingRules } from '../core/transform.js';
import { findBatchDuplicates, validatePayload, validateRuleDefinitions } from '../core/validate.js';
import { conflict, notFound, unprocessable } from '../http/errors.js';
import type { IntegrationConfigInput } from '../schemas.js';
import { audit } from './audit.js';

function cols(deps: AppDeps) {
  if (!deps.cols) throw new Error('Database unavailable');
  return deps.cols;
}

export interface ConfigIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

/** Cross-field and cross-reference validation run before every save. */
export async function validateIntegrationConfig(deps: AppDeps, cfg: IntegrationConfigInput): Promise<ConfigIssue[]> {
  const issues: ConfigIssue[] = [];
  const err = (field: string, message: string) => issues.push({ field, message, severity: 'error' });
  const warn = (field: string, message: string) => issues.push({ field, message, severity: 'warning' });

  if (!isOperationalEntity(cfg.entityType)) err('entityType', `Entity type "${cfg.entityType}" is not operationally supported yet`);
  for (const e of validateMappingRules(cfg.mappings as never)) err(`mappings.${e.field}`, e.message);
  for (const e of validateRuleDefinitions(cfg.validationRules as never)) err(`validationRules.${e.field}`, e.message);

  const d = cfg.destination;
  if (!d.connectionId) err('destination.connectionId', 'Select a destination connection');
  if (!d.endpointPath) err('destination.endpointPath', 'Enter the destination endpoint path from the destination API contract');
  if (d.successStatuses.some((s) => s >= 400)) err('destination.successStatuses', 'Success status codes must not include 4xx/5xx codes');
  const targets = new Set(cfg.mappings.map((m) => m.targetPath));
  for (const p of listPlaceholders(d.endpointPath)) {
    if (!p.startsWith('payload.') || !targets.has(p.slice(8))) err('destination.endpointPath', `Placeholder {{${p}}} must reference a mapped destination field as {{payload.<field>}}`);
  }
  if (d.idempotency.supported) {
    if (!d.idempotency.headerName) err('destination.idempotency.headerName', 'Enter the idempotency header name documented by the destination');
    if (!d.idempotency.keyField || !targets.has(d.idempotency.keyField)) err('destination.idempotency.keyField', 'Idempotency key field must be a mapped destination field');
  }
  if (d.readback?.enabled) {
    if (!d.readback.pathTemplate) err('destination.readback.pathTemplate', 'Enter the read-back GET path documented by the destination');
    else {
      for (const p of listPlaceholders(d.readback.pathTemplate)) {
        if (p === 'destinationId') {
          if (!d.destinationIdFrom) err('destination.destinationIdFrom', 'Read-back path uses {{destinationId}}; configure where the destination record ID comes from');
        } else if (!p.startsWith('payload.') || !targets.has(p.slice(8))) err('destination.readback.pathTemplate', `Unknown placeholder {{${p}}}`);
      }
    }
  } else {
    warn('destination.readback', 'No read-back endpoint: destination persistence will be reported as "not independently verified".');
  }
  if (cfg.duplicateCheck && !targets.has(cfg.duplicateCheck.keyField)) err('duplicateCheck.keyField', 'Duplicate-check field must be a mapped destination field');
  if ((d.method === 'POST' || d.method === 'PATCH') && cfg.execution.retry.retryCount > 0 && !d.idempotency.supported) {
    warn('execution.retry', `${d.method} requests are only retried when they were not delivered (or on HTTP 429), to avoid duplicate records.`);
  }

  if (d.connectionId) {
    const conn = (await cols(deps).connections.findOne({ _id: d.connectionId as never })) as unknown as Connection | null;
    if (!conn) err('destination.connectionId', 'Destination connection not found');
    else {
      if (conn.application === 'KP_QA_AGENT') err('destination.connectionId', 'A KP QA Agent connection cannot be used as a transfer destination');
      if (!conn.active) warn('destination.connectionId', `Connection "${conn.name}" is inactive; executions will fail until it is tested and activated`);
      const ops = conn.operations ?? [];
      if (ops.length > 0 && d.endpointPath && !ops.some((o) => o.method === d.method && o.path === d.endpointPath)) {
        warn('destination.endpointPath', `${d.method} ${d.endpointPath} is not among the operations documented on connection "${conn.name}"`);
      }
    }
  }
  // QA is requested manually from the local QA Agent; the Hub never calls the Agent.
  if (cfg.source.sample) {
    const { output, errors } = applyMappings(cfg.source.sample, cfg.mappings as never);
    for (const e of errors) warn(`sample.${e.field}`, `Sample record: ${e.message}`);
    for (const e of validatePayload(output, cfg.validationRules as never)) warn(`sample.${e.field}`, `Sample record: ${e.message}`);
  }
  return issues;
}

export function previewRecords(mappings: IntegrationConfig['mappings'], rules: IntegrationConfig['validationRules'], records: unknown[], duplicateKey?: string) {
  const results = records.map((r, i) => {
    const { output, errors } = applyMappings(r, mappings);
    const validationErrors = errors.length ? [] : validatePayload(output, rules);
    return { index: i, output, transformationErrors: errors, validationErrors, valid: errors.length === 0 && validationErrors.length === 0 };
  });
  if (duplicateKey) {
    const dups = findBatchDuplicates(results.map((r) => r.output), duplicateKey);
    for (const [i, msg] of dups) {
      results[i].validationErrors.push({ field: duplicateKey, code: 'DUPLICATE', message: msg, recordIndex: i });
      results[i].valid = false;
    }
  }
  return { results, validCount: results.filter((r) => r.valid).length, invalidCount: results.filter((r) => !r.valid).length };
}

export async function getIntegration(deps: AppDeps, id: string): Promise<Integration> {
  const i = (await cols(deps).integrations.findOne({ _id: id as never })) as unknown as Integration | null;
  if (!i) throw notFound('Integration');
  return i;
}

function configOf(i: Integration): IntegrationConfig {
  const { _id, version, createdAt, updatedAt, createdBy, updatedBy, ...cfg } = i;
  void _id; void version; void createdAt; void updatedAt; void createdBy; void updatedBy;
  return cfg;
}

async function storeVersion(deps: AppDeps, i: Integration, changeType: string, actor: AuthUser, changedFields: string[]) {
  await cols(deps).integrationVersions.insertOne({
    _id: `${i._id}_v${i.version}` as never,
    integrationId: i._id,
    version: i.version,
    config: configOf(i),
    changeType,
    changedFields,
    createdAt: deps.now(),
    createdBy: actor.email,
  });
}

function changedTopLevel(a: Record<string, unknown>, b: Record<string, unknown>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return Array.from(keys).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

function assertNoErrors(issues: ConfigIssue[]) {
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length) throw unprocessable('Integration configuration is invalid', issues);
}

export async function createIntegration(deps: AppDeps, cfg: IntegrationConfigInput, actor: AuthUser, changeType = 'CREATED') {
  const issues = await validateIntegrationConfig(deps, cfg);
  assertNoErrors(issues);
  const now = deps.now();
  const doc: Integration = { ...(cfg as unknown as IntegrationConfig), active: false, _id: newId('int'), version: 1, createdAt: now, updatedAt: now, createdBy: actor.email, updatedBy: actor.email };
  await cols(deps).integrations.insertOne(doc as never);
  await storeVersion(deps, doc, changeType, actor, ['*']);
  await audit(deps, { action: 'INTEGRATION_CREATED', resourceType: 'integration', resourceId: doc._id, actor, details: { name: doc.name, entityType: doc.entityType } });
  if (cfg.active) {
    // Activation is an administrative action; non-admins always create inactive integrations.
    if (actor.role !== 'ADMIN') return { integration: doc, warnings: [...issues, { field: 'active', message: 'Saved as inactive: activation requires the ADMIN role', severity: 'warning' as const }] };
    try {
      return { integration: await setIntegrationActive(deps, doc._id, true, actor), warnings: issues };
    } catch (e) {
      return { integration: doc, warnings: [...issues, { field: 'active', message: `Saved as inactive: ${(e as Error).message}`, severity: 'warning' as const }] };
    }
  }
  return { integration: doc, warnings: issues };
}

export async function updateIntegration(deps: AppDeps, id: string, cfg: IntegrationConfigInput, expectedVersion: number | undefined, actor: AuthUser) {
  const existing = await getIntegration(deps, id);
  if (expectedVersion !== undefined && expectedVersion !== existing.version) throw conflict(`Integration was changed (now version ${existing.version}); reload before saving`);
  const issues = await validateIntegrationConfig(deps, cfg);
  assertNoErrors(issues);
  const next = { ...(cfg as unknown as IntegrationConfig), active: existing.active };
  const changed = changedTopLevel(configOf(existing) as never, next as never);
  if (changed.length === 0) return { integration: existing, warnings: issues };
  const r = await cols(deps).integrations.findOneAndUpdate(
    { _id: id as never, version: existing.version },
    { $set: { ...next, updatedAt: deps.now(), updatedBy: actor.email }, $inc: { version: 1 } },
    { returnDocument: 'after' },
  );
  if (!r) throw conflict('Integration was modified concurrently; reload and try again');
  const updated = r as unknown as Integration;
  await storeVersion(deps, updated, 'UPDATED', actor, changed);
  await audit(deps, { action: 'INTEGRATION_UPDATED', resourceType: 'integration', resourceId: id, actor, details: { version: updated.version, changed } });
  return { integration: updated, warnings: issues };
}

export async function setIntegrationActive(deps: AppDeps, id: string, active: boolean, actor: AuthUser) {
  const i = await getIntegration(deps, id);
  if (active) {
    const issues = await validateIntegrationConfig(deps, configOf(i) as never);
    assertNoErrors(issues);
    const conn = (await cols(deps).connections.findOne({ _id: i.destination.connectionId as never })) as unknown as Connection | null;
    if (!conn?.active) throw unprocessable('The destination connection must be tested and active before the integration can be activated');
  }
  if (i.active === active) return i;
  const r = await cols(deps).integrations.findOneAndUpdate({ _id: id as never }, { $set: { active, updatedAt: deps.now(), updatedBy: actor.email }, $inc: { version: 1 } }, { returnDocument: 'after' });
  const updated = r as unknown as Integration;
  await storeVersion(deps, updated, active ? 'ACTIVATED' : 'DEACTIVATED', actor, ['active']);
  await audit(deps, { action: active ? 'INTEGRATION_ACTIVATED' : 'INTEGRATION_DEACTIVATED', resourceType: 'integration', resourceId: id, actor });
  return updated;
}

export async function cloneIntegration(deps: AppDeps, id: string, name: string, actor: AuthUser) {
  const src = await getIntegration(deps, id);
  const cfg = { ...configOf(src), name, active: false } as unknown as IntegrationConfigInput;
  const out = await createIntegration(deps, cfg, actor, 'CLONED');
  await audit(deps, { action: 'INTEGRATION_CLONED', resourceType: 'integration', resourceId: out.integration._id, actor, details: { clonedFrom: id, sourceVersion: src.version } });
  return out;
}
