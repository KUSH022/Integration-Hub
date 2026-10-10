/** Field comparison used for KP WFM read-back verification. Strict JSON equality per field. */
import { getPath } from './paths.js';

export interface FieldDiff {
  field: string;
  expected: unknown;
  actual: unknown;
  message: string;
}

function canonical(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const keys = Object.keys(v as object).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
}

export function compareFields(expected: unknown, actual: unknown, fields: string[]): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  for (const f of fields) {
    const e = getPath(expected, f);
    const a = getPath(actual, f);
    if (!e.found) {
      diffs.push({ field: f, expected: undefined, actual: a.value, message: 'Field not present in the transformed request; cannot compare' });
      continue;
    }
    if (!a.found) {
      diffs.push({ field: f, expected: e.value, actual: undefined, message: 'Field missing in destination record' });
      continue;
    }
    if (canonical(e.value) !== canonical(a.value)) diffs.push({ field: f, expected: e.value, actual: a.value, message: 'Value differs' });
  }
  return diffs;
}
