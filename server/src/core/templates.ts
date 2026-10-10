/**
 * Reusable starting configurations. WFM-specific templates match the included WFM API contract.
 * The generic template remains destination-agnostic and must be configured from its API contract.
 */
import type { IntegrationConfig } from './domain.js';
import { DEFAULT_RETRY_STATUSES } from './retry.js';

export interface IntegrationTemplate {
  key: string;
  name: string;
  entityType: string;
  summary: string;
  guidance: string[];
  sampleSource: Record<string, unknown>;
  config: Omit<IntegrationConfig, 'destination'> & { destination: Omit<IntegrationConfig['destination'], 'connectionId' | 'endpointPath'> & { connectionId: ''; endpointPath: string } };
}

const baseDestination = {
  connectionId: '' as const,
  endpointPath: '' as const,
  method: 'POST' as const,
  headers: {},
  timeoutMs: 15000,
  successStatuses: [200, 201],
  idempotency: { supported: false },
  destinationIdFrom: null,
  readback: { enabled: false },
};

const baseExecution = { retry: { retryCount: 2, retryDelayMs: 2000, backoff: 'EXPONENTIAL' as const, retryOnStatus: DEFAULT_RETRY_STATUSES }, batchSize: 100 };

export const TEMPLATES: IntegrationTemplate[] = [
  {
    key: 'location-inbound',
    name: 'Location inbound integration',
    entityType: 'LOCATION',
    summary: 'Sends one location per request to the included WFM locations inbound API and makes it available for local QA Agent verification.',
    guidance: [
      'Select the WFM connection. The included WFM application accepts location batches at POST /api/integrations/inbound/locations; this Hub sends a one-item records array for each source record.',
      'WFM requires code, name, and costCenter. The code is the WFM business key and is used to create or update the same location safely.',
      'The Hub sends to the inbound API, which requires an Administrator token. The QA Agent reads from GET /api/integrations/outbound/locations?code=<code>, which accepts a Manager or Administrator token.',
      'Enable manual QA verification, and create an enabled local QA Agent profile with this Hub integration ID and a WFM profile that filters by code.',
    ],
    sampleSource: { code: 'KP101', name: 'KP Downtown Store', costCenter: 'CC-101', region: 'North Region', address: '1 Main Street', city: 'Milwaukee, WI', status: 'Active' },
    config: {
      name: 'Location inbound',
      description: 'Location master data to KP WFM',
      businessPurpose: 'Keep KP WFM store locations aligned with the source of record.',
      entityType: 'LOCATION',
      direction: 'INBOUND_TO_DESTINATION',
      active: false,
      source: { type: 'MANUAL_JSON', recordIdField: 'code', sample: { code: 'KP101', name: 'KP Downtown Store', costCenter: 'CC-101', region: 'North Region', address: '1 Main Street', city: 'Milwaukee, WI', status: 'Active' } },
      destination: { ...baseDestination, endpointPath: '/api/integrations/inbound/locations', successStatuses: [200], destinationIdFrom: { source: 'PAYLOAD', path: 'records.0.code' } },
      mappings: [
        { sourcePath: 'code', targetPath: 'records.0.code', transforms: [{ type: 'TRIM' }, { type: 'CASE', mode: 'UPPER' }], required: true },
        { sourcePath: 'name', targetPath: 'records.0.name', transforms: [{ type: 'TRIM' }], required: true },
        { sourcePath: 'costCenter', targetPath: 'records.0.costCenter', transforms: [{ type: 'TRIM' }], required: true },
        { sourcePath: 'region', targetPath: 'records.0.region', transforms: [{ type: 'TRIM' }] },
        { sourcePath: 'address', targetPath: 'records.0.address', transforms: [{ type: 'TRIM' }] },
        { sourcePath: 'city', targetPath: 'records.0.city', transforms: [{ type: 'TRIM' }] },
        { sourcePath: 'phone', targetPath: 'records.0.phone', transforms: [{ type: 'TRIM' }] },
        { sourcePath: 'status', targetPath: 'records.0.status', defaultValue: 'Active', nullHandling: 'DEFAULT' },
        { sourcePath: 'weeklyLaborBudget', targetPath: 'records.0.weeklyLaborBudget', transforms: [{ type: 'TO_NUMBER', decimals: 2 }] },
        { sourcePath: 'operatingHours', targetPath: 'records.0.operatingHours' },
      ],
      validationRules: [
        { field: 'records.0.code', required: true, type: 'string', minLength: 2, maxLength: 20 },
        { field: 'records.0.name', required: true, type: 'string', maxLength: 100 },
        { field: 'records.0.costCenter', required: true, type: 'string', maxLength: 50 },
        { field: 'records.0.status', allowedValues: ['Active', 'Inactive'] },
      ],
      duplicateCheck: { keyField: 'records.0.code', scope: 'BATCH' },
      execution: baseExecution,
      qa: { enabled: false, comparisonRules: { fields: ['code', 'name', 'costCenter', 'region', 'address', 'city', 'phone', 'status', 'weeklyLaborBudget', 'operatingHours'], mode: 'EXACT' } },
    },
  },
  {
    key: 'employee-inbound',
    name: 'Employee inbound integration',
    entityType: 'EMPLOYEE',
    summary: 'Sends one employee per request to the included WFM employees inbound API and makes it available for local QA Agent verification.',
    guidance: [
      'Select the WFM connection. The included WFM application accepts employee batches at POST /api/integrations/inbound/employees; this Hub sends a one-item records array for each source record.',
      'WFM requires employeeId, firstName, lastName, email, locationCode, department, jobTitle, and hourlyRate. Referenced location, department, job title, and manager must already exist in WFM.',
      'The Hub write endpoint requires an Administrator token. The QA Agent reads one employee using GET /api/integrations/outbound/employees?employeeId=<employeeId>, which requires a Manager or Administrator token.',
      'Enable manual QA verification and create an enabled local QA Agent profile with the exact Hub integration ID and an employeeId-filtered WFM read profile.',
    ],
    sampleSource: { employeeId: 'E1001', firstName: ' Priya ', lastName: 'Shah', email: 'PRIYA.SHAH@example.com', phone: '(555) 410-1001', locationCode: 'DTN', department: 'Retail Sales', jobTitle: 'Sales Associate', hireDate: '2026-09-01', hourlyRate: '18.50', employmentType: 'Full-Time', employmentStatus: 'Active', active: true, managerEmployeeId: 'KP1001', skills: ['Sales'] },
    config: {
      name: 'Employee inbound',
      description: 'Employee master data to KP WFM',
      businessPurpose: 'Create and update employees in KP WFM from the HR source of record.',
      entityType: 'EMPLOYEE',
      direction: 'INBOUND_TO_DESTINATION',
      active: false,
      source: { type: 'MANUAL_JSON', recordIdField: 'employeeId', sample: { employeeId: 'E1001', firstName: ' Priya ', lastName: 'Shah', email: 'PRIYA.SHAH@example.com', phone: '(555) 410-1001', locationCode: 'DTN', department: 'Retail Sales', jobTitle: 'Sales Associate', hireDate: '2026-09-01', hourlyRate: '18.50', employmentType: 'Full-Time', employmentStatus: 'Active', active: true, managerEmployeeId: 'KP1001', skills: ['Sales'] } },
      destination: { ...baseDestination, endpointPath: '/api/integrations/inbound/employees', successStatuses: [200], destinationIdFrom: { source: 'PAYLOAD', path: 'records.0.employeeId' } },
      mappings: [
        { sourcePath: 'employeeId', targetPath: 'records.0.employeeId', transforms: [{ type: 'TRIM' }, { type: 'CASE', mode: 'UPPER' }], required: true },
        { sourcePath: 'firstName', targetPath: 'records.0.firstName', transforms: [{ type: 'TRIM' }], required: true },
        { sourcePath: 'lastName', targetPath: 'records.0.lastName', transforms: [{ type: 'TRIM' }], required: true },
        { sourcePath: 'email', targetPath: 'records.0.email', transforms: [{ type: 'TRIM' }, { type: 'CASE', mode: 'LOWER' }], required: true },
        { sourcePath: 'phone', targetPath: 'records.0.phone', transforms: [{ type: 'TRIM' }] },
        { sourcePath: 'locationCode', targetPath: 'records.0.locationCode', transforms: [{ type: 'TRIM' }, { type: 'CASE', mode: 'UPPER' }], required: true },
        { sourcePath: 'department', targetPath: 'records.0.department', transforms: [{ type: 'TRIM' }], required: true },
        { sourcePath: 'jobTitle', targetPath: 'records.0.jobTitle', transforms: [{ type: 'TRIM' }], required: true },
        { sourcePath: 'hireDate', targetPath: 'records.0.hireDate' },
        { sourcePath: 'hourlyRate', targetPath: 'records.0.hourlyRate', transforms: [{ type: 'TO_NUMBER', decimals: 2 }], required: true },
        { sourcePath: 'employmentType', targetPath: 'records.0.employmentType' },
        { sourcePath: 'employmentStatus', targetPath: 'records.0.employmentStatus', defaultValue: 'Active', nullHandling: 'DEFAULT' },
        { sourcePath: 'active', targetPath: 'records.0.status', transforms: [{ type: 'BOOLEAN_TO_STATUS', trueValue: 'Active', falseValue: 'Inactive' }], defaultValue: true },
        { sourcePath: 'managerEmployeeId', targetPath: 'records.0.managerEmployeeId', transforms: [{ type: 'TRIM' }, { type: 'CASE', mode: 'UPPER' }] },
        { sourcePath: 'skills', targetPath: 'records.0.skills' },
      ],
      validationRules: [
        { field: 'records.0.employeeId', required: true, type: 'string', minLength: 2, maxLength: 30 },
        { field: 'records.0.firstName', required: true, type: 'string', maxLength: 60 },
        { field: 'records.0.lastName', required: true, type: 'string', maxLength: 60 },
        { field: 'records.0.email', required: true, type: 'string', maxLength: 120 },
        { field: 'records.0.locationCode', required: true },
        { field: 'records.0.department', required: true },
        { field: 'records.0.jobTitle', required: true },
        { field: 'records.0.hireDate', type: 'date', dateFormat: 'YYYY-MM-DD' },
        { field: 'records.0.hourlyRate', required: true, type: 'number', min: 0, max: 500 },
        { field: 'records.0.employmentType', allowedValues: ['Full-Time', 'Part-Time', 'Weekend-Only'] },
        { field: 'records.0.employmentStatus', allowedValues: ['Active', 'On Leave', 'Terminated'] },
        { field: 'records.0.status', allowedValues: ['Active', 'Inactive'] },
      ],
      duplicateCheck: { keyField: 'records.0.employeeId', scope: 'BATCH' },
      execution: baseExecution,
      qa: { enabled: false, comparisonRules: { fields: ['employeeId', 'firstName', 'lastName', 'email', 'phone', 'locationCode', 'department', 'jobTitle', 'hireDate', 'hourlyRate', 'employmentType', 'employmentStatus', 'status', 'managerEmployeeId', 'skills'], mode: 'EXACT' } },
    },
  },
  {
    key: 'generic-rest',
    name: 'Generic REST API integration',
    entityType: 'GENERIC',
    summary: 'A blank starting point for sending JSON records to any configured REST API.',
    guidance: [
      'Create a connection for the target REST system first and test it.',
      'Set the endpoint, HTTP method, success codes, authentication, and field mappings to match the target API contract. This generic template does not assume WFM field names or request wrappers.',
      'The sample sends one JSON object containing id and value. If the API requires a wrapper such as { records: [...] }, configure mappings to create that shape.',
      'QA is disabled by default. To use the local QA Agent, enable manual QA, set a reliable record ID, and create an enabled profile that calls a target read endpoint filtered to that same ID.',
      'Use PUT for idempotent upserts where supported. Configure retries and an idempotency key according to the target API contract.',
    ],
    sampleSource: { id: 'R-1', value: 'example' },
    config: {
      name: 'Generic REST integration',
      description: '',
      businessPurpose: '',
      entityType: 'GENERIC',
      direction: 'INBOUND_TO_DESTINATION',
      active: false,
      source: { type: 'JSON_PAYLOAD', recordIdField: 'id', sample: { id: 'R-1', value: 'example' } },
      destination: { ...baseDestination, destinationIdFrom: { source: 'PAYLOAD', path: 'id' } },
      mappings: [
        { sourcePath: 'id', targetPath: 'id', required: true },
        { sourcePath: 'value', targetPath: 'value' },
      ],
      validationRules: [{ field: 'id', required: true }],
      duplicateCheck: null,
      execution: baseExecution,
      qa: { enabled: false, comparisonRules: { fields: ['id', 'value'], mode: 'EXACT' } },
    },
  },
];
