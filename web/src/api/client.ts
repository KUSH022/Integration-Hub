/**
 * Fetch-based API client. Authentication uses the HttpOnly session cookie set by the backend; the
 * browser never sees or stores tokens or connection credentials.
 */
const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') ?? '';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
    public requestId?: string,
  ) {
    super(message);
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
export function onUnauthorized(l: Listener) {
  unauthorizedListeners.add(l);
  return () => {
    unauthorizedListeners.delete(l);
  };
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; query?: Record<string, unknown>; signal?: AbortSignal } = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers['X-KP-Hub-Client'] = 'web';
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(url.toString(), { method, headers, credentials: 'include', body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: init.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'Cannot reach the KP Integration Hub API. If the backend is on a free tier it may be waking up — retry in about a minute.');
  }
  const text = await res.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown; requestId?: string } })?.error;
    if (res.status === 401) unauthorizedListeners.forEach((l) => l());
    throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? `Request failed with HTTP ${res.status}`, err?.details, err?.requestId);
  }
  return data as T;
}

export const get = <T,>(path: string, query?: Record<string, unknown>) => api<T>(path, { query });
export const post = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const put = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body: body ?? {} });
export const patch = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body: body ?? {} });
export const del = <T,>(path: string) => api<T>(path, { method: 'DELETE' });

export function fmtDate(v?: string | Date | null) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export function duration(a?: string | null, b?: string | null) {
  if (!a || !b) return '—';
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}
