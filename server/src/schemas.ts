/**
 * Zod request/config schemas. These are the single source of truth for request validation and the
 * generated OpenAPI document.
 */
import { z } from 'zod';
import { isValidPath } from './core/paths.js';
import { isSensitiveHeader } from './core/redact.js';
import { TRANSFER_STATUSES, QA_STATUSES } from './core/domain.js';

const path = z.string().min(1).max(200).refine(isValidPath, 'Invalid field path (use dot notation, letters, digits, _ - $)');
const endpointPath = z
  .string()
  .max(500)
  .refine((p) => p === '' || (p.startsWith('/') && !p.startsWith('//') && !/(^|\/)\.\.(\/|$)/.test(p) && !/\s/.test(p)), 'Endpoint path must start with "/" and must not contain "..", "//" prefix or whitespace');
const headerName = z.string().min(1).max(100).regex(/^[A-Za-z0-9-]+$/, 'Invalid header name');
const safeHeaders = z
  .record(headerName, z.string().max(1000))
  .default({})
  .refine((h) => Object.keys(h).every((k) => !isSensitiveHeader(k)), 'Credential headers (Authorization, Cookie, API keys) must not be placed in plain headers; use the connection credential store')
  .refine((h) => Object.keys(h).length <= 30, 'Too many headers');
const statusCodes = z.array(z.number().int().min(100).max(599)).min(1).max(20);
const httpUrl = z
  .string()
  .max(500)
  .refine((u) => {
    try {
      const p = new URL(u);
      return (p.protocol === 'https:' || p.protocol === 'http:') && !p.username && !p.password && !p.search && !p.hash;
    } catch {
      return false;
    }
  }, 'Must be an absolute http(s) URL without credentials, query string or fragment');

export const DateFormatSchema = z.enum(['ISO', 'YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'EPOCH_MS']);
const scalar = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);

export const TransformStepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('TRIM') }),
  z.object({ type: z.literal('CASE'), mode: z.enum(['UPPER', 'LOWER', 'TITLE']) }),
  z.object({ type: z.literal('BOOLEAN_TO_STATUS'), trueValue: z.string().max(100), falseValue: z.string().max(100) }),
  z.object({ type: z.literal('DATE_FORMAT'), inputFormat: DateFormatSchema, outputFormat: DateFormatSchema }),
  z.object({ type: z.literal('TO_NUMBER'), decimals: z.number().int().min(0).max(10).optional() }),
  z.object({ type: z.literal('TO_STRING') }),
  z.object({ type: z.literal('TO_BOOLEAN') }),
  z.object({ type: z.literal('DEFAULT'), value: scalar }),
  z.object({ type: z.literal('ALLOWED_VALUES'), values: z.array(scalar).min(1).max(200) }),
  z.object({ type: z.literal('MAP_VALUES'), map: z.record(z.string().max(200), scalar), fallback: scalar.optional() }),
]);

export const MappingRuleSchema = z.object({
  id: z.string().max(60).optional(),
  sourcePath: z.union([path, z.literal('')]).optional(),
  targetPath: path,
  transforms: z.array(TransformStepSchema).max(10).default([]),
  required: z.boolean().default(false),
  defaultValue: scalar.optional(),
  nullHandling: z.enum(['KEEP', 'OMIT', 'DEFAULT', 'ERROR']).default('KEEP'),
});

export const ValidationRuleSchema = z.object({
  field: path,
  required: z.boolean().optional(),
  type: z.enum(['string', 'number', 'integer', 'boolean', 'object', 'array', 'date']).optional(),
  minLength: z.number().int().min(0).max(100000).optional(),
  maxLength: z.number().int().min(0).max(100000).optional(),
  allowedValues: z.array(z.union([z.string().max(500), z.number(), z.boolean()])).max(200).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  dateFormat: DateFormatSchema.optional(),
});

export const RetryPolicySchema = z.object({
  retryCount: z.number().int().min(0).max(5),
  retryDelayMs: z.number().int().min(0).max(60000),
  backoff: z.enum(['FIXED', 'EXPONENTIAL']),
  retryOnStatus: z.array(z.number().int().min(400).max(599)).max(20),
});

export const DestinationSchema = z.object({
  connectionId: z.string().max(80),
  endpointPath,
  method: z.enum(['POST', 'PUT', 'PATCH', 'DELETE']),
  headers: safeHeaders,
  timeoutMs: z.number().int().min(1000).max(120000),
  successStatuses: statusCodes,
  idempotency: z.object({ supported: z.boolean(), headerName: headerName.optional(), keyField: path.optional() }).default({ supported: false }),
  destinationIdFrom: z.object({ source: z.enum(['RESPONSE', 'PAYLOAD']), path }).nullable().default(null),
  readback: z.object({ enabled: z.boolean(), pathTemplate: endpointPath.optional(), responseRecordPath: path.optional(), compareFields: z.array(path).max(200).optional() }).nullable().default(null),
});

