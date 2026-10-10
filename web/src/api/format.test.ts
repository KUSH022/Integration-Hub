import { describe, expect, it } from 'vitest';
import { leafPaths, parseCodes, parseList } from './format';

describe('format helpers', () => {
  it('parses status code lists strictly', () => {
    expect(parseCodes('200, 201')).toEqual([200, 201]);
    expect(parseCodes('200,abc')).toBeNull();
    expect(parseCodes('')).toBeNull();
  });
  it('parses allowed-value lists with types', () => {
    expect(parseList('North, 1, true')).toEqual(['North', 1, true]);
  });
  it('lists leaf paths for mapping suggestions', () => {
    expect(leafPaths({ a: 1, b: { c: 2 } })).toEqual(['a', 'b.c']);
  });
});
