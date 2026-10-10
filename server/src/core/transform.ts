/**
 * Safe transformation registry. Only the operations listed here can run.
 * No eval, no Function(), no user-provided code is ever executed.
 */
import { deepClone, getPath, setPath, isValidPath } from './paths.js';

export type DateFormat = 'ISO' | 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'EPOCH_MS';

export type TransformStep =
  | { type: 'TRIM' }
  | { type: 'CASE'; mode: 'UPPER' | 'LOWER' | 'TITLE' }
  | { type: 'BOOLEAN_TO_STATUS'; trueValue: string; falseValue: string }
  | { type: 'DATE_FORMAT'; inputFormat: DateFormat; outputFormat: DateFormat }
  | { type: 'TO_NUMBER'; decimals?: number }
  | { type: 'TO_STRING' }
  | { type: 'TO_BOOLEAN' }
  | { type: 'DEFAULT'; value: unknown }
  | { type: 'ALLOWED_VALUES'; values: unknown[] }
  | { type: 'MAP_VALUES'; map: Record<string, unknown>; fallback?: unknown };

export type NullHandling = 'KEEP' | 'OMIT' | 'DEFAULT' | 'ERROR';

export interface MappingRule {
  id?: string;
  /** Source path. Optional when a default/constant value is used. */
  sourcePath?: string;
  targetPath: string;
  transforms?: TransformStep[];
  required?: boolean;
  defaultValue?: unknown;
  nullHandling?: NullHandling;
}

export interface FieldError {
  field: string;
  sourceField?: string;
  code: string;
  message: string;
  recordIndex?: number;
}

export interface TransformResult {
  output: Record<string, unknown>;
  errors: FieldError[];
}

export const TRANSFORM_TYPES = [
  'TRIM', 'CASE', 'BOOLEAN_TO_STATUS', 'DATE_FORMAT', 'TO_NUMBER', 'TO_STRING', 'TO_BOOLEAN', 'DEFAULT', 'ALLOWED_VALUES', 'MAP_VALUES',
] as const;

class StepError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function pad(n: number, len = 2) {
  return String(n).padStart(len, '0');
}

export function parseDate(value: unknown, fmt: DateFormat): Date {
  if (fmt === 'EPOCH_MS') {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) throw new StepError('INVALID_DATE', `Value "${String(value)}" is not an epoch-millisecond number`);
    return new Date(n);
  }
  if (typeof value !== 'string') throw new StepError('INVALID_DATE', `Expected a date string in ${fmt} format`);
  const s = value.trim();
  let y: number, m: number, d: number;
  if (fmt === 'ISO') {
    if (!/^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(s)) throw new StepError('INVALID_DATE', `"${s}" is not an ISO-8601 date`);
    const dt = new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
    if (Number.isNaN(dt.getTime())) throw new StepError('INVALID_DATE', `"${s}" is not a valid date`);
    return dt;
  }
  let match: RegExpMatchArray | null;
  if (fmt === 'YYYY-MM-DD') {
    match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) throw new StepError('INVALID_DATE', `"${s}" does not match YYYY-MM-DD`);
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) throw new StepError('INVALID_DATE', `"${s}" does not match ${fmt}`);
    if (fmt === 'DD/MM/YYYY') [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    else [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new StepError('INVALID_DATE', `"${s}" is not a real calendar date`);
  }
  return dt;
}

export function formatDate(dt: Date, fmt: DateFormat): string | number {
  const y = dt.getUTCFullYear(), m = pad(dt.getUTCMonth() + 1), d = pad(dt.getUTCDate());
  switch (fmt) {
    case 'ISO': return dt.toISOString();
    case 'YYYY-MM-DD': return `${y}-${m}-${d}`;
    case 'DD/MM/YYYY': return `${d}/${m}/${y}`;
    case 'MM/DD/YYYY': return `${m}/${d}/${y}`;
    case 'EPOCH_MS': return dt.getTime();
  }
}