export const IntegrationConfigSchema = z.object({
  name: z.string().trim().min(3).max(100),
  description: z.string().max(1000).default(''),
  businessPurpose: z.string().max(1000).default(''),
  entityType: z.string().min(1).max(40),
  direction: z.literal('INBOUND_TO_DESTINATION').default('INBOUND_TO_DESTINATION'),
  active: z.boolean().default(false),
  source: z.object({
    type: z.enum(['MANUAL_JSON', 'JSON_PAYLOAD', 'JSON_FILE', 'CSV_FILE']),
    recordIdField: z.union([path, z.literal('')]).optional(),
    sample: z.record(z.string(), z.any()).nullable().optional(),
  }),
  destination: DestinationSchema,
  mappings: z.array(MappingRuleSchema).min(1).max(300),
  validationRules: z.array(ValidationRuleSchema).max(300).default([]),
  duplicateCheck: z.object({ keyField: path, scope: z.enum(['BATCH', 'BATCH_AND_HISTORY']) }).nullable().optional(),
  execution: z.object({ retry: RetryPolicySchema, batchSize: z.number().int().min(1).max(500) }),
  qa: z.object({
    enabled: z.boolean(),
    connectionId: z.string().max(80).optional(),
    verificationOperation: z.string().max(200).optional(),
    comparisonRules: z.object({ fields: z.array(path).max(200), mode: z.enum(['EXACT', 'CASE_INSENSITIVE']) }).default({ fields: [], mode: 'EXACT' }),
  }),
  templateKey: z.string().max(60).optional(),
});
export type IntegrationConfigInput = z.infer<typeof IntegrationConfigSchema>;

export const ApiOperationSchema = z.object({
  key: z.string().min(1).max(60).regex(/^[A-Za-z0-9_.-]+$/),
  label: z.string().min(1).max(120),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: endpointPath,
  purpose: z.enum(['CREATE', 'UPDATE', 'UPSERT', 'DELETE', 'READ', 'HEALTH', 'QA_TRIGGER', 'QA_STATUS']),
  entityType: z.string().max(40).optional(),
  contractReference: z.string().min(3).max(500),
  notes: z.string().max(1000).optional(),
});

export const QaContractSchema = z.object({
  triggerPath: endpointPath,
  triggerMethod: z.enum(['POST', 'PUT']),
  triggerSuccessStatuses: statusCodes.default([200, 201, 202]),
  requestTemplate: z.record(z.string(), z.any()),
  executionIdPath: path,
  initialStatusPath: path.optional(),
  statusPathTemplate: endpointPath,
  statusFieldPath: path,
  statusValues: z.object({
    passed: z.array(z.string().max(60)).max(20),
    failed: z.array(z.string().max(60)).max(20),
    running: z.array(z.string().max(60)).max(20),
    error: z.array(z.string().max(60)).max(20),
  }),
  differencesPath: path.optional(),
  errorMessagePath: path.optional(),
  pollIntervalSeconds: z.number().int().min(2).max(3600).default(10),
  maxPollMinutes: z.number().int().min(1).max(1440).default(30),
  contractReference: z.string().min(3).max(500),
});

export const ConnectionInputSchema = z.object({
  name: z.string().trim().min(3).max(100),
  application: z.enum(['KP_WFM', 'KP_QA_AGENT', 'REST_API']),
  description: z.string().max(1000).optional(),
  baseUrl: httpUrl,
  authType: z.enum(['NONE', 'BEARER', 'API_KEY']),
  apiKeyHeader: headerName.optional(),
  defaultHeaders: safeHeaders,
  timeoutMs: z.number().int().min(1000).max(120000).default(15000),
  healthCheck: z.object({ path: endpointPath.refine((p) => p.length > 0, 'Health-check path is required'), expectedStatuses: statusCodes.default([200]) }).nullable().optional(),
  apiDocsUrl: z.union([httpUrl, z.literal('')]).optional(),
  operations: z.array(ApiOperationSchema).max(100).default([]),
  qaContract: QaContractSchema.nullable().optional(),
});

export const SecretInputSchema = z.object({ secret: z.string().min(8).max(8192) });

export const SourceSubmitSchema = z.object({
  sourceType: z.enum(['MANUAL_JSON', 'JSON_PAYLOAD', 'JSON_FILE', 'CSV_FILE']),
  /** Raw text for JSON/CSV file uploads or pasted payloads. */
  content: z.string().max(5_000_000).optional(),
  /** Already-parsed JSON (object or array of objects). */
  records: z.union([z.record(z.string(), z.any()), z.array(z.record(z.string(), z.any()))]).optional(),
  fileName: z.string().max(200).optional(),
  integrationId: z.string().max(80).optional(),
  recordIdField: z.union([path, z.literal('')]).optional(),
});

export const ExecuteSchema = z.object({
  sourceRecordIds: z.array(z.string().max(80)).max(500).optional(),
  submissionId: z.string().max(80).optional(),
  records: z.array(z.record(z.string(), z.any())).max(500).optional(),
  acknowledgeInvalid: z.boolean().default(false),
});

export const RunsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  integrationId: z.string().max(80).optional(),
  entityType: z.string().max(40).optional(),
  transferStatus: z.enum(TRANSFER_STATUSES as [string, ...string[]]).optional(),
  qaStatus: z.enum(QA_STATUSES as [string, ...string[]]).optional(),
  correlationId: z.string().max(100).optional(),
  batchId: z.string().max(100).optional(),
  from: z.string().datetime({ offset: true }).optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  to: z.string().datetime({ offset: true }).optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
});

export const PreviewSchema = z.object({
  mappings: z.array(MappingRuleSchema).max(300),
  validationRules: z.array(ValidationRuleSchema).max(300).default([]),
  records: z.array(z.record(z.string(), z.any())).min(1).max(50),
});
