import { describe, it, expect } from 'vitest';
import { applyMappings, validateMappingRules, type MappingRule } from '../src/core/transform.js';
import { validatePayload, findBatchDuplicates, validateRuleDefinitions } from '../src/core/validate.js';
import { parseCsv } from '../src/core/csv.js';
import { renderJson, renderPath } from '../src/core/template.js';

const locationRules: MappingRule[] = [
  { sourcePath: 'locationCode', targetPath: 'locationId', required: true },
  { sourcePath: 'name', targetPath: 'locationName', transforms: [{ type: 'TRIM' }] },
  { sourcePath: 'region', targetPath: 'region' },
  { sourcePath: 'active', targetPath: 'status', transforms: [{ type: 'BOOLEAN_TO_STATUS', trueValue: 'Active', falseValue: 'Inactive' }] },
];

describe('field mapping', () => {
  it('maps the documented location example exactly', () => {
    const { output, errors } = applyMappings({ locationCode: 'KP101', name: 'KP Downtown Store', region: 'North', active: true }, locationRules);
    expect(errors).toEqual([]);
    expect(output).toEqual({ locationId: 'KP101', locationName: 'KP Downtown Store', region: 'North', status: 'Active' });
  });

  it('never mutates the source payload', () => {
    const src = { locationCode: 'KP101', name: '  Padded  ', region: 'North', active: false };
    const copy = JSON.parse(JSON.stringify(src));
    applyMappings(src, locationRules);
    expect(src).toEqual(copy);
  });

  it('supports nested source and target paths', () => {
    const { output } = applyMappings({ a: { b: 'x' } }, [{ sourcePath: 'a.b', targetPath: 'c.d' }]);
    expect(output).toEqual({ c: { d: 'x' } });
  });

  it('rejects prototype-polluting paths', () => {
    const errs = validateMappingRules([{ sourcePath: 'a', targetPath: '__proto__.polluted' }]);
    expect(errs.some((e) => e.code === 'INVALID_TARGET')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('flags duplicate targets and missing sources', () => {
    const errs = validateMappingRules([
      { sourcePath: 'a', targetPath: 'x' },
      { sourcePath: 'b', targetPath: 'x' },
      { targetPath: 'y' },
    ]);
    expect(errs.map((e) => e.code).sort()).toEqual(['DUPLICATE_TARGET', 'NO_SOURCE']);
  });
});

describe('transformation rules', () => {
  const run = (value: unknown, rule: Partial<MappingRule>) => applyMappings({ v: value }, [{ sourcePath: 'v', targetPath: 'out', ...rule }]);

  it('trims and converts case', () => {
    expect(run('  hello world ', { transforms: [{ type: 'TRIM' }, { type: 'CASE', mode: 'TITLE' }] }).output.out).toBe('Hello World');
    expect(run('abc', { transforms: [{ type: 'CASE', mode: 'UPPER' }] }).output.out).toBe('ABC');
    expect(run('ABC', { transforms: [{ type: 'CASE', mode: 'LOWER' }] }).output.out).toBe('abc');
  });

  it('formats dates and rejects impossible dates', () => {
    expect(run('15/03/2024', { transforms: [{ type: 'DATE_FORMAT', inputFormat: 'DD/MM/YYYY', outputFormat: 'YYYY-MM-DD' }] }).output.out).toBe('2024-03-15');
    const bad = run('31/02/2024', { transforms: [{ type: 'DATE_FORMAT', inputFormat: 'DD/MM/YYYY', outputFormat: 'YYYY-MM-DD' }] });
    expect(bad.errors[0]).toMatchObject({ field: 'out', code: 'INVALID_DATE' });
  });

  it('converts numbers with rounding and reports invalid numbers', () => {
    expect(run('18.456', { transforms: [{ type: 'TO_NUMBER', decimals: 2 }] }).output.out).toBe(18.46);
    expect(run('abc', { transforms: [{ type: 'TO_NUMBER' }] }).errors[0].code).toBe('INVALID_NUMBER');
  });

  it('applies defaults, allowed values and null handling', () => {
    expect(applyMappings({}, [{ sourcePath: 'missing', targetPath: 'x', defaultValue: 'D' }]).output).toEqual({ x: 'D' });
    expect(run('East', { transforms: [{ type: 'ALLOWED_VALUES', values: ['North', 'South'] }] }).errors[0].code).toBe('NOT_ALLOWED');
    expect(run(null, { nullHandling: 'OMIT' }).output).toEqual({});
    expect(run(null, { nullHandling: 'KEEP' }).output).toEqual({ out: null });
    expect(run(null, { nullHandling: 'ERROR' }).errors[0].code).toBe('NULL_VALUE');
    expect(run(null, { nullHandling: 'DEFAULT', defaultValue: 0 }).output).toEqual({ out: 0 });
  });

  it('reports required-field failures with the field name', () => {
    const { errors } = applyMappings({ name: 'x' }, locationRules);
    expect(errors).toEqual([expect.objectContaining({ field: 'locationId', sourceField: 'locationCode', code: 'REQUIRED' })]);
  });

  it('rejects non-boolean input for boolean-to-status', () => {
    expect(run('maybe', { transforms: [{ type: 'BOOLEAN_TO_STATUS', trueValue: 'A', falseValue: 'I' }] }).errors[0].code).toBe('INVALID_BOOLEAN');
  });

  it('rejects unknown transform types (no arbitrary code execution)', () => {
    const r = run('x', { transforms: [{ type: 'EVAL', code: 'process.exit(1)' } as never] });
    expect(r.errors[0].code).toBe('UNKNOWN_TRANSFORM');
  });
});

describe('payload validation', () => {
  it('validates required fields, types, lengths, ranges and allowed values', () => {
    const errs = validatePayload(
      { id: 'A', name: 'x'.repeat(11), rate: -1, status: 'Gone', count: '3', hired: '2024-13-01' },
      [
        { field: 'missing', required: true },
        { field: 'id', minLength: 2 },
        { field: 'name', maxLength: 10 },
        { field: 'rate', type: 'number', min: 0 },
        { field: 'status', allowedValues: ['Active', 'Inactive'] },
        { field: 'count', type: 'integer' },
        { field: 'hired', type: 'date', dateFormat: 'YYYY-MM-DD' },
      ],
    );
    expect(errs.map((e) => `${e.field}:${e.code}`)).toEqual(['missing:REQUIRED', 'id:MIN_LENGTH', 'name:MAX_LENGTH', 'rate:MIN', 'status:NOT_ALLOWED', 'count:TYPE', 'hired:DATE_FORMAT']);
  });

  it('detects duplicates inside a batch', () => {
    const d = findBatchDuplicates([{ id: 1 }, { id: 2 }, { id: 1 }], 'id');
    expect(Array.from(d.keys())).toEqual([2]);
  });

  it('validates rule definitions', () => {
    expect(validateRuleDefinitions([{ field: 'a', min: 5, max: 1 }])[0].code).toBe('INVALID_RULE');
  });
});

describe('CSV parsing', () => {
  it('parses quoted fields, escaped quotes and embedded newlines', () => {
    const { records, errors } = parseCsv('code,name\r\nKP1,"Store, ""A"""\nKP2,"Multi\nline"\n');
    expect(errors).toEqual([]);
    expect(records).toEqual([{ code: 'KP1', name: 'Store, "A"' }, { code: 'KP2', name: 'Multi\nline' }]);
  });
  it('reports rows with the wrong number of columns', () => {
    const { records, errors } = parseCsv('a,b\n1,2,3\n4,5');
    expect(records).toEqual([{ a: '4', b: '5' }]);
    expect(errors[0].line).toBe(2);
  });
});

describe('templates', () => {
  it('renders path placeholders URL-encoded and JSON placeholders as raw values', () => {
    expect(renderPath('/locations/{{payload.id}}', { payload: { id: 'A/B 1' } })).toBe('/locations/A%2FB%201');
    expect(renderJson({ exp: '{{expected}}', label: 'run {{id}}' }, { expected: { a: 1 }, id: 'r1' })).toEqual({ exp: { a: 1 }, label: 'run r1' });
    expect(() => renderPath('/x/{{nope}}', {})).toThrow(/not available/);
  });
});
