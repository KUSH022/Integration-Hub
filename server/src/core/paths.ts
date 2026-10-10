/**
 * Safe dot-path helpers. Paths such as "address.city" or "items.0.code".
 * Prototype-polluting segments are rejected.
 */
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);

export function parsePath(path: string): string[] {
  if (typeof path !== 'string' || path.trim() === '') throw new Error('Path must be a non-empty string');
  const parts = path.split('.').map((p) => p.trim());
  for (const p of parts) {
    if (p === '') throw new Error(`Invalid path "${path}"`);
    if (FORBIDDEN.has(p)) throw new Error(`Forbidden path segment "${p}"`);
    if (!/^[A-Za-z0-9_\-$]+$/.test(p)) throw new Error(`Invalid characters in path segment "${p}"`);
  }
  return parts;
}

export function isValidPath(path: string): boolean {
  try {
    parsePath(path);
    return true;
  } catch {
    return false;
  }
}

export function getPath(obj: unknown, path: string): { found: boolean; value: unknown } {
  const parts = parsePath(path);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return { found: false, value: undefined };
    if (!Object.prototype.hasOwnProperty.call(cur, p)) return { found: false, value: undefined };
    cur = (cur as Record<string, unknown>)[p];
  }
  return { found: true, value: cur };
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = parsePath(path);
  let cur: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    const next = cur[p];
    if (next === undefined || next === null || typeof next !== 'object') {
      const created: Record<string, unknown> | unknown[] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      Object.defineProperty(cur, p, { value: created, enumerable: true, writable: true, configurable: true });
      cur = created as any;
    } else {
      cur = next;
    }
  }
  Object.defineProperty(cur, parts[parts.length - 1], { value, enumerable: true, writable: true, configurable: true });
}

/** Deep clone JSON-compatible data (used to guarantee source payloads are never mutated). */
export function deepClone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

export function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v as object)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

/** Lists leaf paths of a JSON object (used by the mapping UI and previews). */
export function listLeafPaths(obj: unknown, prefix = '', depth = 0, out: string[] = []): string[] {
  if (depth > 8) return out;
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const k of Object.keys(obj as object)) {
      const p = prefix ? `${prefix}.${k}` : k;
      const v = (obj as Record<string, unknown>)[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) listLeafPaths(v, p, depth + 1, out);
      else out.push(p);
    }
  }
  return out;
}
