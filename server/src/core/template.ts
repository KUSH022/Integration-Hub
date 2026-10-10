/**
 * Minimal, safe placeholder substitution: {{name}} or {{payload.path}}.
 * Only variables supplied by the Hub are available; there is no expression evaluation.
 */
import { getPath } from './paths.js';

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.\-]+)\s*\}\}/g;
const WHOLE = /^\{\{\s*([A-Za-z0-9_.\-]+)\s*\}\}$/;

export class TemplateError extends Error {}

function lookup(vars: Record<string, unknown>, name: string): unknown {
  const { found, value } = getPath(vars, name);
  if (!found || value === undefined) throw new TemplateError(`Template variable "${name}" is not available`);
  return value;
}

/** Renders a URL path; substituted values are URI-encoded. */
export function renderPath(template: string, vars: Record<string, unknown>): string {
  return template.replace(PLACEHOLDER, (_m, name: string) => {
    const v = lookup(vars, name);
    if (v !== null && typeof v === 'object') throw new TemplateError(`Variable "${name}" is an object and cannot be used in a path`);
    return encodeURIComponent(String(v));
  });
}

/** Renders a JSON template. A string that is exactly "{{var}}" is replaced by the raw value (object, number, ...). */
export function renderJson(template: unknown, vars: Record<string, unknown>, depth = 0): unknown {
  if (depth > 20) throw new TemplateError('Template is nested too deeply');
  if (typeof template === 'string') {
    const whole = template.match(WHOLE);
    if (whole) return lookup(vars, whole[1]);
    return template.replace(PLACEHOLDER, (_m, name: string) => {
      const v = lookup(vars, name);
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
  }
  if (Array.isArray(template)) return template.map((t) => renderJson(t, vars, depth + 1));
  if (template && typeof template === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(template as Record<string, unknown>)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      out[k] = renderJson(v, vars, depth + 1);
    }
    return out;
  }
  return template;
}

export function listPlaceholders(template: unknown): string[] {
  const s = typeof template === 'string' ? template : JSON.stringify(template ?? '');
  return Array.from(s.matchAll(PLACEHOLDER)).map((m) => m[1]);
}
