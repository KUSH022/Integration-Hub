/** Transform catalogue exposed to the UI. Must stay in sync with core/transform.ts (covered by tests). */
export const TRANSFORM_TYPES = [
  { type: 'trim', label: 'Trim whitespace', params: [] },
  { type: 'case', label: 'Case conversion', params: [{ name: 'mode', kind: 'enum', options: ['upper', 'lower', 'title'] }] },
  { type: 'booleanToStatus', label: 'Boolean to status', params: [{ name: 'trueValue', kind: 'string', default: 'Active' }, { name: 'falseValue', kind: 'string', default: 'Inactive' }] },
  { type: 'toBoolean', label: 'Convert to boolean', params: [] },
  { type: 'toNumber', label: 'Convert to number', params: [{ name: 'integer', kind: 'boolean' }, { name: 'decimals', kind: 'number' }] },
  { type: 'toString', label: 'Convert to string', params: [] },
  { type: 'formatDate', label: 'Format date', params: [{ name: 'inputFormat', kind: 'enum', options: ['AUTO', 'ISO', 'YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'EPOCH_MS'] }, { name: 'outputFormat', kind: 'enum', options: ['YYYY-MM-DD', 'ISO_DATETIME', 'MM/DD/YYYY', 'DD/MM/YYYY', 'EPOCH_MS'] }] },
  { type: 'default', label: 'Default value', params: [{ name: 'value', kind: 'primitive' }, { name: 'when', kind: 'enum', options: ['missing', 'missingOrNull', 'missingNullOrEmpty'] }] },
  { type: 'nullHandling', label: 'Null handling', params: [{ name: 'mode', kind: 'enum', options: ['keepNull', 'omit', 'emptyString', 'error'] }] },
  { type: 'required', label: 'Required', params: [] },
  { type: 'allowedValues', label: 'Allowed values', params: [{ name: 'values', kind: 'list' }, { name: 'caseInsensitive', kind: 'boolean' }] },
  { type: 'mapValue', label: 'Value lookup', params: [{ name: 'map', kind: 'map' }, { name: 'fallback', kind: 'enum', options: ['keep', 'null', 'error'] }] },
] as const;
