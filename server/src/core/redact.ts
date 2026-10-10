/**
 * Credential redaction applied to everything that is stored for display, logged or returned by the API.
 */
export const REDACTED = '[REDACTED]';

const SENSITIVE_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|apikey|x-auth-token|x-access-token|x-amz-security-token|x-csrf-token)$/i;
const SENSITIVE_KEY = /(pass(word)?|secret|token|api[-_]?key|authorization|credential|private[-_]?key|client[-_]?secret|session|cookie)/i;

export function isSensitiveHeader(name: string, extra: string[] = []): boolean {
  return SENSITIVE_HEADER.test(name) || extra.some((e) => e.toLowerCase() === name.toLowerCase());
}

export function redactHeaders(headers: Record<string, unknown> | undefined, extraSensitive: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (v === undefined) continue;
    out[k] = isSensitiveHeader(k, extraSensitive) ? REDACTED : Array.isArray(v) ? v.join(', ') : String(v);
  }
  return out;
}

/** Replaces any occurrence of known secret values inside a string. */
export function scrubSecrets(text: string, secrets: Array<string | undefined | null>): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join(REDACTED);
  }
  return out;
}

/** Deep-redacts object keys that look sensitive and any known secret values. Returns a new object. */
export function redactDeep<T>(value: T, secrets: Array<string | undefined | null> = [], depth = 0): T {
  if (depth > 20) return value;
  if (typeof value === 'string') return scrubSecrets(value, secrets) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, secrets, depth + 1)) as unknown as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) && (typeof v === 'string' || typeof v === 'number') ? REDACTED : redactDeep(v, secrets, depth + 1);
    }
    return out as T;
  }
  return value;
}

/** Removes query-string values that look like credentials from a URL for display. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = '';
      u.password = '';
    }
    for (const key of Array.from(u.searchParams.keys())) {
      if (SENSITIVE_KEY.test(key) || /^(key|sig|signature|code)$/i.test(key)) u.searchParams.set(key, REDACTED);
    }
    return u.toString();
  } catch {
    return url;
  }
}