function applyStep(value: unknown, step: TransformStep): unknown {
  switch (step.type) {
    case 'TRIM':
      return typeof value === 'string' ? value.trim() : value;
    case 'CASE': {
      if (typeof value !== 'string') return value;
      if (step.mode === 'UPPER') return value.toUpperCase();
      if (step.mode === 'LOWER') return value.toLowerCase();
      return value.toLowerCase().replace(/(^|[\s\-_])([a-z])/g, (_m, sep: string, c: string) => sep + c.toUpperCase());
    }
    case 'BOOLEAN_TO_STATUS': {
      if (value === true || value === 'true') return step.trueValue;
      if (value === false || value === 'false') return step.falseValue;
      if (isEmpty(value)) return value;
      throw new StepError('INVALID_BOOLEAN', `Expected a boolean but received "${String(value)}"`);
    }
    case 'TO_BOOLEAN': {
      if (typeof value === 'boolean' || isEmpty(value)) return value;
      const s = String(value).trim().toLowerCase();
      if (['true', '1', 'yes', 'y'].includes(s)) return true;
      if (['false', '0', 'no', 'n'].includes(s)) return false;
      throw new StepError('INVALID_BOOLEAN', `Cannot convert "${String(value)}" to boolean`);
    }
    case 'DATE_FORMAT':
      if (isEmpty(value)) return value;
      return formatDate(parseDate(value, step.inputFormat), step.outputFormat);
    case 'TO_NUMBER': {
      if (isEmpty(value)) return value;
      if (typeof value === 'boolean') throw new StepError('INVALID_NUMBER', 'Boolean cannot be converted to number');
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      if (!Number.isFinite(n)) throw new StepError('INVALID_NUMBER', `"${String(value)}" is not a valid number`);
      if (step.decimals !== undefined) {
        const f = 10 ** step.decimals;
        return Math.round(n * f) / f;
      }
      return n;
    }
    case 'TO_STRING':
      if (value === undefined || value === null) return value;
      if (typeof value === 'object') throw new StepError('INVALID_STRING', 'Objects cannot be converted to string');
      return String(value);
    case 'DEFAULT':
      return isEmpty(value) ? step.value : value;
    case 'ALLOWED_VALUES':
      if (isEmpty(value)) return value;
      if (!step.values.some((a) => a === value)) {
        throw new StepError('NOT_ALLOWED', `Value "${String(value)}" is not one of: ${step.values.map(String).join(', ')}`);
      }
      return value;
    case 'MAP_VALUES': {
      if (isEmpty(value)) return value;
      const key = String(value);
      if (Object.prototype.hasOwnProperty.call(step.map, key)) return step.map[key];
      if (step.fallback !== undefined) return step.fallback;
      throw new StepError('UNMAPPED_VALUE', `No value mapping defined for "${key}"`);
    }
    default: {
      const t = (step as { type?: string }).type;
      throw new StepError('UNKNOWN_TRANSFORM', `Unsupported transform "${String(t)}"`);
    }
  }
}

/** Validates the structure of mapping rules (used before saving an integration). */
export function validateMappingRules(rules: MappingRule[]): FieldError[] {
  const errors: FieldError[] = [];
  const targets = new Set<string>();
  rules.forEach((r, i) => {
    const field = r.targetPath || `mappings[${i}]`;
    if (!r.targetPath || !isValidPath(r.targetPath)) errors.push({ field, code: 'INVALID_TARGET', message: `Mapping ${i + 1}: invalid destination field path` });
    if (r.sourcePath !== undefined && r.sourcePath !== '' && !isValidPath(r.sourcePath)) errors.push({ field, code: 'INVALID_SOURCE', message: `Mapping ${i + 1}: invalid source field path` });
    if ((r.sourcePath === undefined || r.sourcePath === '') && r.defaultValue === undefined) {
      errors.push({ field, code: 'NO_SOURCE', message: `Mapping ${i + 1}: provide a source field or a default value` });
    }
    if (targets.has(r.targetPath)) errors.push({ field, code: 'DUPLICATE_TARGET', message: `Destination field "${r.targetPath}" is mapped more than once` });
    targets.add(r.targetPath);
    for (const s of r.transforms ?? []) {
      if (!TRANSFORM_TYPES.includes(s.type as (typeof TRANSFORM_TYPES)[number])) {
        errors.push({ field, code: 'UNKNOWN_TRANSFORM', message: `Unsupported transform "${String(s.type)}"` });
      }
    }
  });
  return errors;
}

/**
 * Applies mapping rules to a source record. The source is cloned first and never mutated.
 */
export function applyMappings(source: unknown, rules: MappingRule[]): TransformResult {
  const input = deepClone(source);
  const output: Record<string, unknown> = {};
  const errors: FieldError[] = [];
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { output, errors: [{ field: '(record)', code: 'INVALID_RECORD', message: 'Source record must be a JSON object' }] };
  }
  for (const rule of rules) {
    const field = rule.targetPath;
    let value: unknown = undefined;
    if (rule.sourcePath) {
      try {
        value = getPath(input, rule.sourcePath).value;
      } catch (e) {
        errors.push({ field, sourceField: rule.sourcePath, code: 'INVALID_SOURCE', message: (e as Error).message });
        continue;
      }
    }
    // Null handling happens before transforms.
    const handling = rule.nullHandling ?? 'KEEP';
    if (value === null || value === undefined) {
      if (rule.defaultValue !== undefined && (handling === 'DEFAULT' || !rule.sourcePath || value === undefined)) {
        value = deepClone(rule.defaultValue);
      } else if (value === null && handling === 'ERROR') {
        errors.push({ field, sourceField: rule.sourcePath, code: 'NULL_VALUE', message: `Source field "${rule.sourcePath}" is null` });
        continue;
      }
    }
    try {
      for (const step of rule.transforms ?? []) value = applyStep(value, step);
    } catch (e) {
      const se = e as StepError;
      errors.push({ field, sourceField: rule.sourcePath, code: se.code ?? 'TRANSFORM_ERROR', message: se.message });
      continue;
    }
    if (rule.required && isEmpty(value)) {
      errors.push({ field, sourceField: rule.sourcePath, code: 'REQUIRED', message: rule.sourcePath ? `Required field is missing (source "${rule.sourcePath}")` : 'Required field has no value' });
      continue;
    }
    if (value === undefined) continue;
    if (value === null && handling === 'OMIT') continue;
    try {
      setPath(output, rule.targetPath, value);
    } catch (e) {
      errors.push({ field, code: 'INVALID_TARGET', message: (e as Error).message });
    }
  }
  return { output, errors };
}
