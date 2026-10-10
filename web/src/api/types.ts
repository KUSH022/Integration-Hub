export type Role = 'ADMIN' | 'OPERATOR' | 'VIEWER';
export interface User { id: string; email: string; name?: string; role: Role; active?: boolean }

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type DateFormat = 'ISO' | 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'EPOCH_MS';

export type TransformStep =
  | { type: 'TRIM' }
  | { type: 'CASE'; mode: 'UPPER' | 'LOWER' | 'TITLE' }
  | { type: 'BOOLEAN_TO_STATUS'; trueValue: string; falseValue: string }
  | { type: 'DATE_FORMAT'; inputFormat: DateFormat; outputFormat: DateFormat }
  | { type: 'TO_NUMBER'; decimals?: number }
  | { type: 'TO_STRING' }
  | { type: 'TO_BOOLEAN' }
  | { type: 'DEFAULT'; value: string | number | boolean | null }
  | { type: 'ALLOWED_VALUES'; values: Array<string | number | boolean | null> }
  | { type: 'MAP_VALUES'; map: Record<string, string | number | boolean | null>; fallback?: string | number | boolean | null };

export interface MappingRule {
  id?: string;
  sourcePath?: string;
  targetPath: string;
  transforms: TransformStep[];
  required: boolean;
  defaultValue?: string | number | boolean | null;
  nullHandling: 'KEEP' | 'OMIT' | 'DEFAULT' | 'ERROR';
}

export interface ValidationRule {
  field: string;
  required?: boolean;
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'date';
  minLength?: number;
  maxLength?: number;
  allowedValues?: Array<string | number | boolean>;
  min?: number;
  max?: number;
  dateFormat?: DateFormat;
}

export interface IntegrationConfig {
  name: string;
  description: string;
  businessPurpose: string;
  entityType: string;
  direction: 'INBOUND_TO_DESTINATION';
  active: boolean;
  source: { type: 'MANUAL_JSON' | 'JSON_PAYLOAD' | 'JSON_FILE' | 'CSV_FILE'; recordIdField?: string; sample?: Record<string, unknown> | null };
  destination: {
    connectionId: string;
    endpointPath: string;
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    headers: Record<string, string>;
    timeoutMs: number;
    successStatuses: number[];
    idempotency: { supported: boolean; headerName?: string; keyField?: string };
    destinationIdFrom: { source: 'RESPONSE' | 'PAYLOAD'; path: string } | null;
    readback: { enabled: boolean; pathTemplate?: string; responseRecordPath?: string; compareFields?: string[] } | null;
  };
  mappings: MappingRule[];
  validationRules: ValidationRule[];
  duplicateCheck?: { keyField: string; scope: 'BATCH' | 'BATCH_AND_HISTORY' } | null;
  execution: { retry: { retryCount: number; retryDelayMs: number; backoff: 'FIXED' | 'EXPONENTIAL'; retryOnStatus: number[] }; batchSize: number };
  qa: { enabled: boolean; connectionId?: string; verificationOperation?: string; comparisonRules: { fields: string[]; mode: 'EXACT' | 'CASE_INSENSITIVE' } };
  templateKey?: string;
}

export interface Integration extends IntegrationConfig {
  _id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
}

export interface ApiOperation { key: string; label: string; method: HttpMethod; path: string; purpose: string; entityType?: string; contractReference: string; notes?: string }

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

export interface Connection {
  _id: string;
  name: string;
  application: 'KP_WFM' | 'KP_QA_AGENT' | 'REST_API';
  description?: string;
  baseUrl: string;
  authType: 'NONE' | 'BEARER' | 'API_KEY';
  apiKeyHeader?: string;
  hasSecret: boolean;
  secretUpdatedAt?: string | null;
  defaultHeaders: Record<string, string>;
  timeoutMs: number;
  healthCheck?: { path: string; expectedStatuses: number[] } | null;
  apiDocsUrl?: string;
  operations: ApiOperation[];
  qaContract?: QaContract | null;
  qaContractMissing?: string[];
  active: boolean;
  lastTest?: { at: string; ok: boolean; httpStatus?: number; durationMs?: number; message: string; url: string } | null;
  version: number;
  updatedAt: string;
}

export interface FieldError { field: string; sourceField?: string; code: string; message: string; recordIndex?: number }

export interface RunSummary {
  _id: string;
  correlationId: string;
  batchId: string;
  integrationId: string;
  integrationName: string;
  entityType: string;
  destinationApplication: string;
  sourceRecordKey?: string | null;
  transferStatus: string;
  httpStatus?: number | null;
  qa: { status: string; qaExecutionId?: string };
  verification?: { status: string };
  retryCount: number;
  errorSummary?: string | null;
  createdAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
  stage?: string;
}

export interface Run extends RunSummary {
  integrationVersion: number;
  sourceRecordId: string;
  sourceSnapshot: Record<string, unknown>;
  sourceSnapshotHash: string;
  attempts: Array<{ attempt: number; startedAt: string; endedAt: string; httpStatus?: number; errorKind?: string; message?: string; durationMs: number; retryDecision: string }>;
  requestSnapshot?: { method: string; url: string; headers: Record<string, string>; body: unknown; hash: string; createdAt: string } | null;
  response?: { httpStatus: number; headers: Record<string, string>; body: unknown; truncated: boolean; durationMs: number } | null;
  transformationErrors: FieldError[];
  validationErrors: FieldError[];
  destinationRecordId?: string | null;
  verification: { status: string; message: string; checkedAt?: string; url?: string; httpStatus?: number; differences?: Array<{ field: string; expected: unknown; actual: unknown }> };
  qa: { status: string; message?: string; qaExecutionId?: string; rawStatus?: string; triggeredAt?: string; lastPolledAt?: string; completedAt?: string; pollCount?: number; differences?: unknown[]; errorDetails?: unknown; lastResponse?: unknown };
}

export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }

export interface PreviewResult {
  results: Array<{ index: number; output: Record<string, unknown>; transformationErrors: FieldError[]; validationErrors: FieldError[]; valid: boolean }>;
  validCount: number;
  invalidCount: number;
}

export interface Template { key: string; name: string; entityType: string; summary: string; guidance: string[]; sampleSource: Record<string, unknown>; config: IntegrationConfig }

export interface Meta {
  entities: Array<{ key: string; label: string; operational: boolean; recordIdField?: string; description: string }>;
  transformTypes: string[];
  transferStatuses: string[];
  qaStatuses: string[];
  qaTemplateVariables: string[];
  security: { requireHttpsDestinations: boolean; allowPrivateDestinations: boolean; allowedPorts: number[] | null; expectedPayloadRefsEnabled: boolean };
}

export interface ConfigIssue { field: string; message: string; severity: 'error' | 'warning' }
