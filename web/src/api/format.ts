export function fmtDate(v?: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export function durationMs(start?: string, end?: string): string {
  if (!start || !end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function parseCodes(s: string): number[] | null {
  const parts = s.split(',').map((x) => x.trim()).filter(Boolean);
  const nums = parts.map(Number);
  return nums.length > 0 && nums.every((n) => Number.isInteger(n) && n >= 100 && n <= 599) ? nums : null;
}

/** Parses a comma-separated list, converting numeric/boolean-looking items. */
export function parseList(s: string): Array<string | number | boolean> {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
    .map((x) => (x === 'true' ? true : x === 'false' ? false : /^-?\d+(\.\d+)?$/.test(x) ? Number(x) : x));
}

export function leafPaths(obj: unknown, prefix = '', out: string[] = [], depth = 0): string[] {
  if (depth > 8 || obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    if (prefix) out.push(prefix);
    return out;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) leafPaths(v, prefix ? `${prefix}.${k}` : k, out, depth + 1);
  return out;
}
