import type { AppDeps, AuthUser } from '../context.js';
import { newId } from '../core/crypto.js';
import { redactDeep } from '../core/redact.js';
import { retentionDate } from '../db/mongo.js';

export type AuditAction =
  | 'AUTH_LOGIN' | 'AUTH_LOGIN_FAILED' | 'AUTH_LOGOUT' | 'AUTH_PASSWORD_CHANGED'
  | 'USER_CREATED' | 'USER_UPDATED'
  | 'INTEGRATION_CREATED' | 'INTEGRATION_UPDATED' | 'INTEGRATION_ACTIVATED' | 'INTEGRATION_DEACTIVATED' | 'INTEGRATION_CLONED'
  | 'CONNECTION_CREATED' | 'CONNECTION_UPDATED' | 'CONNECTION_ACTIVATED' | 'CONNECTION_DEACTIVATED' | 'CONNECTION_TESTED'
  | 'CREDENTIAL_UPDATED' | 'CREDENTIAL_REMOVED'
  | 'SOURCE_SUBMITTED'
  | 'EXECUTION_REQUESTED' | 'EXECUTION_STARTED' | 'EXECUTION_COMPLETED' | 'EXECUTION_FAILED' | 'EXECUTION_CANCELLED' | 'EXECUTION_RECOVERED'
  | 'QA_TRIGGERED' | 'QA_COMPLETED';

export async function audit(
  deps: Pick<AppDeps, 'cols' | 'config'>,
  entry: { action: AuditAction; resourceType?: string; resourceId?: string; result?: 'SUCCESS' | 'FAILURE'; actor?: AuthUser | null | string; details?: Record<string, unknown> },
): Promise<void> {
  if (!deps.cols) return;
  const actor = typeof entry.actor === 'string' ? { id: entry.actor, email: entry.actor } : entry.actor ? { id: entry.actor.id, email: entry.actor.email, role: entry.actor.role } : { id: 'system', email: 'system' };
  try {
    await deps.cols.auditLogs.insertOne({
      _id: newId('aud') as unknown as never,
      timestamp: new Date(),
      action: entry.action,
      resourceType: entry.resourceType ?? '',
      resourceId: entry.resourceId ?? '',
      result: entry.result ?? 'SUCCESS',
      actor,
      details: entry.details ? redactDeep(entry.details) : {},
      retainUntil: retentionDate(deps.config.AUDIT_RETENTION_DAYS),
    });
  } catch (e) {
    // Audit failures must never break the main flow, but they are reported.
    console.error(JSON.stringify({ level: 'error', message: 'audit write failed', action: entry.action, error: (e as Error).message }));
  }
}
