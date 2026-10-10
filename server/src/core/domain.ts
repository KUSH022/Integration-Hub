import type { EncryptedSecret } from './crypto.js';
import type { HttpMethod } from './httpClient.js';
import type { RetryPolicy } from './retry.js';
import type { FieldError, MappingRule } from './transform.js';
import type { DuplicateCheck, ValidationRule } from './validate.js';

export type Role = 'ADMIN' | 'OPERATOR' | 'VIEWER';
export const ROLES: Role[] = ['ADMIN', 'OPERATOR', 'VIEWER'];

export type TransferStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'RETRYING' | 'TIMEOUT' | 'CANCELLED';
export const TRANSFER_STATUSES: TransferStatus[] = ['PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'RETRYING', 'TIMEOUT', 'CANCELLED'];
export const TERMINAL_TRANSFER: TransferStatus[] = ['SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED'];

export type QaStatus = 'NOT_REQUESTED' | 'NOT_STARTED' | 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'ERROR';
export const QA_STATUSES: QaStatus[] = ['NOT_REQUESTED', 'NOT_STARTED', 'PENDING', 'RUNNING', 'PASSED', 'FAILED', 'ERROR'];

export type VerificationStatus = 'NOT_CONFIGURED' | 'NOT_APPLICABLE' | 'VERIFIED' | 'MISMATCH' | 'ERROR';

export type Application = 'KP_WFM' | 'KP_QA_AGENT' | 'REST_API';
export type AuthType = 'NONE' | 'BEARER' | 'API_KEY';

export interface ApiOperation {
  key: string;
  label: string;
  method: HttpMethod;
  path: string;
  purpose: 'CREATE' | 'UPDATE' | 'UPSERT' | 'DELETE' | 'READ' | 'HEALTH' | 'QA_TRIGGER' | 'QA_STATUS';
  entityType?: string;
  /** Where this operation was confirmed (API docs URL, source file, contract version). */
  contractReference: string;
  notes?: string;
}

export interface QaContract {
  triggerPath: string;
  triggerMethod: 'POST' | 'PUT';
  triggerSuccessStatuses: number[];
  requestTemplate: Record<string, unknown>;
  executionIdPath: string;
  initialStatusPath?: string;
  statusPathTemplate: string;
  statusFieldPath: string;
  statusValues: { passed: string[]; failed: string[]; running: string[]; error: string[] };
  differencesPath?: string;
  errorMessagePath?: string;
  pollIntervalSeconds: number;
  maxPollMinutes: number;
  contractReference: string;
}

export interface ConnectionTestResult {
  at: Date;
  ok: boolean;
  httpStatus?: number;
  durationMs?: number;
  message: string;
  url: string;
}

export interface Connection {
  _id: string;
  name: string;
  application: Application;
  description?: string;
  baseUrl: string;
  authType: AuthType;
  apiKeyHeader?: string;
  secret?: EncryptedSecret | null;
  secretUpdatedAt?: Date | null;
  defaultHeaders: Record<string, string>;
  timeoutMs: number;
  healthCheck?: { path: string; expectedStatuses: number[] } | null;
  apiDocsUrl?: string;
  operations: ApiOperation[];
  qaContract?: QaContract | null;
  active: boolean;
  lastTest?: ConnectionTestResult | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  updatedBy?: string;
}

export type SourceType = 'MANUAL_JSON' | 'JSON_PAYLOAD' | 'JSON_FILE' | 'CSV_FILE';

export interface DestinationConfig {
  connectionId: string;
  endpointPath: string;
  method: Exclude<HttpMethod, 'GET'>;
  headers: Record<string, string>;
  timeoutMs: number;
  successStatuses: number[];
  idempotency: { supported: boolean; headerName?: string; keyField?: string };
  destinationIdFrom: { source: 'RESPONSE' | 'PAYLOAD'; path: string } | null;
  readback: { enabled: boolean; pathTemplate?: string; responseRecordPath?: string; compareFields?: string[] } | null;
}

export interface QaConfig {
  enabled: boolean;
  connectionId?: string;
  verificationOperation?: string;
  comparisonRules: { fields: string[]; mode: 'EXACT' | 'CASE_INSENSITIVE' };
}

export interface IntegrationConfig {
  name: string;
  description: string;
  businessPurpose: string;
  entityType: string;
  direction: 'INBOUND_TO_DESTINATION';
  active: boolean;
  source: { type: SourceType; recordIdField?: string; sample?: Record<string, unknown> | null };
  destination: DestinationConfig;
  mappings: MappingRule[];
  validationRules: ValidationRule[];
  duplicateCheck?: DuplicateCheck | null;
  execution: { retry: RetryPolicy; batchSize: number };
  qa: QaConfig;
}

export interface Integration extends IntegrationConfig {
  _id: string;
  version: number;
  templateKey?: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  updatedBy?: string;
}

export interface AttemptRecord {
  attempt: number;
  startedAt: Date;
  endedAt: Date;
  httpStatus?: number;
  errorKind?: string;
  message?: string;
  durationMs: number;
  retryDecision: string;
}

export interface RequestSnapshot {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  hash: string;
  createdAt: Date;
}

export interface ResponseSnapshot {
  httpStatus: number;
  headers: Record<string, string>;
  body: unknown;
  truncated: boolean;
  durationMs: number;
}

export interface VerificationResult {
  status: VerificationStatus;
  message: string;
  checkedAt?: Date;
  url?: string;
  httpStatus?: number;
  differences?: Array<{ field: string; expected: unknown; actual: unknown }>;
}

export interface QaState {
  status: QaStatus;
  message?: string;
  connectionId?: string;
  qaExecutionId?: string;
  rawStatus?: string;
  triggeredAt?: Date;
  lastPolledAt?: Date;
  nextPollAt?: Date;
  deadlineAt?: Date;
  pollCount?: number;
  completedAt?: Date;
  differences?: unknown[];
  errorDetails?: unknown;
  lastResponse?: unknown;
}

export interface IntegrationRun {
  _id: string; // execution ID
  correlationId: string;
  batchId: string;
  integrationId: string;
  integrationName: string;
  integrationVersion: number;
  entityType: string;
  destinationApplication: string;
  destinationConnectionId: string;
  sourceRecordId: string;
  sourceRecordKey?: string | null;
  sourceSnapshot: Record<string, unknown>;
  sourceSnapshotHash: string;
  transferStatus: TransferStatus;
  stage?: string;
  attempts: AttemptRecord[];
  retryCount: number;
  requestSnapshot?: RequestSnapshot | null;
  response?: ResponseSnapshot | null;
  httpStatus?: number | null;
  transformationErrors: FieldError[];
  validationErrors: FieldError[];
  errorSummary?: string | null;
  destinationRecordId?: string | null;
  verification: VerificationResult;
  qa: QaState;
  lease?: { owner: string; until: Date } | null;
  createdAt: Date;
  startedAt?: Date | null;
  endedAt?: Date | null;
  updatedAt: Date;
  createdBy?: string;
  retainUntil?: Date | null;
}

/** Entity registry. Only entities with implemented mapping/validation/testing support are operational. */
export interface EntityDefinition {
  key: string;
  label: string;
  operational: boolean;
  recordIdField?: string;
  description: string;
}

export const ENTITIES: EntityDefinition[] = [
  { key: 'LOCATION', label: 'Locations', operational: true, recordIdField: 'locationCode', description: 'Store / site master data.' },
  { key: 'EMPLOYEE', label: 'Employees', operational: true, recordIdField: 'employeeId', description: 'Employee master data.' },
  { key: 'GENERIC', label: 'Generic REST record', operational: true, description: 'Any JSON record sent to a configured REST endpoint.' },
  ...[
    ['DEPARTMENT', 'Departments'], ['JOB_ROLE', 'Jobs and roles'], ['SCHEDULE_SHIFT', 'Schedules and shifts'], ['TIMECARD', 'Timecards'],
    ['TIME_OFF', 'Time off'], ['FORECAST', 'Forecasts'], ['BUDGET', 'Budgets'], ['AVAILABILITY', 'Employee availability'],
    ['SKILL_CERT', 'Skills and certifications'], ['PAY_CODE', 'Pay codes'],
  ].map(([key, label]) => ({ key, label, operational: false, description: 'Planned. Not available until mapping, validation, destination operation and tests are implemented.' })),
];

export function isOperationalEntity(key: string) {
  return ENTITIES.some((e) => e.key === key && e.operational);
}
