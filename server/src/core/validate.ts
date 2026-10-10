import { getPath, isValidPath } from './paths.js';
import { parseDate, type DateFormat, type FieldError } from './transform.js';

export type DataType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'date';

export interface ValidationRule {
  field: string;
  required?: boolean;
  type?: DataType;
  minLength?: number;
  maxLength?: number;
  allowedValues?: Array<string | number | boolean>;
  min?: number;
  max?: number;
  dateFormat?: DateFormat;
}

export interface DuplicateCheck {
  /** Field in the transformed payload that reliably identifies a record. */
  keyField: string;
  scope: 'BATCH' | 'BATCH_AND_HISTORY';
}

const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

export function validateRuleDefinitions(rules: ValidationRule[]): FieldError[] {
  const errors: FieldError[] = [];
  rules.forEach((r, i) => {
    if (!isValidPath(r.field)) errors.push({ field: r.field || `rules[${i}]`, code: 'INVALID_RULE', message: `Validation rule ${i + 1}: invalid field path` });
    if (r.minLength !== undefined && r.maxLength !== undefined && r.minLength > r.maxLength)
      errors.push({ field: r.field, code: 'INVALID_RULE', message: 'minLength cannot be greater than maxLength' });
    if (r.min !== undefined && r.max !== undefined && r.min > r.max)
      errors.push({ field: r.field, code: 'INVALID_RULE', message: 'min cannot be greater than max' });
    if (r.type === 'date' && !r.dateFormat) errors.push({ field: r.field, code: 'INVALID_RULE', message: 'A date rule requires a date format' });
  });
  return errors;
}

function typeOk(v: unknown, t: DataType): boolean {
  switch (t) {
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'integer': return typeof v === 'number' && Number.isInteger(v);
    case 'boolean': return typeof v === 'boolean';
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'array': return Array.isArray(v);
    case 'date': return typeof v === 'string' || typeof v === 'number';
  }
}

export function validatePayload(payload: unknown, rules: ValidationRule[]): FieldError[] {
  const errors: FieldError[] = [];
  for (const r of rules) {
    let value: unknown;
    try {
      value = getPath(payload, r.field).value;
    } catch (e) {
      errors.push({ field: r.field, code: 'INVALID_RULE', message: (e as Error).message });
      continue;
    }
    if (isEmpty(value)) {
      if (r.required) errors.push({ field: r.field, code: 'REQUIRED', message: 'Field is required' });
      continue;
    }
    if (r.type && !typeOk(value, r.type)) {
      errors.push({ field: r.field, code: 'TYPE', message: `Expected ${r.type} but received ${Array.isArray(value) ? 'array' : typeof value}` });
      continue;
    }
    if (typeof value === 'string') {
      if (r.minLength !== undefined && value.length < r.minLength)
        errors.push({ field: r.field, code: 'MIN_LENGTH', message: `Must be at least ${r.minLength} characters (has ${value.length})` });
      if (r.maxLength !== undefined && value.length > r.maxLength)
        errors.push({ field: r.field, code: 'MAX_LENGTH', message: `Must be at most ${r.maxLength} characters (has ${value.length})` });
    }
    if (typeof value === 'number') {
      if (r.min !== undefined && value < r.min) errors.push({ field: r.field, code: 'MIN', message: `Must be >= ${r.min}` });
      if (r.max !== undefined && value > r.max) errors.push({ field: r.field, code: 'MAX', message: `Must be <= ${r.max}` });
    }
    if (r.allowedValues && r.allowedValues.length > 0 && !r.allowedValues.some((a) => a === value)) {
      errors.push({ field: r.field, code: 'NOT_ALLOWED', message: `Value "${String(value)}" is not allowed. Allowed: ${r.allowedValues.join(', ')}` });
    }
    if (r.dateFormat) {
      try {
        parseDate(value, r.dateFormat);
      } catch (e) {
        errors.push({ field: r.field, code: 'DATE_FORMAT', message: (e as Error).message });
      }
    }
  }
  return errors;
}

/** Returns the indexes of records that duplicate an earlier record within the same batch. */
export function findBatchDuplicates(payloads: unknown[], keyField: string): Map<number, string> {
  const seen = new Map<string, number>();
  const dups = new Map<number, string>();
  payloads.forEach((p, i) => {
    const { value } = getPath(p, keyField);
    if (isEmpty(value)) return;
    const key = JSON.stringify(value);
    if (seen.has(key)) dups.set(i, `Duplicate of record #${(seen.get(key) as number) + 1} for ${keyField}=${String(value)}`);
    else seen.set(key, i);
  });
  return dups;
}
